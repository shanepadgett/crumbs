import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import type { QuietValidatorDefinition, Snapshot } from "./core.js";
import { createFallbackFailureGroups } from "./core.js";
import { asBoolean, asRecord, readExtensionConfig } from "./config.js";

const SOURCE_EXTENSIONS = new Set([
  ".entitlements",
  ".h",
  ".m",
  ".mm",
  ".metal",
  ".plist",
  ".swift",
  ".xcconfig",
]);
const ROOT_PACKAGE_FILES = new Set(["Package.swift", "Package.resolved"]);
const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".git",
  ".pi",
  ".swiftpm",
  "DerivedData",
  "build",
  "node_modules",
]);

type XcodeConfig = { enabled: boolean; name: string };

type BuildSpec = {
  commandFlag: "-project" | "-workspace";
  path: string;
  scheme: string;
  sourceRoot: string;
  projectRoot: string;
  workspaceRoot: string | null;
};

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await fs.access(pathValue);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(cwd: string): Promise<XcodeConfig | null> {
  const extensions = await readExtensionConfig(cwd);
  const value = extensions?.quietXcodeBuild;
  if (typeof value === "string" && value.trim().length > 0)
    return { enabled: true, name: value.trim() };
  const config = asRecord(value);
  if (!config || typeof config.name !== "string" || config.name.trim().length === 0) return null;
  return { enabled: asBoolean(config.enabled, true), name: config.name.trim() };
}

async function resolveBuildSpec(cwd: string, config: XcodeConfig): Promise<BuildSpec | null> {
  const sourceRoot = join(cwd, config.name);
  const projectRoot = join(cwd, `${config.name}.xcodeproj`);
  const workspaceRoot = join(cwd, `${config.name}.xcworkspace`);
  const hasSourceRoot = await pathExists(sourceRoot);
  const hasProjectRoot = await pathExists(projectRoot);
  const hasWorkspaceRoot = await pathExists(workspaceRoot);
  if (!hasSourceRoot || !hasProjectRoot) return null;

  return {
    commandFlag: hasWorkspaceRoot ? "-workspace" : "-project",
    path: hasWorkspaceRoot ? `${config.name}.xcworkspace` : `${config.name}.xcodeproj`,
    scheme: config.name,
    sourceRoot: config.name,
    projectRoot: `${config.name}.xcodeproj`,
    workspaceRoot: hasWorkspaceRoot ? `${config.name}.xcworkspace` : null,
  };
}

async function scanDirectory(
  root: string,
  relativeRoot: string,
  snapshot: Snapshot,
  shouldTrackFile: (relativePath: string) => boolean,
): Promise<void> {
  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;
      const fullPath = join(currentPath, entry.name);
      const fileKey = relative(root, fullPath).replaceAll("\\", "/");
      if (!shouldTrackFile(fileKey)) continue;
      const stats = await fs.stat(fullPath);
      snapshot.set(fileKey, `${stats.size}:${stats.mtimeMs}`);
    }
  }

  await walk(join(root, relativeRoot));
}

function isTrackedSourceFile(pathValue: string): boolean {
  for (const extension of SOURCE_EXTENSIONS) {
    if (pathValue.endsWith(extension)) return true;
  }
  return false;
}

async function scanInputs(root: string, config: XcodeConfig): Promise<Snapshot> {
  const spec = await resolveBuildSpec(root, config);
  if (!spec) return new Map();

  const snapshot: Snapshot = new Map();
  await scanDirectory(root, spec.sourceRoot, snapshot, isTrackedSourceFile);
  await scanDirectory(root, spec.projectRoot, snapshot, () => true);
  if (spec.workspaceRoot) await scanDirectory(root, spec.workspaceRoot, snapshot, () => true);

  for (const fileName of ROOT_PACKAGE_FILES) {
    const fullPath = join(root, fileName);
    if (!(await pathExists(fullPath))) continue;
    const stats = await fs.stat(fullPath);
    snapshot.set(fileName, `${stats.size}:${stats.mtimeMs}`);
  }

  return snapshot;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function buildScript(spec: BuildSpec): string {
  const xcodebuildCommand = [
    "xcodebuild",
    spec.commandFlag,
    shellQuote(spec.path),
    "-scheme",
    shellQuote(spec.scheme),
    "-configuration",
    "Debug",
    "build",
    "-quiet",
  ].join(" ");

  return [
    `tmp_dir="\${TMPDIR:-${tmpdir()}}"`,
    'mkdir -p "$tmp_dir"',
    'tmp_dir="${tmp_dir%/}"',
    'log_file="$(mktemp "$tmp_dir/pi-xcode-build.XXXXXX")"',
    `if ${xcodebuildCommand} >"$log_file" 2>&1; then`,
    '  echo "BUILD SUCCEEDED"',
    "else",
    '  echo "BUILD FAILED: $log_file"',
    '  tail -n 80 "$log_file"',
    "  exit 1",
    "fi",
  ].join("\n");
}

async function canRunXcodeBuild(pi: any, signal?: AbortSignal): Promise<boolean> {
  const result = await pi.exec("bash", ["-lc", "command -v xcodebuild >/dev/null 2>&1"], {
    signal,
  });
  return result.code === 0;
}

export const xcodeBuildValidator: QuietValidatorDefinition<XcodeConfig | null> = {
  id: "quiet-xcode-build",
  customMessageType: "automation.swift-build",
  title: "xcode build",
  loadConfig,
  async isSupported(pi, ctx, config) {
    return (
      !!config &&
      config.enabled &&
      (await resolveBuildSpec(ctx.cwd, config)) !== null &&
      (await canRunXcodeBuild(pi, ctx.signal))
    );
  },
  async scanInputs(cwd, config) {
    if (!config) return new Map();
    return scanInputs(cwd, config);
  },
  async run(pi, ctx, config) {
    if (!config) return { code: 1, stdout: "", stderr: "Missing quietXcodeBuild config." };
    const spec = await resolveBuildSpec(ctx.cwd, config);
    if (!spec) return { code: 1, stdout: "", stderr: "Unable to resolve xcode build inputs." };
    const result = await pi.exec("bash", ["-lc", buildScript(spec)], { signal: ctx.signal });
    return { code: result.code, stdout: result.stdout || "", stderr: result.stderr || "" };
  },
  getValidatingMessage() {
    return "Validating xcode build...";
  },
  getPassedMessage(changedCount) {
    return `Xcode build passed after ${changedCount} file change(s)`;
  },
  parseFailureGroups(output) {
    return createFallbackFailureGroups("Xcode Build", output);
  },
};
