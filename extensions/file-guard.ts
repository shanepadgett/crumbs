/**
 * File Guard Extension
 *
 * What it does: hard-blocks sensitive paths and approval-gates selected tools per path/glob.
 * How to use it: configure `fileGuard` in `.pi/crumbs.json` using `paths`, `rules.block`, and `rules.gate`.
 * Example: keep `.env` hard-blocked, but gate only edits/writes to `.pi/crumbs.json` via `rules.gate.mutate`.
 */

import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showOptionPicker, type OptionPickerLine } from "./shared/option-picker.js";
import { CRUMBS_EVENT_USER_INPUT_REQUIRED } from "./shared/events.js";

type GuardedTool = "read" | "write" | "edit" | "bash";
type GateTool = GuardedTool | "mutate";
type OnNoUiPolicy = "allow" | "deny";
type ApprovalAction = "allow-once" | "deny";

type RuleEntry = string | RuleEntryConfig;

interface RuleEntryConfig {
  match: string;
  reason?: string;
  onNoUi?: OnNoUiPolicy;
}

interface FileGuardConfig {
  defaults: {
    onNoUi: OnNoUiPolicy;
  };
  paths: Record<string, string[]>;
  rules: {
    block: RuleEntry[];
    gate: Partial<Record<GateTool, RuleEntry[]>>;
  };
  blockReason: string;
  injectPromptReminder: boolean;
}

interface ExpandedRuleEntry {
  match: string;
  source: string;
  reason?: string;
  onNoUi?: OnNoUiPolicy;
}

type PathMatcher =
  | {
      kind: "glob";
      absolutePattern: string;
    }
  | {
      kind: "file";
      absolute: string;
      canonical: string;
    }
  | {
      kind: "directory";
      absolute: string;
      canonical: string;
    };

interface CompiledRule {
  source: string;
  reason?: string;
  onNoUi?: OnNoUiPolicy;
  matcher: PathMatcher;
}

interface CompiledGuardRules {
  block: CompiledRule[];
  gate: Record<GuardedTool, CompiledRule[]>;
}

interface RuleHit {
  rule: CompiledRule;
  candidate: string;
}

const PROJECT_POLICY_PATH = ".pi/crumbs.json";

const APPROVAL_OPTIONS: ReadonlyArray<{ id: ApprovalAction; label: string }> = [
  { id: "allow-once", label: "Allow once" },
  { id: "deny", label: "Deny" },
];

const DEFAULT_FILE_GUARD_CONFIG: FileGuardConfig = {
  defaults: {
    onNoUi: "deny",
  },
  paths: {
    hardBlocked: ["docs/_hidden/", ".env"],
    policyFiles: [".pi/crumbs.json"],
  },
  rules: {
    block: ["@hardBlocked"],
    gate: {
      mutate: [
        {
          match: "@policyFiles",
          reason: "Editing crumbs policy requires approval.",
          onNoUi: "deny",
        },
      ],
    },
  },
  blockReason:
    "File Guard: this path is off-limits and not relevant to the task. You must not read, write, modify, list, copy, move, or otherwise access it by any method, including bash, scripts, interpreters, subprocesses, symlinks, or indirection.",
  injectPromptReminder: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOnNoUiPolicy(value: unknown): value is OnNoUiPolicy {
  return value === "allow" || value === "deny";
}

function cloneRuleEntry(entry: RuleEntry): RuleEntry {
  if (typeof entry === "string") return entry;

  return {
    match: entry.match,
    reason: entry.reason,
    onNoUi: entry.onNoUi,
  };
}

function cloneRuleEntries(entries: RuleEntry[] | undefined): RuleEntry[] {
  if (!entries) return [];
  return entries.map(cloneRuleEntry);
}

function cloneConfig(config: FileGuardConfig): FileGuardConfig {
  return {
    defaults: {
      onNoUi: config.defaults.onNoUi,
    },
    paths: Object.fromEntries(
      Object.entries(config.paths).map(([name, values]) => [name, [...values]]),
    ),
    rules: {
      block: cloneRuleEntries(config.rules.block),
      gate: {
        read: cloneRuleEntries(config.rules.gate.read),
        write: cloneRuleEntries(config.rules.gate.write),
        edit: cloneRuleEntries(config.rules.gate.edit),
        bash: cloneRuleEntries(config.rules.gate.bash),
        mutate: cloneRuleEntries(config.rules.gate.mutate),
      },
    },
    blockReason: config.blockReason,
    injectPromptReminder: config.injectPromptReminder,
  };
}

function parseRuleEntry(value: unknown): RuleEntry | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  }

  if (!isObject(value) || typeof value.match !== "string") return null;

  const match = value.match.trim();
  if (!match) return null;

  const out: RuleEntryConfig = { match };

  if (typeof value.reason === "string") {
    const reason = value.reason.trim();
    if (reason) out.reason = reason;
  }

  if (value.onNoUi !== undefined && isOnNoUiPolicy(value.onNoUi)) {
    out.onNoUi = value.onNoUi;
  }

  return out;
}

function parseRuleEntries(value: unknown): RuleEntry[] {
  if (!Array.isArray(value)) return [];

  return value.map(parseRuleEntry).filter((entry): entry is RuleEntry => entry !== null);
}

function parsePaths(value: unknown): Record<string, string[]> {
  if (!isObject(value)) return {};

  const out: Record<string, string[]> = {};

  for (const [name, rawEntries] of Object.entries(value)) {
    if (!Array.isArray(rawEntries)) continue;

    const entries = rawEntries
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    out[name] = dedupe(entries);
  }

  return out;
}

function parseGateRules(value: unknown): Partial<Record<GateTool, RuleEntry[]>> {
  if (!isObject(value)) return {};

  const out: Partial<Record<GateTool, RuleEntry[]>> = {};

  if (value.read !== undefined) out.read = parseRuleEntries(value.read);
  if (value.write !== undefined) out.write = parseRuleEntries(value.write);
  if (value.edit !== undefined) out.edit = parseRuleEntries(value.edit);
  if (value.bash !== undefined) out.bash = parseRuleEntries(value.bash);
  if (value.mutate !== undefined) out.mutate = parseRuleEntries(value.mutate);

  return out;
}

function parseFileGuardSection(value: unknown): FileGuardConfig {
  const config = cloneConfig(DEFAULT_FILE_GUARD_CONFIG);
  if (!isObject(value)) return config;

  if (isObject(value.defaults) && isOnNoUiPolicy(value.defaults.onNoUi)) {
    config.defaults.onNoUi = value.defaults.onNoUi;
  }

  if (value.paths !== undefined) {
    config.paths = parsePaths(value.paths);
  }

  if (isObject(value.rules)) {
    if (value.rules.block !== undefined) {
      config.rules.block = parseRuleEntries(value.rules.block);
    }

    if (value.rules.gate !== undefined) {
      const parsedGate = parseGateRules(value.rules.gate);
      config.rules.gate = {
        ...config.rules.gate,
        ...parsedGate,
      };
    }
  }

  if (typeof value.blockReasonOverride === "string") {
    const trimmed = value.blockReasonOverride.trim();
    if (trimmed) config.blockReason = trimmed;
  }

  if (typeof value.injectPromptReminder === "boolean") {
    config.injectPromptReminder = value.injectPromptReminder;
  }

  return config;
}

async function loadFileGuardConfig(cwd: string): Promise<FileGuardConfig> {
  const policyPath = resolve(cwd, PROJECT_POLICY_PATH);

  try {
    const text = await readFile(policyPath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) return cloneConfig(DEFAULT_FILE_GUARD_CONFIG);

    return parseFileGuardSection(parsed.fileGuard);
  } catch {
    return cloneConfig(DEFAULT_FILE_GUARD_CONFIG);
  }
}

function stripToolPathPrefix(inputPath: string): string {
  return inputPath.trim().replace(/^@/, "");
}

function resolveConfiguredPath(cwd: string, configuredPath: string): string {
  const path = configuredPath.trim();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd, path);
}

function resolveInputPath(cwd: string, inputPath: string): string {
  const path = stripToolPathPrefix(inputPath);
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd, path);
}

async function toCanonicalPath(absolutePath: string): Promise<string> {
  try {
    return await realpath(absolutePath);
  } catch {
    return absolutePath;
  }
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function hasGlobMagic(path: string): boolean {
  return /[*?[\]{}]/.test(path);
}

function parseGroupReference(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("@")) return null;

  const groupName = trimmed.slice(1).trim();
  if (!groupName) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(groupName)) return null;

  return groupName;
}

function expandMatchFromGroups(
  match: string,
  groups: Record<string, string[]>,
  stack: Set<string> = new Set(),
): string[] {
  const ref = parseGroupReference(match);
  if (!ref) return [match];

  const groupEntries = groups[ref];
  if (!groupEntries) return [match];
  if (stack.has(ref)) return [];

  const nextStack = new Set(stack);
  nextStack.add(ref);

  const expanded: string[] = [];
  for (const entry of groupEntries) {
    expanded.push(...expandMatchFromGroups(entry, groups, nextStack));
  }

  return dedupe(expanded);
}

function expandRuleEntries(
  entries: RuleEntry[],
  groups: Record<string, string[]>,
): ExpandedRuleEntry[] {
  const out: ExpandedRuleEntry[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      const expanded = expandMatchFromGroups(entry, groups);
      for (const match of expanded) {
        out.push({ match, source: entry });
      }
      continue;
    }

    const expanded = expandMatchFromGroups(entry.match, groups);
    for (const match of expanded) {
      out.push({
        match,
        source: entry.match,
        reason: entry.reason,
        onNoUi: entry.onNoUi,
      });
    }
  }

  const seen = new Set<string>();
  return out.filter((rule) => {
    const key = `${rule.match}\u0000${rule.source}\u0000${rule.reason ?? ""}\u0000${rule.onNoUi ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function compilePathMatcher(cwd: string, match: string): Promise<PathMatcher | null> {
  const trimmed = match.trim();
  if (!trimmed) return null;

  const absolute = resolveConfiguredPath(cwd, trimmed);

  if (hasGlobMagic(trimmed)) {
    return {
      kind: "glob",
      absolutePattern: absolute,
    };
  }

  const canonical = await toCanonicalPath(absolute);
  const explicitDirectory = trimmed.endsWith("/");

  if (explicitDirectory) {
    return {
      kind: "directory",
      absolute,
      canonical,
    };
  }

  try {
    const info = await stat(canonical);
    if (info.isDirectory()) {
      return {
        kind: "directory",
        absolute,
        canonical,
      };
    }
  } catch {
    // Missing path is treated as file-exact unless marked as directory with trailing slash.
  }

  return {
    kind: "file",
    absolute,
    canonical,
  };
}

function pathMatchesMatcher(absolute: string, canonical: string, matcher: PathMatcher): boolean {
  if (matcher.kind === "file") {
    return absolute === matcher.absolute || canonical === matcher.canonical;
  }

  if (matcher.kind === "directory") {
    return (
      isPathInsideDirectory(absolute, matcher.absolute) ||
      isPathInsideDirectory(canonical, matcher.canonical)
    );
  }

  try {
    return (
      matchesGlob(absolute, matcher.absolutePattern) ||
      matchesGlob(canonical, matcher.absolutePattern)
    );
  } catch {
    return false;
  }
}

async function compileRuleSet(
  cwd: string,
  entries: RuleEntry[],
  groups: Record<string, string[]>,
): Promise<CompiledRule[]> {
  const expanded = expandRuleEntries(entries, groups);

  const compiled = await Promise.all(
    expanded.map(async (entry): Promise<CompiledRule | null> => {
      const matcher = await compilePathMatcher(cwd, entry.match);
      if (!matcher) return null;

      return {
        source: entry.source,
        reason: entry.reason,
        onNoUi: entry.onNoUi,
        matcher,
      };
    }),
  );

  return compiled.filter((rule): rule is CompiledRule => rule !== null);
}

async function buildGuardRules(cwd: string, config: FileGuardConfig): Promise<CompiledGuardRules> {
  const gate = config.rules.gate;
  const mutate = gate.mutate ?? [];

  const [block, read, write, edit, bash] = await Promise.all([
    compileRuleSet(cwd, config.rules.block, config.paths),
    compileRuleSet(cwd, gate.read ?? [], config.paths),
    compileRuleSet(cwd, [...mutate, ...(gate.write ?? [])], config.paths),
    compileRuleSet(cwd, [...mutate, ...(gate.edit ?? [])], config.paths),
    compileRuleSet(cwd, gate.bash ?? [], config.paths),
  ]);

  return {
    block,
    gate: {
      read,
      write,
      edit,
      bash,
    },
  };
}

async function findPathRuleMatch(
  cwd: string,
  pathInput: string,
  rules: CompiledRule[],
): Promise<RuleHit | null> {
  const absolute = resolveInputPath(cwd, pathInput);
  const canonical = await toCanonicalPath(absolute);

  for (const rule of rules) {
    if (pathMatchesMatcher(absolute, canonical, rule.matcher)) {
      return {
        rule,
        candidate: pathInput,
      };
    }
  }

  return null;
}

function tokenizeBash(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g) ?? [];
}

function stripOuterQuotes(token: string): string {
  if (token.length < 2) return token;

  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith("`") && token.endsWith("`"))
  ) {
    return token.slice(1, -1);
  }

  return token;
}

function stripBashPathOperators(token: string): string {
  return token
    .replace(/^(?:>>?|<<?)/, "")
    .replace(/[;,)]+$/, "")
    .trim();
}

function looksLikePathToken(token: string): boolean {
  return (
    token.includes("/") || token.startsWith(".") || token.startsWith("~") || token.startsWith("@")
  );
}

function extractPathCandidates(token: string): string[] {
  const unquoted = stripOuterQuotes(token);
  if (!unquoted) return [];

  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(unquoted)) return [];

  const normalized = stripBashPathOperators(unquoted);
  if (!normalized) return [];

  if (normalized.startsWith("-")) {
    const eqIndex = normalized.indexOf("=");
    if (eqIndex === -1) return [];

    const value = normalized.slice(eqIndex + 1);
    return looksLikePathToken(value) ? [value] : [];
  }

  return looksLikePathToken(normalized) ? [normalized] : [];
}

async function findCommandRuleMatch(
  cwd: string,
  command: string,
  rules: CompiledRule[],
): Promise<RuleHit | null> {
  const tokens = tokenizeBash(command);

  for (const token of tokens) {
    const candidates = extractPathCandidates(token);

    for (const candidate of candidates) {
      const match = await findPathRuleMatch(cwd, candidate, rules);
      if (match) return match;
    }
  }

  return null;
}

function toolDisplayName(tool: GuardedTool): string {
  if (tool === "read") return "read";
  if (tool === "write") return "write";
  if (tool === "edit") return "edit";
  return "bash";
}

function ruleRequirementReason(tool: GuardedTool, hit: RuleHit): string {
  if (hit.rule.reason) return hit.rule.reason;
  return `Approval required by File Guard rule (${toolDisplayName(tool)} -> ${hit.rule.source})`;
}

function blockReasonForHit(hit: RuleHit, config: FileGuardConfig): string {
  return `${config.blockReason} (matched rule: ${hit.rule.source}; target: ${hit.candidate})`;
}

interface ApprovalResult {
  action: ApprovalAction;
  denyReason?: string;
}

function userGateBlockReason(source: string, denyReason?: string): string {
  const base = `Blocked by user via File Guard gate (${source})`;
  if (!denyReason || denyReason.trim().length === 0) return base;
  return `${base}: ${denyReason.trim()}`;
}

async function showApprovalPrompt(
  ctx: ExtensionContext,
  tool: GuardedTool,
  target: string,
  reason: string,
): Promise<ApprovalResult | null> {
  const lines: OptionPickerLine[] = [
    { text: `Tool: ${toolDisplayName(tool)}`, tone: "text" },
    { text: `Target: ${target}`, tone: "text" },
    { text: `Reason: ${reason}`, tone: "muted" },
  ];

  const result = await showOptionPicker(ctx, {
    title: "File Guard approval required",
    lines,
    options: APPROVAL_OPTIONS,
    cancelAction: "deny",
  });

  if (!result) return null;

  if (result.action === "deny") {
    const trimmed = (result.notes.deny ?? "").trim();
    return {
      action: "deny",
      denyReason: trimmed.length > 0 ? trimmed : undefined,
    };
  }

  return { action: result.action };
}

async function evaluateGate(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  tool: GuardedTool,
  hit: RuleHit,
  config: FileGuardConfig,
): Promise<{ block: true; reason: string } | undefined> {
  const requirementReason = ruleRequirementReason(tool, hit);
  const onNoUi = hit.rule.onNoUi ?? config.defaults.onNoUi;

  if (!ctx.hasUI) {
    if (onNoUi === "allow") return undefined;
    return {
      block: true,
      reason: `Blocked by File Guard gate: ${requirementReason} (approval required but no UI is available)`,
    };
  }

  pi.events.emit(CRUMBS_EVENT_USER_INPUT_REQUIRED, undefined);
  const approval = await showApprovalPrompt(ctx, tool, hit.candidate, requirementReason);

  if (!approval) {
    return {
      block: true,
      reason: `Blocked by File Guard gate: ${requirementReason} (approval prompt did not complete)`,
    };
  }

  if (approval.action === "allow-once") {
    return undefined;
  }

  return {
    block: true,
    reason: userGateBlockReason(hit.rule.source, approval.denyReason),
  };
}

function isPathTool(toolName: string): toolName is "read" | "write" | "edit" {
  return toolName === "read" || toolName === "write" || toolName === "edit";
}

function formatRuleEntries(entries: RuleEntry[] | undefined): string {
  if (!entries || entries.length === 0) return "(none)";
  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return entry.match;
    })
    .join(", ");
}

function buildPolicyReminder(config: FileGuardConfig): string {
  const gate = config.rules.gate;

  return [
    "File Guard policy (from .pi/crumbs.json:fileGuard):",
    "- Hard-blocked rules:",
    `  - ${formatRuleEntries(config.rules.block)}`,
    "- Approval-gated rules:",
    `  - read: ${formatRuleEntries(gate.read)}`,
    `  - mutate (edit+write): ${formatRuleEntries(gate.mutate)}`,
    `  - edit: ${formatRuleEntries(gate.edit)}`,
    `  - write: ${formatRuleEntries(gate.write)}`,
    `  - bash: ${formatRuleEntries(gate.bash)}`,
    `- Hard-block reason: ${config.blockReason}`,
    `- Gate default onNoUi policy: ${config.defaults.onNoUi}`,
  ].join("\n");
}

function buildPathGroupSummary(groups: Record<string, string[]>): string {
  const names = Object.keys(groups);
  if (names.length === 0) return "(none)";

  return names
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `@${name}: ${groups[name].join(", ") || "(empty)"}`)
    .join("\n");
}

export default function fileGuardExtension(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    const config = await loadFileGuardConfig(process.cwd());
    if (!config.injectPromptReminder) return undefined;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildPolicyReminder(config)}`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    const config = await loadFileGuardConfig(ctx.cwd);
    const rules = await buildGuardRules(ctx.cwd, config);
    const input = event.input as Record<string, unknown>;

    if (isPathTool(event.toolName)) {
      const toolPath = input.path;
      if (typeof toolPath !== "string") return undefined;

      const blockHit = await findPathRuleMatch(ctx.cwd, toolPath, rules.block);
      if (blockHit) {
        return {
          block: true,
          reason: blockReasonForHit(blockHit, config),
        };
      }

      const gateHit = await findPathRuleMatch(ctx.cwd, toolPath, rules.gate[event.toolName]);
      if (!gateHit) return undefined;

      return evaluateGate(pi, ctx, event.toolName, gateHit, config);
    }

    if (event.toolName === "bash") {
      const command = input.command;
      if (typeof command !== "string") return undefined;

      const blockHit = await findCommandRuleMatch(ctx.cwd, command, rules.block);
      if (blockHit) {
        return {
          block: true,
          reason: blockReasonForHit(blockHit, config),
        };
      }

      const gateHit = await findCommandRuleMatch(ctx.cwd, command, rules.gate.bash);
      if (!gateHit) return undefined;

      return evaluateGate(pi, ctx, "bash", gateHit, config);
    }

    return undefined;
  });

  pi.registerCommand("file-guard-list", {
    description: "Show File Guard grouped config loaded from .pi/crumbs.json",
    handler: async (_args, ctx) => {
      const config = await loadFileGuardConfig(ctx.cwd);
      const gate = config.rules.gate;

      const lines = [
        "File Guard config (.pi/crumbs.json:fileGuard)",
        "",
        "Path groups:",
        buildPathGroupSummary(config.paths),
        "",
        `Block: ${formatRuleEntries(config.rules.block)}`,
        `Gate read: ${formatRuleEntries(gate.read)}`,
        `Gate mutate: ${formatRuleEntries(gate.mutate)}`,
        `Gate edit: ${formatRuleEntries(gate.edit)}`,
        `Gate write: ${formatRuleEntries(gate.write)}`,
        `Gate bash: ${formatRuleEntries(gate.bash)}`,
        "",
        `Block reason: ${config.blockReason}`,
        `Default gate onNoUi: ${config.defaults.onNoUi}`,
      ];

      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
