import { loadEffectiveExtensionConfig } from "../../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../../shared/io/json-file.js";
import { globToRegExp } from "./paths.js";
import type {
  BashRule,
  ConfigAction,
  GuardianConfig,
  GuardianModelRef,
  MutationRule,
} from "./types.js";

type WarningNotifier = (message: string) => void;

export const DEFAULT_IGNORE_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "websearch",
  "webfetch",
  "codesearch",
  "view_image",
  "subagent",
];

export const DEFAULT_BASH_RULES: Array<{ match: string; action: ConfigAction }> = [
  { match: ":(){*|*:", action: "block" },
  { match: "mkfs*", action: "block" },
  { match: "dd *of=/dev/*", action: "block" },
  { match: "*> /dev/sd*", action: "block" },
  { match: "*> /dev/nvme*", action: "block" },
  { match: "*> /dev/disk*", action: "block" },
  { match: "rm -rf /", action: "block" },
  { match: "rm -fr /", action: "block" },
  { match: "sudo *", action: "prompt" },
  { match: "chmod *777*", action: "prompt" },
  { match: "chown *777*", action: "prompt" },
  { match: "git push *--force*", action: "prompt" },
  { match: "curl *| sh*", action: "prompt" },
  { match: "curl *| bash*", action: "prompt" },
  { match: "wget *| sh*", action: "prompt" },
  { match: "wget *| bash*", action: "prompt" },
  { match: "*> /etc/*", action: "prompt" },
  { match: "rm -r *", action: "prompt" },
  { match: "rm -rf *", action: "prompt" },
  { match: "rm -fr *", action: "prompt" },
];

export const DEFAULT_MUTATION_RULES: Array<{ paths: string[]; action: ConfigAction }> = [
  { paths: [".git", ".git/**"], action: "block" },
];

const CONFIG_ACTIONS = ["allow", "prompt", "autoApprove", "block"] as const;

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function asOptionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function commandGlobToRegExp(glob: string): RegExp {
  let source = "^";
  for (const char of normalizeCommand(glob)) {
    source += char === "*" ? ".*" : char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "i");
}

function parseBashRules(rawRules: unknown, notify?: WarningNotifier): BashRule[] {
  const sourceRules = Array.isArray(rawRules) ? rawRules : DEFAULT_BASH_RULES;
  const rules: BashRule[] = [];
  for (const rawRule of sourceRules) {
    const rule = asObject(rawRule);
    const source = typeof rule?.match === "string" ? rule.match.trim() : "";
    if (!source) continue;
    try {
      rules.push({
        source,
        regex: commandGlobToRegExp(source),
        action: asEnum(rule?.action, CONFIG_ACTIONS, "prompt"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify?.(`guardian: invalid bash rule skipped: ${source} (${message})`);
    }
  }
  return rules;
}

function compilePathRules(sources: string[]) {
  return sources.map((source) => ({ source, regex: globToRegExp(source) }));
}

function parseMutationRules(rawRules: unknown): MutationRule[] {
  const sourceRules = Array.isArray(rawRules) ? rawRules : DEFAULT_MUTATION_RULES;
  const rules: MutationRule[] = [];
  for (const rawRule of sourceRules) {
    const rule = asObject(rawRule);
    const paths = asStringArray(rule?.paths, []);
    if (paths.length === 0) continue;
    rules.push({
      paths,
      pathRules: compilePathRules(paths),
      action: asEnum(rule?.action, CONFIG_ACTIONS, "prompt"),
    });
  }
  return rules;
}

function parseGuardianModel(
  value: unknown,
  notify?: WarningNotifier,
): GuardianModelRef | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;

  const separator = raw.indexOf("/");
  const provider = separator > 0 ? raw.slice(0, separator).trim() : "";
  const id = separator > 0 ? raw.slice(separator + 1).trim() : "";
  if (!provider || !id) {
    notify?.(`guardian: autoApprove.model must use provider/id; ignoring ${raw}`);
    return undefined;
  }

  return { provider, id, raw };
}

export function parseGuardianConfig(
  rawConfig: JsonObject,
  notify?: WarningNotifier,
): GuardianConfig {
  const root = asObject(rawConfig) ?? {};
  const bash = asObject(root.bash) ?? {};
  const mutation = asObject(root.mutation) ?? {};
  const autoApprove = asObject(root.autoApprove) ?? {};

  const ignoreTools = asStringArray(root.ignoreTools, DEFAULT_IGNORE_TOOLS);
  const mutationRules = parseMutationRules(mutation.rules);

  return {
    mode: asEnum(root.mode, ["off", "gate"], "gate"),
    ignoreTools,
    ignoreToolSet: new Set(ignoreTools),
    bash: {
      defaultAction: asEnum(bash.defaultAction, CONFIG_ACTIONS, "autoApprove"),
      rules: parseBashRules(bash.rules, notify),
    },
    mutation: {
      defaultAction: asEnum(mutation.defaultAction, CONFIG_ACTIONS, "allow"),
      rules: mutationRules,
      blockPathRules: mutationRules
        .filter((rule) => rule.action === "block")
        .flatMap((rule) => rule.pathRules),
      allowOutsideWorkspace: asBoolean(mutation.allowOutsideWorkspace, false),
      maxBytes: asOptionalNonNegativeNumber(mutation.maxBytes),
    },
    unknownToolAction: asEnum(root.unknownToolAction, CONFIG_ACTIONS, "prompt"),
    autoApprove: {
      enabled: asBoolean(autoApprove.enabled, true),
      model: parseGuardianModel(autoApprove.model, notify),
      reviewBash: asBoolean(autoApprove.reviewBash, true),
      reviewMutations: asBoolean(autoApprove.reviewMutations, true),
      timeoutMs: asPositiveNumber(autoApprove.timeoutMs, 15_000),
      maxTokens: asPositiveNumber(autoApprove.maxTokens, 256),
    },
  };
}

export function createDefaultGuardianConfig(): GuardianConfig {
  return parseGuardianConfig({});
}

export async function loadGuardianConfig(
  cwd: string,
  notify?: WarningNotifier,
): Promise<GuardianConfig> {
  return parseGuardianConfig(await loadEffectiveExtensionConfig(cwd, "guardian"), notify);
}
