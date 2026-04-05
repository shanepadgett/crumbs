/**
 * Deterministic markdownlint Check on Markdown Edits
 *
 * What this does:
 * - Tracks successful `edit`/`write` tool executions touching Markdown files.
 * - Tracks any `bash` execution that runs `bunx markdownlint-cli` or `npx markdownlint-cli`.
 * - At `turn_end`, only when the turn had no tool calls, it runs markdownlint
 *   automatically (prefers `bunx`, falls back to `npx`) if Markdown edits are still dirty.
 * - Only if linting fails (non-zero exit), it injects a custom automation
 *   message with the relevant output so the agent can fix issues without first
 *   spending another tool call to rerun the check.
 *
 * How to use:
 * - Put this file at `extensions/markdownlint-on-md.ts`.
 * - Reload extensions with `/reload`.
 *
 * Example:
 * - Agent edits `docs/guide.md` and reaches a no-tool-call turn.
 * - Extension runs `bunx markdownlint-cli --fix docs/guide.md`.
 * - If failing, extension injects an automation message with output context.
 */

import { keyHint, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";
import {
  ensurePackageManagerDirectories,
  formatCommandForDisplay,
  wrapCommandWithPackageManagerEnvironment,
} from "./shared/package-manager-env.js";
import { collectMutatedPaths, extractToolCommand } from "./shared/tool-observation.js";

const MARKDOWNLINT_BASH_REGEX =
  /\b(?:bunx\s+markdownlint-cli|npx(?:\s+--yes)?\s+markdownlint-cli)\b/;
const CUSTOM_MESSAGE_TYPE = "automation.markdownlint";

function isMarkdownPath(pathValue: unknown): boolean {
  if (typeof pathValue !== "string") return false;
  const path = pathValue.trim().replace(/^@/, "");
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function isMarkdownLintCommand(commandValue: unknown): boolean {
  if (typeof commandValue !== "string") return false;
  return MARKDOWNLINT_BASH_REGEX.test(commandValue);
}

function buildFailureMessage(
  result: { code: number; stdout?: string; stderr?: string },
  rerunCmd: string,
): string {
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  const detail = (stderr || stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  return [
    `markdownlint failed (exit ${result.code}).`,
    detail ? `Issue: ${detail}` : "",
    `Run \`${rerunCmd}\` after fixes.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildExpandedOutput(stdout: string | undefined, stderr: string | undefined): string {
  const lines: string[] = [];
  if (stdout?.trim()) {
    lines.push("stdout:", stdout.trimEnd());
  }
  if (stderr?.trim()) {
    if (lines.length > 0) lines.push("");
    lines.push("stderr:", stderr.trimEnd());
  }
  return lines.join("\n");
}

export default function markdownlintOnMdExtension(pi: ExtensionAPI): void {
  const dirtyMarkdownFiles = new Set<string>();
  let checkInFlight = false;
  let preferredRunner: "bunx" | "npx" | null = null;

  pi.registerMessageRenderer<{
    command?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
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
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
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

    if (!options.expanded) {
      return root;
    }

    const lines: string[] = [];
    if (typeof details.command === "string" && details.command.trim()) {
      lines.push(theme.fg("muted", `$ ${details.command}`));
    }

    const fullOutput = buildExpandedOutput(details.stdout, details.stderr);
    if (fullOutput) {
      lines.push(theme.fg("toolOutput", fullOutput));
    }

    if (lines.length > 0) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(lines.join("\n\n"), 0, 0));
    }

    return root;
  });

  async function detectRunner(signal?: AbortSignal): Promise<"bunx" | "npx"> {
    if (preferredRunner) return preferredRunner;

    ensurePackageManagerDirectories();
    const bunxCommand = wrapCommandWithPackageManagerEnvironment("bunx", ["--version"]);
    const bunxResult = await pi.exec(bunxCommand.command, bunxCommand.args, {
      timeout: 2_000,
      signal,
    });
    preferredRunner = bunxResult.code === 0 ? "bunx" : "npx";
    return preferredRunner;
  }

  pi.on("agent_start", async () => {
    dirtyMarkdownFiles.clear();
    checkInFlight = false;
    preferredRunner = null;
  });

  pi.on("tool_result", async (event) => {
    if (!event.isError) {
      const touchedPaths = collectMutatedPaths(event.toolName, event.input);
      for (const path of touchedPaths) {
        if (isMarkdownPath(path)) {
          dirtyMarkdownFiles.add(path);
        }
      }
    }

    // Any explicit markdownlint run counts as a check for currently dirty markdown files,
    // regardless of success/failure, matching the existing mise-check-on-ts semantics.
    const toolCommand = extractToolCommand(event.input);
    if (isMarkdownLintCommand(toolCommand)) {
      dirtyMarkdownFiles.clear();
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (event.toolResults.length > 0) return;
    if (dirtyMarkdownFiles.size === 0 || checkInFlight) return;

    checkInFlight = true;
    const files = [...dirtyMarkdownFiles];

    const runner = await detectRunner(ctx.signal);
    const args =
      runner === "bunx"
        ? ["markdownlint-cli", "--fix", ...files]
        : ["--yes", "markdownlint-cli", "--fix", ...files];

    ensurePackageManagerDirectories();
    const command = wrapCommandWithPackageManagerEnvironment(runner, args);
    const result = await pi.exec(command.command, command.args, { signal: ctx.signal });
    checkInFlight = false;

    // Mark currently dirty files as checked by this run.
    for (const file of files) {
      dirtyMarkdownFiles.delete(file);
    }

    if (result.code === 0) return;

    const rerunCmd = formatCommandForDisplay(command.command, command.args);
    const content = buildFailureMessage(result, rerunCmd);
    const message = {
      customType: CUSTOM_MESSAGE_TYPE,
      content,
      display: true,
      details: {
        command: rerunCmd,
        exitCode: result.code,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        files,
      },
    };

    if (ctx.isIdle()) {
      pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
    } else {
      pi.sendMessage(message, { deliverAs: "steer" });
    }
  });
}
