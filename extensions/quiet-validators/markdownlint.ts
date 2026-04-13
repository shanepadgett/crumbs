import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  createFallbackFailureGroups,
  type FailureGroup,
  type QuietValidatorDefinition,
  type Snapshot,
} from "./core.js";
import {
  asBoolean,
  asRecord,
  asStringArray,
  matchesAny,
  normalizePath,
  readExtensionConfig,
} from "./config.js";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".pi",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "external",
  "node_modules",
  "out",
  "tmp",
]);

const IGNORE_PATTERNS = [
  ".git/**",
  ".next/**",
  ".nuxt/**",
  ".pi/**",
  ".turbo/**",
  ".vercel/**",
  "build/**",
  "coverage/**",
  "dist/**",
  "external/**",
  "node_modules/**",
  "out/**",
  "tmp/**",
  "**/_hidden/**",
  "extensions/permissions/**",
];

const RUNNERS = [
  { command: "markdownlint", args: ["."] },
  { command: "bunx", args: ["markdownlint-cli", "."] },
  { command: "npx", args: ["--yes", "markdownlint-cli", "."] },
] as const;

type MarkdownConfig = {
  enabled: boolean;
  excludeGlobs: string[];
};

async function loadConfig(cwd: string): Promise<MarkdownConfig> {
  const extensions = await readExtensionConfig(cwd);
  const config = asRecord(extensions?.quietMarkdownlint);
  return {
    enabled: asBoolean(config?.enabled, true),
    excludeGlobs: asStringArray(config?.excludeGlobs),
  };
}

function shouldSkipDirectory(relativePath: string, config: MarkdownConfig): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (normalizedPath.length === 0) return false;
  return matchesAny(`${normalizedPath}/__pi_probe__`, config.excludeGlobs);
}

function shouldTrackFile(relativePath: string, config: MarkdownConfig): boolean {
  if (matchesAny(relativePath, config.excludeGlobs)) return false;
  return relativePath.endsWith(".md") || relativePath.endsWith(".markdown");
}

async function scanMarkdownFiles(root: string, config: MarkdownConfig): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name === "_hidden") continue;
        const directoryKey = normalizePath(relative(root, join(currentPath, entry.name)));
        if (shouldSkipDirectory(directoryKey, config)) continue;
        await walk(join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = join(currentPath, entry.name);
      const fileKey = normalizePath(relative(root, fullPath)).toLowerCase();
      if (!shouldTrackFile(fileKey, config)) continue;

      const stats = await fs.stat(fullPath);
      snapshot.set(fileKey, `${stats.size}:${stats.mtimeMs}`);
    }
  }

  await walk(root);
  return snapshot;
}

async function runMarkdownlint(pi: ExtensionAPI, signal?: AbortSignal) {
  for (const runner of RUNNERS) {
    const args = [...runner.args, ...IGNORE_PATTERNS.flatMap((pattern) => ["--ignore", pattern])];
    const result = await pi.exec(runner.command, args, { signal });
    if (result.code === 0)
      return { code: 0, stdout: result.stdout || "", stderr: result.stderr || "" };

    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const missingCommand =
      result.code === 127 ||
      /command not found|not found|ENOENT|executable file not found/i.test(combinedOutput);
    if (missingCommand) continue;

    return { code: result.code, stdout: result.stdout || "", stderr: result.stderr || "" };
  }

  return {
    code: 127,
    stdout: "",
    stderr: "markdownlint was not available via markdownlint, bunx, or npx.",
  };
}

function parseFailureGroups(output: string): FailureGroup[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const groups = new Map<string, FailureGroup>();

  for (const line of lines) {
    const ruleMatch = line.match(/\b(MD\d{3}(?:\/[^^\s:]+)?)\b/i);
    const ruleId = ruleMatch?.[1]?.toUpperCase();
    const key = ruleId ?? "markdownlint";
    const title = ruleId ? `Markdownlint · ${ruleId}` : "Markdownlint";
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.examples.length < 5 && !existing.examples.includes(line))
        existing.examples.push(line);
      continue;
    }

    groups.set(key, { key, title, count: 1, examples: [line] });
  }

  return groups.size > 0
    ? [...groups.values()]
    : createFallbackFailureGroups("Markdownlint", output);
}

export const markdownlintValidator: QuietValidatorDefinition<MarkdownConfig> = {
  id: "quiet-markdownlint",
  customMessageType: "automation.markdownlint",
  title: "markdownlint",
  async loadConfig(cwd) {
    return loadConfig(cwd);
  },
  async isSupported(_pi, _ctx, config) {
    return config.enabled;
  },
  async scanInputs(cwd, config) {
    return scanMarkdownFiles(cwd, config);
  },
  async run(pi, ctx) {
    return runMarkdownlint(pi, ctx.signal);
  },
  getValidatingMessage() {
    return "Validating markdownlint...";
  },
  getPassedMessage(changedCount) {
    return `Markdownlint passed after ${changedCount} file change(s)`;
  },
  parseFailureGroups(output) {
    return parseFailureGroups(output);
  },
};
