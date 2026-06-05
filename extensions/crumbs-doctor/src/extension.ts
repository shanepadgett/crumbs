import { access, mkdir, readFile, rename } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  getGlobalCrumbsPath,
  getGlobalCrumbsReadPaths,
  getLegacyGlobalCrumbsPath,
  getLegacyProjectCrumbsPathForRoot,
  getProjectCrumbsPath,
  getProjectCrumbsReadPaths,
} from "../../shared/config/crumbs-paths.js";
import { resolveProjectRoot } from "../../shared/config/project-root.js";
import {
  getDefaultGlobalMcpPath,
  getDefaultGlobalSubagentsDir,
  getDefaultProjectMcpPath,
  getDefaultProjectSubagentsDir,
  getLegacyGlobalMcpPath,
  getLegacyGlobalSubagentsDir,
  getLegacyProjectMcpPath,
  getLegacyProjectSubagentsDir,
} from "../../shared/config/crumbs-runtime-paths.js";
import { asObject, type JsonObject, writeJsonObject } from "../../shared/io/json-file.js";
import { notifyForSessionStart } from "../../shared/ui/notify.js";

const execFileAsync = promisify(execFile);

type JsonStatus =
  | { exists: false; path: string }
  | { exists: true; path: string; ok: true; value: JsonObject }
  | { exists: true; path: string; ok: false; error: string };

type Finding =
  | { kind: "malformed-json"; filePath: string; error: string }
  | { kind: "type-conflict"; filePath: string; keyPath: string; expected: string; actual: string }
  | {
      kind: "legacy-location";
      label: string;
      legacyPath: string;
      defaultPath: string;
    }
  | {
      kind: "legacy-pair";
      level: "global" | "project";
      legacyPath: string;
      defaultPath: string;
    }
  | {
      kind: "legacy-conflict";
      level: "global" | "project";
      legacyPath: string;
      defaultPath: string;
      keyPath: string;
    };

const FALLBACK_SCHEMA_URL =
  "https://raw.githubusercontent.com/shanepadgett/crumbs/refs/heads/main/schemas/crumbs.schema.json";

const SCHEMA_RELATIVE_PATH = "schemas/crumbs.schema.json";

interface MigrationItem {
  label: string;
  legacyPath: string;
  defaultPath: string;
  validateJson?: boolean;
}

interface MigrationResult {
  label: string;
  legacyPath: string;
  defaultPath: string;
  status: "moved" | "skipped" | "blocked";
  message: string;
}

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

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function collectConflictingKeyPaths(
  legacy: JsonObject,
  defaultConfig: JsonObject,
  prefix = "",
): string[] {
  const conflicts: string[] = [];

  for (const key of Object.keys(legacy)) {
    if (!(key in defaultConfig)) continue;

    const keyPath = prefix ? `${prefix}.${key}` : key;
    const legacyValue = legacy[key];
    const defaultValue = defaultConfig[key];
    const legacyObject = asObject(legacyValue);
    const defaultObject = asObject(defaultValue);

    if (legacyObject && defaultObject) {
      conflicts.push(...collectConflictingKeyPaths(legacyObject, defaultObject, keyPath));
      continue;
    }

    if (stableJson(legacyValue) !== stableJson(defaultValue)) conflicts.push(keyPath);
  }

  return conflicts;
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

async function getMigrationItems(cwd: string): Promise<MigrationItem[]> {
  const projectRoot = await resolveProjectRoot(cwd);
  return [
    {
      label: "global root .agents crumbs config",
      legacyPath: join(homedir(), ".agents", "crumbs.json"),
      defaultPath: getGlobalCrumbsPath(),
      validateJson: true,
    },
    {
      label: "global crumbs config",
      legacyPath: getLegacyGlobalCrumbsPath(),
      defaultPath: getGlobalCrumbsPath(),
      validateJson: true,
    },
    {
      label: "project root .agents crumbs config",
      legacyPath: join(projectRoot, ".agents", "crumbs.json"),
      defaultPath: await getProjectCrumbsPath(cwd),
      validateJson: true,
    },
    {
      label: "project crumbs config",
      legacyPath: getLegacyProjectCrumbsPathForRoot(projectRoot),
      defaultPath: await getProjectCrumbsPath(cwd),
      validateJson: true,
    },
    {
      label: "global subagents",
      legacyPath: getLegacyGlobalSubagentsDir(),
      defaultPath: getDefaultGlobalSubagentsDir(),
    },
    {
      label: "project subagents",
      legacyPath: getLegacyProjectSubagentsDir(projectRoot),
      defaultPath: getDefaultProjectSubagentsDir(projectRoot),
    },
    {
      label: "global MCP config",
      legacyPath: getLegacyGlobalMcpPath(),
      defaultPath: getDefaultGlobalMcpPath(),
      validateJson: true,
    },
    {
      label: "project MCP config",
      legacyPath: getLegacyProjectMcpPath(projectRoot),
      defaultPath: getDefaultProjectMcpPath(projectRoot),
      validateJson: true,
    },
  ];
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
    ...getGlobalCrumbsReadPaths().map((path) => readJsonStatus(path)),
    ...(await getProjectCrumbsReadPaths(cwd)).map((path) => readJsonStatus(path)),
  ]);

  const hasGlobalCrumbs = crumbsStatuses.some(
    (status) => status.path === globalCrumbsPath && status.exists,
  );
  const hasProjectCrumbs = crumbsStatuses.some(
    (status) => status.path === projectCrumbsPath && status.exists,
  );

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

  const projectRoot = await resolveProjectRoot(cwd);
  const legacyProjectCrumbsPath = getLegacyProjectCrumbsPathForRoot(projectRoot);
  for (const item of await getMigrationItems(cwd)) {
    if (!(await fileExists(item.legacyPath))) continue;
    findings.push({ kind: "legacy-location", ...item });
  }

  const conflictPairs: Array<{
    level: "global" | "project";
    legacyPath: string;
    defaultPath: string;
  }> = [
    {
      level: "global",
      legacyPath: getLegacyGlobalCrumbsPath(),
      defaultPath: globalCrumbsPath,
    },
    {
      level: "project",
      legacyPath: legacyProjectCrumbsPath,
      defaultPath: projectCrumbsPath,
    },
  ];

  for (const pair of conflictPairs) {
    const legacy = crumbsStatuses.find((status) => status.path === pair.legacyPath);
    const defaultStatus = crumbsStatuses.find((status) => status.path === pair.defaultPath);
    if (!legacy?.exists || !defaultStatus?.exists) continue;

    findings.push({ kind: "legacy-pair", ...pair });
    if (!legacy.ok || !defaultStatus.ok) continue;

    for (const keyPath of collectConflictingKeyPaths(legacy.value, defaultStatus.value)) {
      findings.push({ kind: "legacy-conflict", ...pair, keyPath });
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

    if (finding.kind === "type-conflict") {
      lines.push(
        `- type conflict: ${finding.keyPath} expected ${finding.expected}, got ${finding.actual} @ ${finding.filePath}`,
      );
      continue;
    }

    if (finding.kind === "legacy-location") {
      lines.push(
        `- legacy location: ${finding.label} uses ${finding.legacyPath}; move to ${finding.defaultPath}`,
      );
      continue;
    }

    if (finding.kind === "legacy-pair") {
      lines.push(
        `- legacy crumbs pair: ${finding.level} has both ${finding.defaultPath} and ${finding.legacyPath}`,
      );
      continue;
    }

    lines.push(
      `- legacy conflict: ${finding.level} ${finding.keyPath} differs; ${finding.defaultPath} overrides ${finding.legacyPath}`,
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
  if (findings.some((item) => item.kind === "legacy-conflict")) {
    lines.push(
      "- Move wanted legacy values into .agents/crumbs/crumbs.json, then remove legacy crumbs file.",
    );
  }
  if (findings.some((item) => item.kind === "legacy-pair")) {
    lines.push("- Prefer one crumbs file per level; .agents/crumbs/crumbs.json is default.");
  }
  if (findings.some((item) => item.kind === "legacy-location")) {
    lines.push(
      "- Legacy crumbs-owned locations are supported now but will be removed in a future update.",
    );
    lines.push("- Run /crumbs doctor fix to move legacy files and directories when safe.");
  }

  return lines.join("\n");
}

async function migrateItem(item: MigrationItem): Promise<MigrationResult> {
  if (!(await fileExists(item.legacyPath))) {
    return { ...item, status: "skipped", message: "legacy path missing" };
  }
  if (await fileExists(item.defaultPath)) {
    return { ...item, status: "blocked", message: "default path already exists; merge manually" };
  }
  if (item.validateJson) {
    const status = await readJsonStatus(item.legacyPath);
    if (!status.exists) return { ...item, status: "skipped", message: "legacy path missing" };
    if (!status.ok)
      return { ...item, status: "blocked", message: `malformed JSON: ${status.error}` };
  }

  await mkdir(dirname(item.defaultPath), { recursive: true });
  await rename(item.legacyPath, item.defaultPath);
  return { ...item, status: "moved", message: "moved" };
}

async function migrateLegacyLocations(cwd: string): Promise<MigrationResult[]> {
  const items = await getMigrationItems(cwd);
  const results: MigrationResult[] = [];
  for (const item of items) results.push(await migrateItem(item));
  return results;
}

function renderMigrationReport(results: MigrationResult[]): string {
  const lines = ["crumbs doctor fix"];
  const shown = results.filter((result) => result.status !== "skipped");

  if (shown.length === 0) {
    lines.push("No legacy crumbs-owned paths found.");
    return lines.join("\n");
  }

  for (const result of shown) {
    lines.push(`- ${result.status}: ${result.label}`);
    lines.push(`  ${result.legacyPath} -> ${result.defaultPath}`);
    lines.push(`  ${result.message}`);
  }

  if (shown.some((result) => result.status === "blocked")) {
    lines.push("");
    lines.push("Blocked items were not moved. Merge manually, then remove legacy path.");
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

  const projectRoot = await resolveProjectRoot(cwd);

  const candidateSettingsPaths = [
    join(homedir(), ".pi", "agent", "settings.json"),
    join(projectRoot, ".pi", "settings.json"),
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

async function updateProjectCrumbsSchema(
  cwd: string,
): Promise<{ updated: boolean; path: string; schemaUrl: string }> {
  const projectCrumbsPath = await getProjectCrumbsPath(cwd);
  const schemaUrl = await resolveSchemaUrlFromPiSettings(cwd);

  if (!(await fileExists(projectCrumbsPath))) {
    return { updated: false, path: projectCrumbsPath, schemaUrl };
  }

  const config = await readJsonObjectStrict(projectCrumbsPath);
  config.$schema = schemaUrl;
  await writeJsonObject(projectCrumbsPath, config);

  return { updated: true, path: projectCrumbsPath, schemaUrl };
}

export default function crumbsDoctorExtension(pi: ExtensionAPI): void {
  let launchWarningShown = false;

  pi.on("session_start", async (event, ctx) => {
    if (launchWarningShown || (event.reason !== "startup" && event.reason !== "reload")) return;

    let findings: Finding[];
    try {
      findings = (await inspect(ctx.cwd)).findings;
    } catch {
      return;
    }

    if (!findings.some((finding) => finding.kind === "legacy-location")) return;

    launchWarningShown = true;
    notifyForSessionStart(
      ctx,
      event.reason,
      "Legacy crumbs-owned locations found. Move to .agents/crumbs; legacy locations will be removed in a future update. Run /crumbs doctor.",
      "warning",
    );
  });

  pi.registerCommand("crumbs", {
    description:
      "Crumbs utilities. Usage: /crumbs doctor [fix] | /crumbs init [--force] | /crumbs schema",
    getArgumentCompletions(prefix) {
      const value = prefix.trim();
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens[0] === "doctor") {
        const fixPrefix = tokens.length > 1 ? (tokens[1] ?? "") : "";
        return "fix".startsWith(fixPrefix) ? [{ value: "doctor fix", label: "fix" }] : null;
      }
      const options = ["doctor", "init", "schema"];
      const filtered = options.filter((option) => option.startsWith(value));
      return filtered.length > 0
        ? filtered.map((option) => ({ value: option, label: option }))
        : null;
    },
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);

      try {
        if (tokens[0] === "doctor") {
          if (tokens[1] && tokens[1] !== "fix") {
            if (ctx.hasUI) ctx.ui.notify("Usage: /crumbs doctor [fix]", "warning");
            return;
          }

          if (tokens[1] === "fix") {
            const results = await migrateLegacyLocations(ctx.cwd);
            if (ctx.hasUI)
              ctx.ui.notify(
                renderMigrationReport(results),
                results.some((result) => result.status === "blocked") ? "warning" : "info",
              );
            return;
          }

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

        if (tokens[0] === "schema") {
          const { updated, path, schemaUrl } = await updateProjectCrumbsSchema(ctx.cwd);
          if (!ctx.hasUI) return;
          if (!updated) {
            ctx.ui.notify(
              `crumbs schema skipped: ${path} does not exist. Use /crumbs init to create it.`,
              "warning",
            );
            return;
          }
          ctx.ui.notify(`crumbs schema updated ${path}\n${schemaUrl}`, "info");
          return;
        }

        if (ctx.hasUI)
          ctx.ui.notify(
            "Usage: /crumbs doctor [fix] | /crumbs init [--force] | /crumbs schema",
            "warning",
          );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (ctx.hasUI) ctx.ui.notify(`[crumbs-doctor] failed: ${message}`, "error");
      }
    },
  });
}
