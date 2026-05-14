import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getGlobalCrumbsPath, getProjectCrumbsPath } from "../../shared/config/crumbs-paths.js";
import { asObject, type JsonObject, writeJsonObject } from "../../shared/io/json-file.js";

const execFileAsync = promisify(execFile);

type JsonStatus =
  | { exists: false; path: string }
  | { exists: true; path: string; ok: true; value: JsonObject }
  | { exists: true; path: string; ok: false; error: string };

type Finding =
  | { kind: "malformed-json"; filePath: string; error: string }
  | { kind: "type-conflict"; filePath: string; keyPath: string; expected: string; actual: string };

const FALLBACK_SCHEMA_URL =
  "https://raw.githubusercontent.com/shanepadgett/crumbs/refs/heads/main/schemas/crumbs.schema.json";

const SCHEMA_RELATIVE_PATH = "schemas/crumbs.schema.json";

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
  { keyPath: "extensions.quietMiseTask", expected: "object", validate: expectsObject },
  { keyPath: "extensions.statusTable", expected: "object", validate: expectsObject },
  { keyPath: "extensions.statusTable.enabled", expected: "boolean", validate: expectsBoolean },
  {
    keyPath: "extensions.statusTable.mode",
    expected: "full|minimal",
    validate: expectsStringEnum(["full", "minimal"]),
  },
  { keyPath: "extensions.codexCompat", expected: "object", validate: expectsObject },
  { keyPath: "extensions.codexCompat.fast", expected: "boolean", validate: expectsBoolean },
  { keyPath: "extensions.commit", expected: "object", validate: expectsObject },
  {
    keyPath: "extensions.commit.allowedTypes",
    expected: "string[]",
    validate: expectsStringArray,
  },
  {
    keyPath: "extensions.commit.allowBreakingChangeMarker",
    expected: "boolean",
    validate: expectsBoolean,
  },
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

async function readJsonObjectStrict(path: string): Promise<JsonObject> {
  const raw = await readFile(path, "utf8");
  return asObject(JSON.parse(raw)) ?? {};
}

async function findPackageRoot(): Promise<string | null> {
  let current = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 8; depth += 1) {
    const schemaPath = join(current, SCHEMA_RELATIVE_PATH);
    if (await fileExists(schemaPath)) return current;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout: 2000, encoding: "utf8" });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function githubPathFromRemote(remote: string): string | null {
  const trimmed = remote.trim().replace(/\.git$/, "");

  const scpLike = trimmed.match(/^git@github\.com:(.+\/.+)$/);
  if (scpLike?.[1]) return scpLike[1];

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") return null;
    const path = url.pathname.replace(/^\/+/, "");
    return path.split("/").length >= 2 ? path : null;
  } catch {
    return null;
  }
}

async function resolveGitHubSchemaUrl(packageRoot: string): Promise<string | null> {
  const remote = await runGit(packageRoot, ["remote", "get-url", "origin"]);
  if (!remote) return null;

  const githubPath = githubPathFromRemote(remote);
  if (!githubPath) return null;

  const branch = await runGit(packageRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch && branch !== "HEAD") {
    return `https://raw.githubusercontent.com/${githubPath}/refs/heads/${branch}/${SCHEMA_RELATIVE_PATH}`;
  }

  const tag = await runGit(packageRoot, ["describe", "--tags", "--exact-match"]);
  if (tag) {
    return `https://raw.githubusercontent.com/${githubPath}/refs/tags/${tag}/${SCHEMA_RELATIVE_PATH}`;
  }

  const commit = await runGit(packageRoot, ["rev-parse", "HEAD"]);
  if (commit)
    return `https://raw.githubusercontent.com/${githubPath}/${commit}/${SCHEMA_RELATIVE_PATH}`;

  return null;
}

async function resolveSchemaUrlFromPackageRoot(): Promise<string | null> {
  const packageRoot = await findPackageRoot();
  if (!packageRoot) return null;

  const githubUrl = await resolveGitHubSchemaUrl(packageRoot);
  if (githubUrl) return githubUrl;

  const schemaPath = join(packageRoot, SCHEMA_RELATIVE_PATH);
  return pathToFileURL(schemaPath).href;
}

async function resolveSchemaUrlFromPiSettings(cwd: string): Promise<string> {
  const packageSchemaUrl = await resolveSchemaUrlFromPackageRoot();
  if (packageSchemaUrl) return packageSchemaUrl;

  const candidateSettingsPaths = [
    join(homedir(), ".pi", "agent", "settings.json"),
    join(await getProjectCrumbsPath(cwd), "..", "settings.json"),
  ];

  for (const settingsPath of candidateSettingsPaths) {
    if (!(await fileExists(settingsPath))) continue;

    let settings: JsonObject;
    try {
      settings = await readJsonObjectStrict(settingsPath);
    } catch {
      continue;
    }

    const packagesValue = settings.packages;
    if (!Array.isArray(packagesValue)) continue;

    for (const entry of packagesValue) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const source = (entry as Record<string, unknown>).source;
      if (typeof source !== "string" || source.trim().length === 0) continue;

      const sourcePath = isAbsolute(source) ? source : resolve(dirname(settingsPath), source);
      const schemaPath = join(sourcePath, SCHEMA_RELATIVE_PATH);
      if (!(await fileExists(schemaPath))) continue;
      return pathToFileURL(schemaPath).href;
    }
  }

  return FALLBACK_SCHEMA_URL;
}

async function initProjectCrumbs(
  cwd: string,
  force: boolean,
): Promise<{ created: boolean; path: string }> {
  const projectCrumbsPath = await getProjectCrumbsPath(cwd);

  if (!force && (await fileExists(projectCrumbsPath))) {
    return { created: false, path: projectCrumbsPath };
  }

  const schemaUrl = await resolveSchemaUrlFromPiSettings(cwd);
  await writeJsonObject(projectCrumbsPath, {
    $schema: schemaUrl,
    extensions: {},
  });

  return { created: true, path: projectCrumbsPath };
}

export default function crumbsDoctorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("crumbs", {
    description: "Crumbs utilities. Usage: /crumbs doctor | /crumbs init [--force]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim();
      const options = ["doctor", "init"];
      const filtered = options.filter((option) => option.startsWith(value));
      return filtered.length > 0
        ? filtered.map((option) => ({ value: option, label: option }))
        : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);

      try {
        if (tokens[0] === "doctor") {
          const { findings } = await inspect(ctx.cwd);
          const report = renderReport(findings);
          if (ctx.hasUI) ctx.ui.notify(report, findings.length > 0 ? "warning" : "info");
          return;
        }

        if (tokens[0] === "init") {
          const force = tokens.includes("--force");
          const { created, path } = await initProjectCrumbs(ctx.cwd, force);
          if (!ctx.hasUI) return;
          if (!created) {
            ctx.ui.notify(
              `crumbs init skipped: ${path} already exists. Use /crumbs init --force to overwrite.`,
              "warning",
            );
            return;
          }
          ctx.ui.notify(`crumbs init wrote ${path}`, "info");
          return;
        }

        if (ctx.hasUI) ctx.ui.notify("Usage: /crumbs doctor | /crumbs init [--force]", "warning");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`[crumbs-doctor] failed: ${message}`, "error");
      }
    },
  });
}
