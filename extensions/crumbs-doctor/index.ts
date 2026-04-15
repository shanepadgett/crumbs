/**
 * Crumbs Doctor Extension
 *
 * What it does:
 * - Adds `/crumbs doctor` to inspect crumbs settings health.
 * - Detects deprecated crumbs keys in Pi settings files.
 * - Detects malformed crumbs JSON and known-key type conflicts.
 * - Supports optional `--fix` for safe cleanup of deprecated Pi settings keys.
 *
 * How to use it:
 * - Run `/crumbs doctor` for report-only mode.
 * - Run `/crumbs doctor --fix` to remove deprecated crumbs keys from Pi settings.
 *
 * Example:
 * - `/crumbs doctor --fix`
 */

import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getGlobalCrumbsPath, getProjectCrumbsPath } from "../shared/config/crumbs-paths.js";
import { resolveProjectRoot } from "../shared/config/project-root.js";
import { asObject, writeJsonObject, type JsonObject } from "../shared/io/json-file.js";

const DEPRECATED_PI_SETTINGS_KEYS = [
  "crumbs-fast",
  "crumbs-caveman",
  "crumbs-focus",
  "crumbs-focus-advanced",
  "crumbs-status-table",
] as const;

type JsonStatus =
  | { exists: false; path: string }
  | { exists: true; path: string; ok: true; value: JsonObject }
  | { exists: true; path: string; ok: false; error: string };

type Finding =
  | { kind: "deprecated-key"; filePath: string; key: string }
  | { kind: "malformed-json"; filePath: string; error: string }
  | { kind: "type-conflict"; filePath: string; keyPath: string; expected: string; actual: string };

function typeOfValue(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function getAtPath(root: JsonObject, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = root;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function hasAtPath(root: JsonObject, path: string): boolean {
  const segments = path.split(".");
  let current: unknown = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!current || typeof current !== "object" || Array.isArray(current)) return false;
    const record = current as Record<string, unknown>;
    if (!(segment in record)) return false;
    current = record[segment];
  }

  return true;
}

function expectsBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

function expectsStringEnum(values: readonly string[]) {
  return (value: unknown): boolean => typeof value === "string" && values.includes(value);
}

function expectsStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function expectsObject(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const KNOWN_TYPE_RULES: Array<{
  keyPath: string;
  expected: string;
  validate: (value: unknown) => boolean;
}> = [
  { keyPath: "extensions.pathVisibility", expected: "object", validate: expectsObject },
  { keyPath: "extensions.focusAdvanced", expected: "object", validate: expectsObject },
  { keyPath: "extensions.quietMarkdownlint", expected: "object", validate: expectsObject },
  { keyPath: "extensions.quietMiseTask", expected: "object", validate: expectsObject },
  { keyPath: "extensions.quietXcodeBuild", expected: "object", validate: expectsObject },
  { keyPath: "extensions.statusTable", expected: "object", validate: expectsObject },
  { keyPath: "extensions.statusTable.enabled", expected: "boolean", validate: expectsBoolean },
  {
    keyPath: "extensions.statusTable.mode",
    expected: "full|minimal",
    validate: expectsStringEnum(["full", "minimal"]),
  },
  { keyPath: "extensions.codexCompat", expected: "object", validate: expectsObject },
  { keyPath: "extensions.codexCompat.fast", expected: "boolean", validate: expectsBoolean },
  { keyPath: "extensions.caveman", expected: "object", validate: expectsObject },
  { keyPath: "extensions.caveman.enabled", expected: "boolean", validate: expectsBoolean },
  {
    keyPath: "extensions.caveman.mode",
    expected: "minimal|improve",
    validate: expectsStringEnum(["minimal", "improve"]),
  },
  {
    keyPath: "extensions.pathVisibility.sessionFocus",
    expected: "object",
    validate: expectsObject,
  },
  {
    keyPath: "extensions.pathVisibility.sessionFocus.enabled",
    expected: "boolean",
    validate: expectsBoolean,
  },
  {
    keyPath: "extensions.pathVisibility.sessionFocus.mode",
    expected: "soft|hidden|hard",
    validate: expectsStringEnum(["soft", "hidden", "hard"]),
  },
  {
    keyPath: "extensions.pathVisibility.sessionFocus.roots",
    expected: "string[]",
    validate: expectsStringArray,
  },
  { keyPath: "extensions.focusAdvanced.sessionFocus", expected: "object", validate: expectsObject },
  {
    keyPath: "extensions.focusAdvanced.sessionFocus.enabled",
    expected: "boolean",
    validate: expectsBoolean,
  },
  {
    keyPath: "extensions.focusAdvanced.sessionFocus.mode",
    expected: "soft|hidden|hard",
    validate: expectsStringEnum(["soft", "hidden", "hard"]),
  },
  {
    keyPath: "extensions.focusAdvanced.sessionFocus.roots",
    expected: "string[]",
    validate: expectsStringArray,
  },
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonStatus(path: string): Promise<JsonStatus> {
  if (!(await fileExists(path))) return { exists: false, path };

  try {
    const raw = await readFile(path, "utf8");
    const value = asObject(JSON.parse(raw)) ?? {};
    return { exists: true, path, ok: true, value };
  } catch (error) {
    return {
      exists: true,
      path,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspect(
  cwd: string,
  fix: boolean,
): Promise<{
  findings: Finding[];
  fixes: string[];
  hasGlobalCrumbs: boolean;
  hasProjectCrumbs: boolean;
}> {
  const findings: Finding[] = [];
  const fixes: string[] = [];

  const projectRoot = await resolveProjectRoot(cwd);
  const projectCrumbsPath = await getProjectCrumbsPath(cwd);
  const globalCrumbsPath = getGlobalCrumbsPath();
  const projectPiSettingsPath = join(projectRoot, ".pi", "settings.json");
  const globalPiSettingsPath = join(homedir(), ".pi", "agent", "settings.json");

  const [projectPiSettings, globalPiSettings] = await Promise.all([
    readJsonStatus(projectPiSettingsPath),
    readJsonStatus(globalPiSettingsPath),
  ]);

  for (const source of [projectPiSettings, globalPiSettings]) {
    if (!source.exists || !source.ok) continue;

    const keysToRemove: string[] = [];
    for (const key of DEPRECATED_PI_SETTINGS_KEYS) {
      if (!(key in source.value)) continue;
      findings.push({ kind: "deprecated-key", filePath: source.path, key });
      keysToRemove.push(key);
    }

    if (fix && keysToRemove.length > 0) {
      const next = { ...source.value };
      for (const key of keysToRemove) delete next[key];
      await writeJsonObject(source.path, next);
      fixes.push(`removed deprecated keys from ${source.path}`);
    }
  }

  const crumbsStatuses = await Promise.all([
    readJsonStatus(globalCrumbsPath),
    readJsonStatus(projectCrumbsPath),
  ]);

  const hasGlobalCrumbs = crumbsStatuses[0]?.exists === true;
  const hasProjectCrumbs = crumbsStatuses[1]?.exists === true;

  for (const status of crumbsStatuses) {
    if (!status.exists) continue;
    if (!status.ok) {
      findings.push({ kind: "malformed-json", filePath: status.path, error: status.error });
      continue;
    }

    for (const rule of KNOWN_TYPE_RULES) {
      if (!hasAtPath(status.value, rule.keyPath)) continue;
      const value = getAtPath(status.value, rule.keyPath);
      if (rule.validate(value)) continue;
      findings.push({
        kind: "type-conflict",
        filePath: status.path,
        keyPath: rule.keyPath,
        expected: rule.expected,
        actual: typeOfValue(value),
      });
    }
  }

  return { findings, fixes, hasGlobalCrumbs, hasProjectCrumbs };
}

function renderReport(findings: Finding[], fixes: string[], fixMode: boolean): string {
  const lines: string[] = [];
  lines.push("crumbs-doctor");

  if (findings.length === 0) {
    lines.push("No issues found.");
    if (fixMode) lines.push("No fixes applied.");
    return lines.join("\n");
  }

  lines.push(`Found ${findings.length} issue(s):`);

  for (const finding of findings) {
    if (finding.kind === "deprecated-key") {
      lines.push(`- deprecated key in Pi settings: ${finding.key} @ ${finding.filePath}`);
      continue;
    }

    if (finding.kind === "malformed-json") {
      lines.push(`- malformed crumbs json: ${finding.filePath}`);
      lines.push(`  error: ${finding.error}`);
      continue;
    }

    lines.push(
      `- type conflict: ${finding.keyPath} expected ${finding.expected}, got ${finding.actual} @ ${finding.filePath}`,
    );
  }

  lines.push("");
  lines.push("Suggested cleanup:");
  if (findings.some((item) => item.kind === "deprecated-key")) {
    lines.push(
      "- Run `/crumbs doctor --fix` to remove deprecated crumbs keys from Pi settings files.",
    );
  }
  if (findings.some((item) => item.kind === "malformed-json")) {
    lines.push("- Fix malformed JSON in listed crumbs files.");
  }
  if (findings.some((item) => item.kind === "type-conflict")) {
    lines.push("- Correct key types in crumbs files to match schema expectations.");
  }

  if (fixMode) {
    lines.push("");
    lines.push("Fixes applied:");
    if (fixes.length === 0) lines.push("- none");
    else for (const fix of fixes) lines.push(`- ${fix}`);
  }

  return lines.join("\n");
}

function renderStartupSummary(
  ctx: any,
  hasGlobalCrumbs: boolean,
  hasProjectCrumbs: boolean,
  hasIssues: boolean,
): string | null {
  if (!hasGlobalCrumbs && !hasProjectCrumbs) return null;

  const tint = (tone: string, text: string): string =>
    typeof ctx?.ui?.theme?.fg === "function" ? ctx.ui.theme.fg(tone, text) : text;

  const issueText = "issues detected (run /crumbs doctor)";
  const headerLabel = tint("mdHeading", "[Crumbs settings]");
  const issueLabel = hasIssues ? `  ${tint("warning", issueText)}` : "";

  const lines = [`${headerLabel}${issueLabel}`.replace(/^\s+/, "")];
  if (hasGlobalCrumbs) lines.push(tint("dim", " ~/.pi/agent/crumbs.json"));
  if (hasProjectCrumbs) lines.push(tint("dim", " .pi/crumbs.json"));
  return lines.join("\n");
}

export default function crumbsDoctorExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    if (!ctx.hasUI) return;

    const showSummary = async (): Promise<void> => {
      try {
        const result = await inspect(ctx.cwd, false);
        const summary = renderStartupSummary(
          ctx,
          result.hasGlobalCrumbs,
          result.hasProjectCrumbs,
          result.findings.length > 0,
        );
        if (summary) ctx.ui.notify(summary, "info");
      } catch {
        // ignore startup rendering failures; /crumbs doctor remains available
      }
    };

    // Defer notify one tick so ordering is stable with Pi startup/reload sections.
    // Also avoids reload chat rebuild wiping early notifications.
    setTimeout(() => {
      void showSummary();
    }, 0);
  });

  pi.registerCommand("crumbs", {
    description: "Crumbs utilities. Usage: /crumbs doctor [--fix]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim();
      const options = ["doctor", "doctor --fix"];
      const filtered = options.filter((option) => option.startsWith(value));
      return filtered.length > 0
        ? filtered.map((option) => ({ value: option, label: option }))
        : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);

      if (tokens[0] !== "doctor") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /crumbs doctor [--fix]", "warning");
        return;
      }

      const fix = tokens.includes("--fix");
      try {
        const { findings, fixes } = await inspect(ctx.cwd, fix);
        const report = renderReport(findings, fixes, fix);
        if (ctx.hasUI) ctx.ui.notify(report, findings.length > 0 ? "warning" : "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`[crumbs-doctor] failed: ${message}`, "error");
      }
    },
  });
}
