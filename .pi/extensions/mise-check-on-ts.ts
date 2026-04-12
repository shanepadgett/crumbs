/**
 * Deterministic Mise Check on TypeScript Edits
 *
 * What this does:
 * - Tracks successful `edit`/`write` tool executions touching `.ts` files.
 * - Tracks any `bash` execution that runs `mise run check`.
 * - At `turn_end`, only when the turn had no tool calls, it runs
 *   `mise run check` automatically if `.ts` edits happened after the last check.
 * - Only if that command fails (non-zero exit), it injects a custom automation
 *   message with the relevant output so the agent can fix issues without first
 *   spending another tool call to rerun the check.
 *
 * How to use:
 * - Put this file at `.pi/extensions/mise-check-on-ts.ts` (project-local extension).
 * - Reload extensions with `/reload`.
 *
 * Example:
 * - Agent edits `src/foo.ts` and reaches a no-tool-call turn.
 * - Extension runs `mise run check`.
 * - If failing, extension injects an automation message with output context.
 */

import { keyHint, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";

const CHECK_COMMAND_REGEX = /\bmise\s+run\s+check\b/;
const CUSTOM_MESSAGE_TYPE = "automation.mise-check";

function normalizePathValue(pathValue: string): string | null {
  const normalized = pathValue.trim().replace(/^@/, "");
  return normalized.length > 0 ? normalized : null;
}

function extractPatchText(input: unknown): string | null {
  if (typeof input === "string") return maybeUnwrapApplyPatchInvocation(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  if (typeof record.input === "string") return maybeUnwrapApplyPatchInvocation(record.input);
  if (typeof record.patch === "string") return maybeUnwrapApplyPatchInvocation(record.patch);
  if (typeof record.text === "string") return maybeUnwrapApplyPatchInvocation(record.text);
  return null;
}

function unwrapQuoted(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 2) return null;
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }

  const inner = trimmed.slice(1, -1);
  return quote === '"' ? inner.replace(/\\"/g, '"') : inner;
}

function unwrapShellEnvelope(input: string): string {
  const trimmed = input.trim();
  const wrappers: RegExp[] = [
    /^(?:bash|zsh|sh)\s+-(?:lc|c)\s+([\s\S]+)$/,
    /^(?:powershell|pwsh)\s+(?:-[^\s]+\s+)*-Command\s+([\s\S]+)$/i,
    /^cmd\s+\/c\s+([\s\S]+)$/i,
  ];

  for (const wrapper of wrappers) {
    const match = trimmed.match(wrapper);
    if (!match) continue;
    const unwrapped = unwrapQuoted(match[1] ?? "");
    return unwrapped ?? trimmed;
  }

  return trimmed;
}

function maybeUnwrapApplyPatchInvocation(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.startsWith("*** Begin Patch")) return trimmed;

  const shellBody = unwrapShellEnvelope(trimmed);
  const commandMatch = shellBody.match(
    /^(?:cd\s+.+?\s+&&\s+)?(?:apply_patch|applypatch)\b([\s\S]*)$/,
  );
  if (!commandMatch) return null;

  const rest = (commandMatch[1] ?? "").trimStart();
  if (rest.startsWith("*** Begin Patch")) return rest;

  const heredocMatch = rest.match(/^<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\n([\s\S]*?)\n\2\s*$/);
  if (!heredocMatch) return null;

  const patch = heredocMatch[3]?.trim();
  return patch && patch.startsWith("*** Begin Patch") ? patch : null;
}

function collectPatchMutatedPaths(patchText: string): string[] {
  const touched = new Set<string>();
  const lines = patchText.split("\n");
  let lastUpdatedPath: string | null = null;

  for (const line of lines) {
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    if (addMatch) {
      const path = normalizePathValue(addMatch[1] ?? "");
      if (path) touched.add(path);
      lastUpdatedPath = null;
      continue;
    }

    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updateMatch) {
      const path = normalizePathValue(updateMatch[1] ?? "");
      if (path) touched.add(path);
      lastUpdatedPath = path;
      continue;
    }

    if (line.startsWith("*** Delete File:")) {
      lastUpdatedPath = null;
      continue;
    }

    const moveToMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveToMatch) {
      const nextPath = normalizePathValue(moveToMatch[1] ?? "");
      if (lastUpdatedPath) touched.delete(lastUpdatedPath);
      if (nextPath) touched.add(nextPath);
      lastUpdatedPath = nextPath;
    }
  }

  return [...touched];
}

function isFileMutationTool(toolName: unknown): boolean {
  return toolName === "edit" || toolName === "write" || toolName === "apply_patch";
}

function collectMutatedPaths(toolName: unknown, input: unknown): string[] {
  if (!isFileMutationTool(toolName)) return [];

  if (toolName === "apply_patch") {
    const patchText = extractPatchText(input);
    if (!patchText) return [];
    return collectPatchMutatedPaths(patchText);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  if (typeof record.path !== "string") return [];
  const path = normalizePathValue(record.path);
  return path ? [path] : [];
}

function extractToolCommand(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.command === "string") return record.command;
  if (typeof record.cmd === "string") return record.cmd;
  return null;
}

function isTypeScriptPath(pathValue: unknown): boolean {
  if (typeof pathValue !== "string") return false;
  const normalized = pathValue.trim().replace(/^@/, "");
  return normalized.endsWith(".ts");
}

function isCheckCommand(commandValue: unknown): boolean {
  if (typeof commandValue !== "string") return false;
  return CHECK_COMMAND_REGEX.test(commandValue);
}

function buildFailureMessage(result: { code: number; stdout?: string; stderr?: string }): string {
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  const detail = (stderr || stdout)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  return [
    `mise run check failed (exit ${result.code}).`,
    detail ? `Issue: ${detail}` : "",
    "Run `mise run check` after fixes.",
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

export default function miseCheckOnTsExtension(pi: ExtensionAPI): void {
  let tsEditSeq = 0;
  let lastCheckedTsEditSeq = 0;
  let checkInFlight = false;

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
      theme.fg("toolTitle", theme.bold("mise run check")),
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

  pi.on("agent_start", async () => {
    tsEditSeq = 0;
    lastCheckedTsEditSeq = 0;
    checkInFlight = false;
  });

  pi.on("tool_result", async (event) => {
    if (!event.isError) {
      const touchedPaths = collectMutatedPaths(event.toolName, event.input);
      if (touchedPaths.some((path) => isTypeScriptPath(path))) {
        tsEditSeq += 1;
      }
    }

    // Any explicit `mise run check` execution counts as a check after the latest edit,
    // regardless of success or failure, matching the requested semantics.
    const toolCommand = extractToolCommand(event.input);
    if (isCheckCommand(toolCommand)) {
      lastCheckedTsEditSeq = tsEditSeq;
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (event.toolResults.length > 0) return;

    const needsCheck = tsEditSeq > 0 && lastCheckedTsEditSeq < tsEditSeq;
    if (!needsCheck || checkInFlight) return;

    checkInFlight = true;
    const result = await pi.exec("mise", ["run", "check"], { signal: ctx.signal });
    checkInFlight = false;

    // Mark this edit generation as checked so we do not re-run until the next TS edit.
    lastCheckedTsEditSeq = tsEditSeq;

    if (result.code === 0) return;

    const content = buildFailureMessage(result);
    const message = {
      customType: CUSTOM_MESSAGE_TYPE,
      content,
      display: true,
      details: {
        command: "mise run check",
        exitCode: result.code,
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        tsEditSeq,
      },
    };

    if (ctx.isIdle()) {
      pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
    } else {
      pi.sendMessage(message, { deliverAs: "steer" });
    }
  });
}
