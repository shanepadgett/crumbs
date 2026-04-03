/**
 * Deterministic Mise Check on TypeScript Edits
 *
 * What this does:
 * - Tracks successful `edit`/`write` tool executions touching `.ts` files.
 * - Tracks any `bash` execution that runs `mise run check`.
 * - At `turn_end`, if `.ts` edits happened after the last check, it runs
 *   `mise run check` automatically via `pi.exec("mise", ["run", "check"])`.
 * - Only if that command fails (non-zero exit), it injects a user message
 *   telling the agent to fix issues (with command output tail for context).
 *
 * How to use:
 * - Put this file at `.pi/extensions/mise-check-on-ts.ts` (project-local extension).
 * - Reload extensions with `/reload`.
 *
 * Example:
 * - Agent edits `src/foo.ts` and does not run checks.
 * - Extension runs `mise run check` automatically at turn end.
 * - If failing, extension injects a remediation prompt for the agent.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const CHECK_COMMAND_REGEX = /\bmise\s+run\s+check\b/;
const MAX_OUTPUT_CHARS = 3_000;

function isTypeScriptPath(pathValue: unknown): boolean {
  if (typeof pathValue !== "string") return false;
  const normalized = pathValue.trim().replace(/^@/, "");
  return normalized.endsWith(".ts");
}

function isCheckCommand(commandValue: unknown): boolean {
  if (typeof commandValue !== "string") return false;
  return CHECK_COMMAND_REGEX.test(commandValue);
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `...\n${text.slice(-maxChars)}`;
}

function fenceSafe(text: string): string {
  return text.replace(/```/g, "``\\`");
}

export default function miseCheckOnTsExtension(pi: ExtensionAPI): void {
  let tsEditSeq = 0;
  let lastCheckedTsEditSeq = 0;
  let checkInFlight = false;

  pi.on("agent_start", async () => {
    tsEditSeq = 0;
    lastCheckedTsEditSeq = 0;
    checkInFlight = false;
  });

  pi.on("tool_result", async (event) => {
    if (
      (event.toolName === "edit" || event.toolName === "write") &&
      !event.isError &&
      isTypeScriptPath(event.input?.path)
    ) {
      tsEditSeq += 1;
      return;
    }

    // Any explicit `mise run check` execution counts as a check after the latest edit,
    // regardless of success/failure, matching the requested semantics.
    if (event.toolName === "bash" && isCheckCommand(event.input?.command)) {
      lastCheckedTsEditSeq = tsEditSeq;
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    const needsCheck = tsEditSeq > 0 && lastCheckedTsEditSeq < tsEditSeq;
    if (!needsCheck || checkInFlight) return;

    checkInFlight = true;
    const result = await pi.exec("mise", ["run", "check"], { signal: ctx.signal });
    checkInFlight = false;

    // Mark this edit generation as checked so we do not re-run until next TS edit.
    lastCheckedTsEditSeq = tsEditSeq;

    if (result.code === 0) return;

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    const output = [
      stdout ? `stdout:\n${tail(stdout, MAX_OUTPUT_CHARS)}` : "",
      stderr ? `stderr:\n${tail(stderr, MAX_OUTPUT_CHARS)}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const message = [
      `Automated check failed (exit code ${result.code}).`,
      "Fix the reported issues and verify with `mise run check` before continuing.",
      output ? `\n\nRecent output:\n\n\`\`\`text\n${fenceSafe(output)}\n\`\`\`` : "",
    ].join(" ");

    if (ctx.isIdle()) {
      pi.sendUserMessage(message);
    } else {
      pi.sendUserMessage(message, { deliverAs: "steer" });
    }
  });
}
