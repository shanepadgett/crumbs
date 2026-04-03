/**
 * Crumbs Permission Gate Extension
 *
 * What it does: gates `bash` tool execution using allow/deny/ask policies from
 * `.pi/crumbs.json` (project) and `~/.pi/agent/crumbs.json` (user).
 *
 * How to use it: create either policy file, then run commands normally.
 * When policy resolves to `ask`, the extension prompts with allow/deny choices.
 *
 * Example:
 * {
 *   "$schema": "../schemas/crumbs.schema.json",
 *   "defaultPolicy": "ask",
 *   "allow": [{ "match": "exact", "value": "git status" }],
 *   "deny": [{ "match": "regex", "value": "\\brm\\s+-rf\\b" }]
 * }
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showOptionPicker, type OptionPickerLine } from "../shared/option-picker.js";
import { CRUMBS_EVENT_USER_INPUT_REQUIRED } from "../shared/events.js";

type DefaultPolicy = "ask" | "allow" | "deny";
type OnNoUiPolicy = "allow" | "deny";
type RuleMatch = "exact" | "prefix" | "regex";

type Decision = "ask" | "allow" | "deny";

type ApprovalAction = "allow-once" | "always-project" | "always-user" | "deny";

interface Rule {
  match: RuleMatch;
  value: string;
}

interface ParsedPolicyFile {
  defaultPolicy?: DefaultPolicy;
  onNoUi?: OnNoUiPolicy;
  allow: Rule[];
  deny: Rule[];
}

interface EffectivePolicy {
  defaultPolicy: DefaultPolicy;
  onNoUi: OnNoUiPolicy;
  allow: Rule[];
  deny: Rule[];
}

interface RuleMatchResult {
  decision: Exclude<Decision, "ask">;
  rule: Rule;
}

interface PolicyEvaluation {
  decision: Decision;
  matched?: RuleMatchResult;
}

type ShellOperator = "&&" | "||" | "|" | ";" | "\n";

interface ShellAnalysis {
  segments: string[];
  operators: ShellOperator[];
  hasCompoundOperators: boolean;
  hasUnsupportedSyntax: boolean;
  unsupportedReason?: string;
}

interface ParsedWord {
  raw: string;
  value: string;
  hadEscape: boolean;
  hadExpansion: boolean;
}

interface ParsedSimpleCommand {
  envAssignments: ParsedWord[];
  command: ParsedWord | null;
  args: ParsedWord[];
  unsupportedReason?: string;
}

interface ParsedGitInvocation {
  subcommand: ParsedWord | null;
  subcommandArgs: ParsedWord[];
  hasUnsupportedGlobalOptions: boolean;
}

type BuiltinSafeDecision = "allow" | "not-safe" | "not-applicable";

interface BuiltinSafeEvaluation {
  decision: BuiltinSafeDecision;
}

interface ApprovalResult {
  action: ApprovalAction;
  note?: string;
  denyReason?: string;
}

const PROJECT_POLICY_PATH = ".pi/crumbs.json";
const USER_POLICY_PATH = ".pi/agent/crumbs.json";
const SETTINGS_PATH = ".pi/agent/settings.json";
const PROJECT_SCHEMA_REF = "../schemas/crumbs.schema.json";
const SCHEMA_FILE_RELATIVE_PATH = "schemas/crumbs.schema.json";

const DEFAULT_POLICY: DefaultPolicy = "ask";
const DEFAULT_ON_NO_UI: OnNoUiPolicy = "deny";

const APPROVAL_OPTIONS: ReadonlyArray<{ id: ApprovalAction; label: string }> = [
  { id: "allow-once", label: "Allow once" },
  { id: "always-project", label: "Always allow (project)" },
  { id: "always-user", label: "Always allow (user)" },
  { id: "deny", label: "Deny" },
];

// Baked-in safe defaults that can be expressed as simple rules.
// Richer tools like `rg`, `find`, and `git` are handled by semantic evaluators below.
const BUILTIN_SAFE_ALLOW_RULES: ReadonlyArray<Rule> = [
  { match: "exact", value: "pwd" },
  { match: "exact", value: "whoami" },
  { match: "exact", value: "uname -a" },
];

const FIND_UNSAFE_ACTIONS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);

const GIT_SAFE_READ_ONLY_SUBCOMMANDS = new Set([
  "rev-parse",
  "status",
  "ls-files",
  "show-ref",
  "grep",
]);

const GIT_DIFF_UNSAFE_OPTIONS = new Set(["--ext-diff", "--textconv", "--output"]);

const GIT_SYMBOLIC_REF_SAFE_OPTIONS = new Set(["--short", "-q", "--quiet", "--no-recurse"]);

function normalizeCommand(command: string): string {
  return command.replace(/\r\n?/g, "\n").trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefaultPolicy(value: unknown): value is DefaultPolicy {
  return value === "ask" || value === "allow" || value === "deny";
}

function isOnNoUiPolicy(value: unknown): value is OnNoUiPolicy {
  return value === "allow" || value === "deny";
}

function isRuleMatch(value: unknown): value is RuleMatch {
  return value === "exact" || value === "prefix" || value === "regex";
}

function parseRule(value: unknown): Rule | null {
  if (!isObject(value)) return null;
  if (!isRuleMatch(value.match)) return null;
  if (typeof value.value !== "string") return null;
  return { match: value.match, value: value.value };
}

function parsePolicyFile(value: unknown): ParsedPolicyFile | null {
  if (!isObject(value)) return null;

  if (value.defaultPolicy !== undefined && !isDefaultPolicy(value.defaultPolicy)) return null;
  if (value.onNoUi !== undefined && !isOnNoUiPolicy(value.onNoUi)) return null;

  if (value.allow !== undefined && !Array.isArray(value.allow)) return null;
  if (value.deny !== undefined && !Array.isArray(value.deny)) return null;

  return {
    defaultPolicy: value.defaultPolicy,
    onNoUi: value.onNoUi,
    allow: (Array.isArray(value.allow) ? value.allow : [])
      .map(parseRule)
      .filter((r): r is Rule => r !== null),
    deny: (Array.isArray(value.deny) ? value.deny : [])
      .map(parseRule)
      .filter((r): r is Rule => r !== null),
  };
}

async function readPolicyFile(path: string): Promise<ParsedPolicyFile | null> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return parsePolicyFile(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function mergePolicy(
  user: ParsedPolicyFile | null,
  project: ParsedPolicyFile | null,
): EffectivePolicy {
  return {
    defaultPolicy: project?.defaultPolicy ?? user?.defaultPolicy ?? DEFAULT_POLICY,
    onNoUi: project?.onNoUi ?? user?.onNoUi ?? DEFAULT_ON_NO_UI,
    allow: [...(user?.allow ?? []), ...(project?.allow ?? []), ...BUILTIN_SAFE_ALLOW_RULES],
    deny: [...(user?.deny ?? []), ...(project?.deny ?? [])],
  };
}

function ruleMatchesCommand(command: string, rule: Rule): boolean {
  if (rule.value.length === 0) return false;

  switch (rule.match) {
    case "exact":
      return command === rule.value;
    case "prefix":
      return command.startsWith(rule.value);
    case "regex":
      try {
        return new RegExp(rule.value).test(command);
      } catch {
        // Invalid regex rules are ignored by design.
        return false;
      }
  }
}

function findMatchingRule(command: string, rules: Rule[]): Rule | undefined {
  return rules.find((rule) => ruleMatchesCommand(command, rule));
}

function findExactAllowRule(command: string, policy: EffectivePolicy): Rule | undefined {
  return policy.allow.find((rule) => rule.match === "exact" && rule.value === command);
}

function unsupportedShellAnalysis(
  operators: ShellOperator[],
  unsupportedReason: string,
): ShellAnalysis {
  return {
    segments: [],
    operators,
    hasCompoundOperators: operators.length > 0,
    hasUnsupportedSyntax: true,
    unsupportedReason,
  };
}

function analyzeShellCommand(command: string): ShellAnalysis {
  const segments: string[] = [];
  const operators: ShellOperator[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushSegment = (): boolean => {
    const trimmed = current.trim();
    current = "";

    if (trimmed.length === 0) {
      return false;
    }

    segments.push(trimmed);
    return true;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const nextChar = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      current += char;
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === '"') {
      current += char;
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quote = null;
      }
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "$" && nextChar === "(") {
      return unsupportedShellAnalysis(operators, "command substitution");
    }

    if (char === "`") {
      return unsupportedShellAnalysis(operators, "backtick command substitution");
    }

    if (char === ">" || char === "<") {
      return unsupportedShellAnalysis(operators, "redirection");
    }

    if (char === "(" || char === ")" || char === "{" || char === "}") {
      return unsupportedShellAnalysis(operators, "grouping syntax");
    }

    if (char === "&") {
      if (nextChar === "&") {
        if (!pushSegment()) {
          return unsupportedShellAnalysis(operators, "empty command segment");
        }
        operators.push("&&");
        index += 1;
        continue;
      }

      return unsupportedShellAnalysis(operators, "background execution");
    }

    if (char === "|") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }

      if (nextChar === "|") {
        operators.push("||");
        index += 1;
      } else {
        operators.push("|");
      }
      continue;
    }

    if (char === ";") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }
      operators.push(";");
      continue;
    }

    if (char === "\n") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }
      operators.push("\n");
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    return unsupportedShellAnalysis(operators, "unterminated quote");
  }

  if (escaped) {
    return unsupportedShellAnalysis(operators, "trailing escape");
  }

  if (current.trim().length === 0) {
    if (operators.length > 0) {
      return unsupportedShellAnalysis(operators, "empty command segment");
    }
  } else {
    segments.push(current.trim());
  }

  return {
    segments,
    operators,
    hasCompoundOperators: operators.length > 0,
    hasUnsupportedSyntax: false,
  };
}

function unsupportedParsedSimpleCommand(reason: string): ParsedSimpleCommand {
  return {
    envAssignments: [],
    command: null,
    args: [],
    unsupportedReason: reason,
  };
}

function parseSimpleCommand(segment: string): ParsedSimpleCommand {
  const words: ParsedWord[] = [];
  let raw = "";
  let value = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hadEscape = false;
  let hadExpansion = false;

  const pushWord = () => {
    if (raw.length === 0) return;

    words.push({
      raw,
      value,
      hadEscape,
      hadExpansion,
    });

    raw = "";
    value = "";
    quote = null;
    escaped = false;
    hadEscape = false;
    hadExpansion = false;
  };

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];

    if (quote === "'") {
      raw += char;
      if (char === "'") {
        quote = null;
      } else {
        value += char;
      }
      continue;
    }

    if (quote === '"') {
      if (escaped) {
        raw += char;
        value += char;
        escaped = false;
        continue;
      }

      raw += char;

      if (char === "\\") {
        escaped = true;
        hadEscape = true;
        continue;
      }

      if (char === '"') {
        quote = null;
        continue;
      }

      if (char === "$" || char === "`") {
        hadExpansion = true;
      }

      value += char;
      continue;
    }

    if (escaped) {
      raw += char;
      value += char;
      escaped = false;
      continue;
    }

    if (/\s/.test(char)) {
      pushWord();
      continue;
    }

    raw += char;

    if (char === "\\") {
      escaped = true;
      hadEscape = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$" || char === "`") {
      hadExpansion = true;
    }

    value += char;
  }

  if (quote !== null) {
    return unsupportedParsedSimpleCommand("unterminated quote");
  }

  if (escaped) {
    return unsupportedParsedSimpleCommand("trailing escape");
  }

  pushWord();

  const envAssignments: ParsedWord[] = [];
  let wordIndex = 0;

  while (wordIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[wordIndex].raw)) {
    envAssignments.push(words[wordIndex]);
    wordIndex += 1;
  }

  if (wordIndex >= words.length) {
    return {
      envAssignments,
      command: null,
      args: [],
    };
  }

  return {
    envAssignments,
    command: words[wordIndex],
    args: words.slice(wordIndex + 1),
  };
}

function parsedCommandHasExpansion(command: ParsedSimpleCommand): boolean {
  return [command.command, ...command.args, ...command.envAssignments].some(
    (word) => word?.hadExpansion === true,
  );
}

function canAutoAllowBuiltinCommand(command: ParsedSimpleCommand): boolean {
  return (
    command.unsupportedReason === undefined &&
    command.command !== null &&
    command.envAssignments.length === 0 &&
    !parsedCommandHasExpansion(command)
  );
}

function evaluateSafeLs(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "ls") {
    return { decision: "not-applicable" };
  }

  return canAutoAllowBuiltinCommand(command) ? { decision: "allow" } : { decision: "not-safe" };
}

function evaluateSafeRg(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "rg") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  let optionsEnded = false;

  for (const arg of command.args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (
      value === "--pre" ||
      value.startsWith("--pre=") ||
      value === "--pre-glob" ||
      value.startsWith("--pre-glob=")
    ) {
      return { decision: "not-safe" };
    }
  }

  return { decision: "allow" };
}

function evaluateSafeFind(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "find") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  let optionsEnded = false;

  for (const arg of command.args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (FIND_UNSAFE_ACTIONS.has(value)) {
      return { decision: "not-safe" };
    }
  }

  return { decision: "allow" };
}

function parseGitInvocation(command: ParsedSimpleCommand): ParsedGitInvocation {
  let index = 0;

  while (index < command.args.length) {
    const arg = command.args[index];
    const value = arg.value;

    if (value === "--no-pager") {
      index += 1;
      continue;
    }

    if (value === "-C") {
      if (index + 1 >= command.args.length) {
        return {
          subcommand: null,
          subcommandArgs: [],
          hasUnsupportedGlobalOptions: true,
        };
      }

      index += 2;
      continue;
    }

    if (value.startsWith("-C") && value.length > 2) {
      index += 1;
      continue;
    }

    if (value.startsWith("-")) {
      return {
        subcommand: null,
        subcommandArgs: [],
        hasUnsupportedGlobalOptions: true,
      };
    }

    return {
      subcommand: arg,
      subcommandArgs: command.args.slice(index + 1),
      hasUnsupportedGlobalOptions: false,
    };
  }

  return {
    subcommand: null,
    subcommandArgs: [],
    hasUnsupportedGlobalOptions: false,
  };
}

function isSafeGitDiffArgs(args: ParsedWord[]): boolean {
  let optionsEnded = false;

  for (const arg of args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (
      GIT_DIFF_UNSAFE_OPTIONS.has(value) ||
      value.startsWith("--ext-diff=") ||
      value.startsWith("--textconv=") ||
      value.startsWith("--output=")
    ) {
      return false;
    }
  }

  return true;
}

function isSafeGitSymbolicRefArgs(args: ParsedWord[]): boolean {
  const operands: string[] = [];

  for (const arg of args) {
    const value = arg.value;

    if (value === "--") {
      return false;
    }

    if (value === "-d" || value === "--delete" || value === "-m") {
      return false;
    }

    if (value.startsWith("-m") && value.length > 2) {
      return false;
    }

    if (value.startsWith("-")) {
      if (!GIT_SYMBOLIC_REF_SAFE_OPTIONS.has(value)) {
        return false;
      }
      continue;
    }

    operands.push(value);
  }

  return operands.length === 1;
}

function evaluateSafeGit(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "git") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  const gitInvocation = parseGitInvocation(command);
  if (gitInvocation.hasUnsupportedGlobalOptions || gitInvocation.subcommand === null) {
    return { decision: "not-safe" };
  }

  const subcommand = gitInvocation.subcommand.value;

  if (GIT_SAFE_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return { decision: "allow" };
  }

  if (subcommand === "branch") {
    return gitInvocation.subcommandArgs.length === 1 &&
      gitInvocation.subcommandArgs[0].value === "--show-current"
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  if (subcommand === "diff") {
    return isSafeGitDiffArgs(gitInvocation.subcommandArgs)
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  if (subcommand === "symbolic-ref") {
    return isSafeGitSymbolicRefArgs(gitInvocation.subcommandArgs)
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  return { decision: "not-safe" };
}

function evaluateBuiltinSafeCommand(command: string): BuiltinSafeEvaluation {
  const parsedCommand = parseSimpleCommand(command);
  if (parsedCommand.unsupportedReason || parsedCommand.command === null) {
    return { decision: "not-safe" };
  }

  const lsEvaluation = evaluateSafeLs(parsedCommand);
  if (lsEvaluation.decision !== "not-applicable") {
    return lsEvaluation;
  }

  const rgEvaluation = evaluateSafeRg(parsedCommand);
  if (rgEvaluation.decision !== "not-applicable") {
    return rgEvaluation;
  }

  const findEvaluation = evaluateSafeFind(parsedCommand);
  if (findEvaluation.decision !== "not-applicable") {
    return findEvaluation;
  }

  const gitEvaluation = evaluateSafeGit(parsedCommand);
  if (gitEvaluation.decision !== "not-applicable") {
    return gitEvaluation;
  }

  return { decision: "not-applicable" };
}

function isCommandAllowedByPolicyOrBuiltin(command: string, policy: EffectivePolicy): boolean {
  if (findMatchingRule(command, policy.allow) !== undefined) {
    return true;
  }

  return evaluateBuiltinSafeCommand(command).decision === "allow";
}

function evaluateSimpleCommand(command: string, policy: EffectivePolicy): PolicyEvaluation {
  const allowMatch = findMatchingRule(command, policy.allow);
  if (allowMatch) {
    return {
      decision: "allow",
      matched: { decision: "allow", rule: allowMatch },
    };
  }

  if (evaluateBuiltinSafeCommand(command).decision === "allow") {
    return { decision: "allow" };
  }

  return { decision: policy.defaultPolicy };
}

function evaluatePolicy(command: string, policy: EffectivePolicy): PolicyEvaluation {
  const denyMatch = findMatchingRule(command, policy.deny);
  if (denyMatch) {
    return {
      decision: "deny",
      matched: { decision: "deny", rule: denyMatch },
    };
  }

  const exactAllowMatch = findExactAllowRule(command, policy);
  if (exactAllowMatch) {
    return {
      decision: "allow",
      matched: { decision: "allow", rule: exactAllowMatch },
    };
  }

  const analysis = analyzeShellCommand(command);

  if (analysis.hasUnsupportedSyntax) {
    return { decision: "ask" };
  }

  if (!analysis.hasCompoundOperators) {
    return evaluateSimpleCommand(command, policy);
  }

  for (const segment of analysis.segments) {
    const segmentDenyMatch = findMatchingRule(segment, policy.deny);
    if (segmentDenyMatch) {
      return {
        decision: "deny",
        matched: { decision: "deny", rule: segmentDenyMatch },
      };
    }
  }

  const allSegmentsAllowed =
    analysis.segments.length > 0 &&
    analysis.segments.every((segment) => isCommandAllowedByPolicyOrBuiltin(segment, policy));

  if (allSegmentsAllowed) {
    return { decision: "allow" };
  }

  return { decision: "ask" };
}

function formatRuleMatchReason(matched: RuleMatchResult): string {
  const descriptor = `${matched.rule.match}: ${matched.rule.value}`;
  if (matched.decision === "deny") {
    return `Blocked by crumbs policy deny rule (${descriptor})`;
  }
  return `Allowed by crumbs policy allow rule (${descriptor})`;
}

async function showApprovalPrompt(
  ctx: ExtensionContext,
  command: string,
): Promise<ApprovalResult | null> {
  const commandLines = command.split("\n");
  const shownCommandLines = commandLines.slice(0, 8);

  const lines: OptionPickerLine[] = [{ text: "Command:", tone: "muted" }];

  for (const line of shownCommandLines) {
    lines.push({ text: line, tone: "text", indent: 2 });
  }

  if (commandLines.length > shownCommandLines.length) {
    lines.push({ text: "…", tone: "dim", indent: 2 });
  }

  const result = await showOptionPicker(ctx, {
    title: "Bash command requires approval",
    lines,
    options: APPROVAL_OPTIONS,
    cancelAction: "deny",
  });

  if (!result) return null;

  const selectedNote = (result.notes[result.action] ?? "").trim();
  const note = selectedNote.length > 0 ? selectedNote : undefined;

  if (result.action === "deny") {
    return {
      action: "deny",
      note,
      denyReason: note,
    };
  }

  return {
    action: result.action,
    note,
  };
}

function projectPolicyPath(cwd: string): string {
  return resolve(cwd, PROJECT_POLICY_PATH);
}

function userPolicyPath(): string {
  return resolve(homedir(), USER_POLICY_PATH);
}

function settingsPath(): string {
  return resolve(homedir(), SETTINGS_PATH);
}

let cachedInstalledSchemaRef: string | null | undefined;
const approvalNotesByToolCallId = new Map<string, string>();

async function schemaRefFromSettingsPackages(): Promise<string | null> {
  if (cachedInstalledSchemaRef !== undefined) {
    return cachedInstalledSchemaRef;
  }

  try {
    const rawSettings = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(rawSettings) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.packages)) {
      cachedInstalledSchemaRef = null;
      return cachedInstalledSchemaRef;
    }

    const baseDir = dirname(settingsPath());

    for (const pkg of parsed.packages) {
      if (typeof pkg !== "string" || pkg.trim().length === 0) continue;
      const packageRoot = resolve(baseDir, pkg);
      const schemaPath = resolve(packageRoot, SCHEMA_FILE_RELATIVE_PATH);

      try {
        await readFile(schemaPath, "utf8");
        cachedInstalledSchemaRef = pathToFileURL(schemaPath).href;
        return cachedInstalledSchemaRef;
      } catch {
        // Ignore package entries that don't contain the schema file.
      }
    }
  } catch {
    // Ignore unreadable/malformed settings and fall back.
  }

  cachedInstalledSchemaRef = null;
  return cachedInstalledSchemaRef;
}

async function resolveSchemaRefForPersistence(
  action: ApprovalAction,
  cwd: string,
): Promise<string> {
  const fromSettings = await schemaRefFromSettingsPackages();
  if (fromSettings) return fromSettings;

  if (action === "always-project") return PROJECT_SCHEMA_REF;
  return pathToFileURL(resolve(cwd, SCHEMA_FILE_RELATIVE_PATH)).href;
}

async function ensurePolicyFileWithAllowRule(
  path: string,
  command: string,
  schemaRef: string,
): Promise<void> {
  let base: Record<string, unknown> = {};

  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (isObject(parsed)) {
      base = parsed;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      // Invalid/malformed existing file: replace with a valid policy document.
      base = {};
    }
  }

  const existingAllow = Array.isArray(base.allow) ? [...base.allow] : [];

  const hasDuplicate = existingAllow.some(
    (entry) => isObject(entry) && entry.match === "exact" && entry.value === command,
  );
  if (!hasDuplicate) {
    existingAllow.push({ match: "exact", value: command });
  }

  const next: Record<string, unknown> = {
    ...base,
    $schema: typeof base.$schema === "string" ? base.$schema : schemaRef,
    defaultPolicy: isDefaultPolicy(base.defaultPolicy) ? base.defaultPolicy : DEFAULT_POLICY,
    onNoUi: isOnNoUiPolicy(base.onNoUi) ? base.onNoUi : DEFAULT_ON_NO_UI,
    allow: existingAllow,
    deny: Array.isArray(base.deny) ? base.deny : [],
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function userBlockReason(denyReason?: string): string {
  if (!denyReason || denyReason.trim().length === 0) return "Blocked by user";
  return `Blocked by user: ${denyReason.trim()}`;
}

function formatApprovalNote(note: string): string {
  return `[crumbs approval note]\n${note}`;
}

export default function crumbsPermissionGateExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    if (typeof event.input.command !== "string") return undefined;

    const normalizedCommand = normalizeCommand(event.input.command);

    const [userPolicy, projectPolicy] = await Promise.all([
      readPolicyFile(userPolicyPath()),
      readPolicyFile(projectPolicyPath(ctx.cwd)),
    ]);

    const policy = mergePolicy(userPolicy, projectPolicy);
    const evaluated = evaluatePolicy(normalizedCommand, policy);

    if (evaluated.decision === "allow") {
      return undefined;
    }

    if (evaluated.decision === "deny") {
      return {
        block: true,
        reason: evaluated.matched
          ? formatRuleMatchReason(evaluated.matched)
          : "Blocked by crumbs policy",
      };
    }

    if (!ctx.hasUI) {
      if (policy.onNoUi === "allow") return undefined;
      return {
        block: true,
        reason: "Blocked by crumbs policy: approval required but no UI is available",
      };
    }

    pi.events.emit(CRUMBS_EVENT_USER_INPUT_REQUIRED, undefined);
    const approval = await showApprovalPrompt(ctx, normalizedCommand);
    if (!approval) {
      return {
        block: true,
        reason: "Blocked by crumbs policy: approval prompt did not complete",
      };
    }

    if (approval.action === "allow-once") {
      if (approval.note) {
        approvalNotesByToolCallId.set(event.toolCallId, approval.note);
      }
      return undefined;
    }

    if (approval.action === "deny") {
      return {
        block: true,
        reason: userBlockReason(approval.denyReason),
      };
    }

    const targetPath =
      approval.action === "always-project" ? projectPolicyPath(ctx.cwd) : userPolicyPath();
    const schemaRef = await resolveSchemaRefForPersistence(approval.action, ctx.cwd);

    try {
      await ensurePolicyFileWithAllowRule(targetPath, normalizedCommand, schemaRef);
      if (approval.note) {
        approvalNotesByToolCallId.set(event.toolCallId, approval.note);
      }
      ctx.ui.notify(`Added always-allow rule to ${targetPath}`, "info");
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        block: true,
        reason: `Blocked by crumbs policy: failed to persist always-allow rule (${message})`,
      };
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return undefined;

    const approvalNote = approvalNotesByToolCallId.get(event.toolCallId);
    if (!approvalNote) return undefined;

    approvalNotesByToolCallId.delete(event.toolCallId);
    return {
      content: [{ type: "text", text: formatApprovalNote(approvalNote) }, ...event.content],
    };
  });
}
