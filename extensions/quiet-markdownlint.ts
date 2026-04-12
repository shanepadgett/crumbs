/**
 * Quiet markdownlint check for Markdown changes
 *
 * What it does:
 * - Watches Markdown files under the current working directory.
 * - Ignores common generated/vendor directories, including `external/`.
 * - On an idle turn after Markdown changes, runs markdownlint across the repo.
 * - Tries `markdownlint` first, then `bunx markdownlint-cli`, then `npx --yes markdownlint-cli`.
 * - Only interrupts the agent when linting fails.
 *
 * Example:
 * - Agent edits `docs/guide.md`.
 * - Extension later runs `markdownlint . --ignore node_modules/** ...`.
 * - If lint fails, extension injects the failure output.
 */

import { promises as fs } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";

const CUSTOM_MESSAGE_TYPE = "automation.markdownlint";

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

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

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

type Snapshot = Map<string, string>;

function hasMarkdownExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const extension of MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(extension)) return true;
  }
  return false;
}

function shouldIgnoreDirectory(directoryName: string): boolean {
  return IGNORED_DIRECTORIES.has(directoryName) || directoryName === "_hidden";
}

async function scanMarkdownFiles(root: string): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) continue;
        await walk(join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = join(currentPath, entry.name);
      const fileKey = relative(root, fullPath).replaceAll("\\", "/");
      if (!hasMarkdownExtension(fileKey)) continue;

      const stats = await fs.stat(fullPath);
      snapshot.set(fileKey, `${stats.size}:${stats.mtimeMs}`);
    }
  }

  await walk(root);
  return snapshot;
}

function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changed = new Set<string>();

  for (const [file, signature] of before) {
    if (after.get(file) !== signature) changed.add(file);
  }

  for (const file of after.keys()) {
    if (!before.has(file)) changed.add(file);
  }

  return [...changed].sort();
}

function buildValidationSignature(snapshot: Snapshot, changedFiles: string[]): string {
  return changedFiles.map((file) => `${file}:${snapshot.get(file) ?? "<deleted>"}`).join("|");
}

function formatFailureMessage(changedFiles: string[], output: string): string {
  const fileLines = changedFiles
    .slice(0, 12)
    .map((file) => `- ${file}`)
    .join("\n");
  const extraCount = Math.max(0, changedFiles.length - 12);
  const extraLine = extraCount > 0 ? `\n- ... and ${extraCount} more` : "";

  return [
    "Quiet markdownlint failed after Markdown changes.",
    "Fix the lint errors before continuing.",
    "",
    "Changed files:",
    fileLines + extraLine,
    "",
    "markdownlint output:",
    "```text",
    output.trim(),
    "```",
  ].join("\n");
}

function buildExpandedOutput(changedFiles: string[], output: string): string {
  const lines: string[] = [];

  if (changedFiles.length > 0) {
    lines.push("Changed files:");
    lines.push(...changedFiles.map((file) => `- ${file}`));
  }

  if (output.trim()) {
    if (lines.length > 0) lines.push("");
    lines.push("markdownlint output:");
    lines.push(output.trimEnd());
  }

  return lines.join("\n");
}

async function runMarkdownlint(
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<{ code: number; stdout: string; stderr: string }> {
  for (const runner of RUNNERS) {
    const args = [...runner.args, ...IGNORE_PATTERNS.flatMap((pattern) => ["--ignore", pattern])];
    const result = await pi.exec(runner.command, args, { signal });
    if (result.code === 0) {
      return {
        code: 0,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    }

    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const missingCommand =
      result.code === 127 ||
      /command not found|not found|ENOENT|executable file not found/i.test(combinedOutput);
    if (missingCommand) continue;

    return {
      code: result.code,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }

  return {
    code: 127,
    stdout: "",
    stderr: "markdownlint was not available via markdownlint, bunx, or npx.",
  };
}

export default function (pi: ExtensionAPI) {
  let baseline: Snapshot = new Map();
  let validationInFlight = false;
  let markdownChangesDetected = false;
  let lastValidatedSignature: string | null = null;

  async function runValidation(
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  ): Promise<void> {
    if (validationInFlight) return;

    const current = await scanMarkdownFiles(ctx.cwd);
    const changedFiles = diffSnapshots(baseline, current);
    if (changedFiles.length === 0) return;

    const validationSignature = buildValidationSignature(current, changedFiles);
    if (validationSignature === lastValidatedSignature) return;

    validationInFlight = true;
    lastValidatedSignature = validationSignature;
    if (ctx.hasUI) ctx.ui.notify("Validating markdown...", "info");

    try {
      const result = await runMarkdownlint(pi, ctx.signal);
      if (result.code === 0) {
        baseline = current;
        markdownChangesDetected = false;
        lastValidatedSignature = null;
        if (ctx.hasUI) {
          ctx.ui.notify(`Markdownlint passed after ${changedFiles.length} file change(s)`, "info");
        }
        return;
      }

      const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const content = formatFailureMessage(changedFiles, combinedOutput);
      const message = {
        customType: CUSTOM_MESSAGE_TYPE,
        content,
        display: true,
        details: {
          changedFiles,
          exitCode: result.code,
          output: combinedOutput,
        },
      };

      if (ctx.isIdle()) {
        pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
      } else {
        pi.sendMessage(message, { deliverAs: "steer" });
      }
    } finally {
      validationInFlight = false;
      if (ctx.hasUI) ctx.ui.setStatus("quiet-markdownlint", undefined);
    }
  }

  pi.registerMessageRenderer<{
    changedFiles?: string[];
    exitCode?: number;
    output?: string;
  }>(CUSTOM_MESSAGE_TYPE, (message, options, theme) => {
    const details = message.details ?? {};
    const exitCode =
      typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
        ? details.exitCode
        : undefined;
    const status = [
      theme.fg("warning", "failed"),
      exitCode !== undefined ? theme.fg("muted", `(exit ${exitCode})`) : "",
    ]
      .filter(Boolean)
      .join(" ");

    const root = new Container();
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    root.addChild(box);

    const label = theme.fg("customMessageLabel", `\x1b[1m[${message.customType}]\x1b[22m`);
    box.addChild(new Text(label, 0, 0));
    box.addChild(new Spacer(1));

    const summary = [
      theme.fg("toolTitle", theme.bold("markdownlint")),
      status,
      !options.expanded
        ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
        : theme.fg("muted", `(${keyHint("app.tools.expand", "to collapse")})`),
    ]
      .filter(Boolean)
      .join(" ");
    box.addChild(new Text(summary, 0, 0));

    if (!options.expanded) return root;

    const changedFiles = Array.isArray(details.changedFiles) ? details.changedFiles : [];
    const output = typeof details.output === "string" ? details.output : "";
    const expandedOutput = buildExpandedOutput(changedFiles, output);

    if (expandedOutput) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(theme.fg("toolOutput", expandedOutput), 0, 0));
    }

    return root;
  });

  pi.on("agent_start", async (_event, ctx) => {
    baseline = await scanMarkdownFiles(ctx.cwd);
    validationInFlight = false;
    markdownChangesDetected = false;
    lastValidatedSignature = null;
  });

  pi.on("turn_end", async (event, ctx) => {
    const current = await scanMarkdownFiles(ctx.cwd);
    const changedFiles = diffSnapshots(baseline, current);
    if (changedFiles.length > 0) markdownChangesDetected = true;

    if (event.toolResults.length > 0) return;
    if (!markdownChangesDetected) return;

    await runValidation(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!markdownChangesDetected) return;
    await runValidation(ctx);
  });
}
