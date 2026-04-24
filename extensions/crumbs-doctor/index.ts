/**
 * Crumbs Doctor Extension
 *
 * What it does:
 * - Adds `/crumbs doctor` to inspect crumbs settings health.
 * - Detects malformed crumbs JSON and known-key type conflicts.
 *
 * How to use it:
 * - Run `/crumbs doctor` for report-only validation.
 *
 * Example:
 * - `/crumbs doctor`
 */

import { access, readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getGlobalCrumbsPath, getProjectCrumbsPath } from "../shared/config/crumbs-paths.js";
import { asObject, type JsonObject } from "../shared/io/json-file.js";

type JsonStatus =
  | { exists: false; path: string }
  | { exists: true; path: string; ok: true; value: JsonObject }
  | { exists: true; path: string; ok: false; error: string };

type Finding =
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
    keyPath: "extensions.caveman.powers",
    expected: "(improve|design)[]",
    validate: expectsStringArray,
  },
  {
    keyPath: "extensions.caveman.enhancements",
    expected: "(improve|design)[]",
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

async function inspect(cwd: string): Promise<{
  findings: Finding[];
  hasGlobalCrumbs: boolean;
  hasProjectCrumbs: boolean;
}> {
  const findings: Finding[] = [];

  const projectCrumbsPath = await getProjectCrumbsPath(cwd);
  const globalCrumbsPath = getGlobalCrumbsPath();

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

  return { findings, hasGlobalCrumbs, hasProjectCrumbs };
}

function renderReport(findings: Finding[]): string {
  const lines: string[] = [];
  lines.push("crumbs-doctor");

  if (findings.length === 0) {
    lines.push("No issues found.");
    return lines.join("\n");
  }

  lines.push(`Found ${findings.length} issue(s):`);

  for (const finding of findings) {
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
  if (findings.some((item) => item.kind === "malformed-json")) {
    lines.push("- Fix malformed JSON in listed crumbs files.");
  }
  if (findings.some((item) => item.kind === "type-conflict")) {
    lines.push("- Correct key types in crumbs files to match schema expectations.");
  }

  return lines.join("\n");
}

export default function crumbsDoctorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("crumbs", {
    description: "Crumbs utilities. Usage: /crumbs doctor",
    getArgumentCompletions(prefix) {
      const value = prefix.trim();
      const options = ["doctor"];
      const filtered = options.filter((option) => option.startsWith(value));
      return filtered.length > 0
        ? filtered.map((option) => ({ value: option, label: option }))
        : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);

      if (tokens[0] !== "doctor") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /crumbs doctor", "warning");
        return;
      }

      try {
        const { findings } = await inspect(ctx.cwd);
        const report = renderReport(findings);
        if (ctx.hasUI) ctx.ui.notify(report, findings.length > 0 ? "warning" : "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`[crumbs-doctor] failed: ${message}`, "error");
      }
    },
  });
}
