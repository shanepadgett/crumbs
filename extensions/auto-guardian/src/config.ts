import { loadEffectiveExtensionConfig } from "../../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../../shared/io/json-file.js";
import { globToRegExp } from "./paths.js";
import type { AutoGuardianConfig, CompiledPattern, GuardianModelRef } from "./types.js";

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

export const DEFAULT_BASH_DENY_PATTERNS = [
  String.raw`:\s*\(\s*\)\s*\{.*\|\s*:`,
  String.raw`\bmkfs[\.\s]`,
  String.raw`\bdd\b[^\n]*\bof=/dev/`,
  String.raw`>\s*/dev/(sd|nvme|disk)`,
  String.raw`\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+/(\s|$)`,
];

export const DEFAULT_BASH_PROMPT_PATTERNS = [
  String.raw`\bsudo\b`,
  String.raw`\b(chmod|chown)\b[^\n]*\b777\b`,
  String.raw`\bgit\s+push\b[^\n]*--force`,
  String.raw`\b(curl|wget)\b[^\n]*\|\s*(sh|bash)`,
  String.raw`>\s*/etc/`,
  String.raw`\brm\s+-[A-Za-z]*r`,
];

export const DEFAULT_PROTECTED_PATHS = [".git", ".git/**"];

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

function compileRegexRules(
  sources: string[],
  label: string,
  notify?: WarningNotifier,
): CompiledPattern[] {
  const rules: CompiledPattern[] = [];
  for (const source of sources) {
    try {
      rules.push({ source, regex: new RegExp(source, "i") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify?.(`auto-guardian: invalid ${label} regex skipped: ${source} (${message})`);
    }
  }
  return rules;
}

function compileProtectedPathRules(sources: string[]): CompiledPattern[] {
  return sources.map((source) => ({ source, regex: globToRegExp(source) }));
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
    notify?.(`auto-guardian: guardian.model must use provider/id; ignoring ${raw}`);
    return undefined;
  }

  return { provider, id, raw };
}

export function parseAutoGuardianConfig(
  rawConfig: JsonObject,
  notify?: WarningNotifier,
): AutoGuardianConfig {
  const root = asObject(rawConfig) ?? {};
  const bash = asObject(root.bash) ?? {};
  const mutation = asObject(root.mutation) ?? {};
  const guardian = asObject(root.guardian) ?? {};

  const ignoreTools = asStringArray(root.ignoreTools, DEFAULT_IGNORE_TOOLS);
  const protectedPaths = asStringArray(mutation.protectedPaths, DEFAULT_PROTECTED_PATHS);

  return {
    mode: asEnum(root.mode, ["off", "gate"], "gate"),
    ignoreTools,
    ignoreToolSet: new Set(ignoreTools),
    bash: {
      defaultAction: asEnum(bash.defaultAction, ["allow", "prompt"], "allow"),
      denyPatterns: compileRegexRules(
        asStringArray(bash.denyPatterns, DEFAULT_BASH_DENY_PATTERNS),
        "bash.denyPatterns",
        notify,
      ),
      promptPatterns: compileRegexRules(
        asStringArray(bash.promptPatterns, DEFAULT_BASH_PROMPT_PATTERNS),
        "bash.promptPatterns",
        notify,
      ),
      allowPatterns: compileRegexRules(
        asStringArray(bash.allowPatterns, []),
        "bash.allowPatterns",
        notify,
      ),
    },
    mutation: {
      defaultAction: asEnum(mutation.defaultAction, ["allow", "prompt"], "allow"),
      protectedPaths,
      protectedPathRules: compileProtectedPathRules(protectedPaths),
      allowOutsideWorkspace: asBoolean(mutation.allowOutsideWorkspace, false),
      maxBytes: asOptionalNonNegativeNumber(mutation.maxBytes),
    },
    unknownToolAction: asEnum(root.unknownToolAction, ["allow", "prompt", "block"], "prompt"),
    guardian: {
      enabled: asBoolean(guardian.enabled, false),
      model: parseGuardianModel(guardian.model, notify),
      reviewBash: asBoolean(guardian.reviewBash, true),
      reviewMutations: asBoolean(guardian.reviewMutations, false),
      timeoutMs: asPositiveNumber(guardian.timeoutMs, 15_000),
      maxTokens: asPositiveNumber(guardian.maxTokens, 256),
    },
  };
}

export function createDefaultAutoGuardianConfig(): AutoGuardianConfig {
  return parseAutoGuardianConfig({});
}

export async function loadAutoGuardianConfig(
  cwd: string,
  notify?: WarningNotifier,
): Promise<AutoGuardianConfig> {
  return parseAutoGuardianConfig(await loadEffectiveExtensionConfig(cwd, "autoGuardian"), notify);
}
