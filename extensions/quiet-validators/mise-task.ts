import { promises as fs } from "node:fs";
import { extname, join, relative } from "node:path";
import type { QuietValidatorDefinition, Snapshot } from "./core.js";
import { createFallbackFailureGroups } from "./core.js";
import {
  asBoolean,
  asRecord,
  asStringArray,
  matchesAny,
  normalizePath,
  readExtensionConfig,
} from "./config.js";

const DEFAULT_TASK = "check";

const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".git",
  ".pi",
  ".swiftpm",
  "DerivedData",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "tmp",
]);

type MiseTaskConfig = {
  enabled: boolean;
  task: string;
  trackedExtensions: string[];
  excludeGlobs: string[];
};

function normalizeTrackedExtension(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith(".") ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
}

function asTrackedExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const extension = normalizeTrackedExtension(item);
    if (extension) normalized.add(extension);
  }
  return [...normalized];
}

async function loadConfig(cwd: string): Promise<MiseTaskConfig> {
  const extensions = await readExtensionConfig(cwd);
  const config = asRecord(extensions?.quietMiseTask);
  if (!config) {
    return { enabled: true, task: DEFAULT_TASK, trackedExtensions: [], excludeGlobs: [] };
  }

  return {
    enabled: asBoolean(config.enabled, true),
    task:
      typeof config.task === "string" && config.task.trim().length > 0
        ? config.task.trim()
        : DEFAULT_TASK,
    trackedExtensions: asTrackedExtensions(config.trackedExtensions),
    excludeGlobs: asStringArray(config.excludeGlobs),
  };
}

function shouldSkipDirectory(relativePath: string, config: MiseTaskConfig): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (normalizedPath.length === 0) return false;
  return matchesAny(`${normalizedPath}/__pi_probe__`, config.excludeGlobs);
}

function shouldTrackPath(relativePath: string, config: MiseTaskConfig): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (matchesAny(normalizedPath, config.excludeGlobs)) return false;
  if (config.trackedExtensions.length === 0) return false;
  return config.trackedExtensions.includes(extname(normalizedPath).toLowerCase());
}

async function scanInputs(root: string, config: MiseTaskConfig): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const directoryKey = normalizePath(relative(root, join(currentPath, entry.name)));
        if (shouldSkipDirectory(directoryKey, config)) continue;
        await walk(join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = join(currentPath, entry.name);
      const fileKey = normalizePath(relative(root, fullPath));
      if (!shouldTrackPath(fileKey, config)) continue;

      const stats = await fs.stat(fullPath);
      snapshot.set(fileKey, `${stats.size}:${stats.mtimeMs}`);
    }
  }

  await walk(root);
  return snapshot;
}

function normalizeMessageStem(message: string): string {
  return message
    .replace(/^[-*•]\s*/, "")
    .replace(/^[^:]+:\d+:\d+:\s*/, "")
    .replace(/^[^:]+:\d+:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseFailureGroups(output: string) {
  const groups = new Map<
    string,
    { key: string; title: string; count: number; examples: string[] }
  >();
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const swiftLintMatch = line.match(
      /^(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+?)\s+\(([A-Za-z0-9_]+)\)$/,
    );
    if (swiftLintMatch) {
      const ruleId = swiftLintMatch[6];
      const key = `swiftlint:${ruleId}`;
      const title = `SwiftLint · ${ruleId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set(key, { key, title, count: 1, examples: [line] });
      }
      continue;
    }

    if (/swiftformat/i.test(line) || /is not formatted correctly/i.test(line)) {
      const existing = groups.get("swiftformat");
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set("swiftformat", {
          key: "swiftformat",
          title: "SwiftFormat",
          count: 1,
          examples: [line],
        });
      }
      continue;
    }

    if (
      /error:/i.test(line) ||
      /warning:/i.test(line) ||
      /failed/i.test(line) ||
      /not formatted/i.test(line)
    ) {
      const normalized = normalizeMessageStem(line);
      const key = `message:${normalized.toLowerCase()}`;
      const title = titleCase(normalized);
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set(key, { key, title, count: 1, examples: [line] });
      }
    }
  }

  return groups.size > 0 ? [...groups.values()] : createFallbackFailureGroups("Mise Task", output);
}

async function canRunTask(pi: any, task: string, signal?: AbortSignal): Promise<boolean> {
  const result = await pi.exec(
    "bash",
    [
      "-lc",
      `command -v mise >/dev/null 2>&1 || exit 127\n` +
        `test -f mise.toml || exit 126\n` +
        `mise tasks info ${JSON.stringify(task)} --json >/dev/null 2>&1 || exit 125`,
    ],
    { signal },
  );
  return result.code === 0;
}

export const miseTaskValidator: QuietValidatorDefinition<MiseTaskConfig> = {
  id: "quiet-mise-task",
  customMessageType: "automation.mise-task",
  title: "mise task",
  loadConfig,
  async isSupported(pi, ctx, config) {
    return (
      config.enabled &&
      config.trackedExtensions.length > 0 &&
      (await canRunTask(pi, config.task, ctx.signal))
    );
  },
  async scanInputs(cwd, config) {
    return scanInputs(cwd, config);
  },
  async run(pi, ctx, config) {
    const result = await pi.exec("mise", ["run", config.task], { signal: ctx.signal });
    return { code: result.code, stdout: result.stdout || "", stderr: result.stderr || "" };
  },
  getValidatingMessage(config) {
    return `Validating mise task (${config.task})...`;
  },
  getPassedMessage(changedCount, config) {
    return `Mise task ${config.task} passed after ${changedCount} file change(s)`;
  },
  parseFailureGroups(output) {
    return parseFailureGroups(output);
  },
};
