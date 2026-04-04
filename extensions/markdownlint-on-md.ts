/**
 * Deterministic markdownlint Check on Markdown Edits
 *
 * What this does:
 * - Tracks successful `edit`/`write` tool executions touching Markdown files.
 * - Tracks any `bash` execution that runs `bunx markdownlint-cli` or `npx markdownlint-cli`.
 * - At `turn_end`, if Markdown edits happened after the last check, it runs markdownlint
 *   automatically (prefers `bunx`, falls back to `npx`).
 * - If linting fails (non-zero exit), it injects a user message instructing the agent to fix issues.
 *
 * How to use:
 * - Put this file at `extensions/markdownlint-on-md.ts`.
 * - Reload extensions with `/reload`.
 *
 * Example:
 * - Agent edits `docs/guide.md` and does not run markdownlint.
 * - Extension runs `bunx markdownlint-cli docs/guide.md` at turn end.
 * - If failing, extension injects a remediation prompt for the agent.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MARKDOWNLINT_BASH_REGEX =
  /\b(?:bunx\s+markdownlint-cli|npx(?:\s+--yes)?\s+markdownlint-cli)\b/;
const MAX_OUTPUT_CHARS = 3_000;

function normalizePath(pathValue: unknown): string | null {
  if (typeof pathValue !== "string") return null;
  const normalized = pathValue.trim().replace(/^@/, "");
  return normalized.length > 0 ? normalized : null;
}

function isMarkdownPath(pathValue: unknown): boolean {
  const path = normalizePath(pathValue);
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function isMarkdownLintCommand(commandValue: unknown): boolean {
  if (typeof commandValue !== "string") return false;
  return MARKDOWNLINT_BASH_REGEX.test(commandValue);
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `...\n${text.slice(-maxChars)}`;
}

function fenceSafe(text: string): string {
  return text.replace(/```/g, "``\\`");
}

export default function markdownlintOnMdExtension(pi: ExtensionAPI): void {
  const dirtyMarkdownFiles = new Set<string>();
  let checkInFlight = false;
  let preferredRunner: "bunx" | "npx" | null = null;

  async function detectRunner(signal?: AbortSignal): Promise<"bunx" | "npx"> {
    if (preferredRunner) return preferredRunner;

    const bunxResult = await pi.exec("bunx", ["--version"], { timeout: 2_000, signal });
    preferredRunner = bunxResult.code === 0 ? "bunx" : "npx";
    return preferredRunner;
  }

  pi.on("agent_start", async () => {
    dirtyMarkdownFiles.clear();
    checkInFlight = false;
    preferredRunner = null;
  });

  pi.on("tool_result", async (event) => {
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      !event.isError &&
      isMarkdownPath(event.input?.path)
    ) {
      const path = normalizePath(event.input?.path);
      if (path) dirtyMarkdownFiles.add(path);
      return;
    }

    // Any explicit markdownlint run counts as a check for currently dirty markdown files,
    // regardless of success/failure, matching the existing mise-check-on-ts semantics.
    if (event.toolName === "bash" && isMarkdownLintCommand(event.input?.command)) {
      dirtyMarkdownFiles.clear();
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (dirtyMarkdownFiles.size === 0 || checkInFlight) return;

    checkInFlight = true;
    const files = [...dirtyMarkdownFiles];

    const runner = await detectRunner(ctx.signal);
    const args =
      runner === "bunx" ? ["markdownlint-cli", ...files] : ["--yes", "markdownlint-cli", ...files];

    const result = await pi.exec(runner, args, { signal: ctx.signal });
    checkInFlight = false;

    // Mark currently dirty files as checked by this run.
    for (const file of files) {
      dirtyMarkdownFiles.delete(file);
    }

    if (result.code === 0) return;

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const output = [
      stdout ? `stdout:\n${tail(stdout, MAX_OUTPUT_CHARS)}` : "",
      stderr ? `stderr:\n${tail(stderr, MAX_OUTPUT_CHARS)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const rerunCmd = `${runner} ${args.join(" ")}`;
    const message = [
      `Automated markdownlint check failed (exit code ${result.code}).`,
      `Fix Markdown issues and verify with \`${rerunCmd}\` before continuing.`,
      output ? `\n\nRecent output:\n\n\`\`\`text\n${fenceSafe(output)}\n\`\`\`` : "",
    ].join(" ");

    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "steer" });
    }
  });
}
