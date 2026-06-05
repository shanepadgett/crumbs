import type { ExtensionContext, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { GateRequest } from "./types.js";

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function formatRequestTitle(request: GateRequest): string {
  if (request.kind === "bash" && request.command) {
    return truncate(request.command.replace(/\s+/g, " ").trim(), 120);
  }
  return truncate(request.inputSummary, 100);
}

function formatSubjectLabel(request: GateRequest): string {
  if (request.kind === "bash") return "Command";
  if (request.kind === "file_mutation") return "Target";
  return "Tool";
}

export async function promptUser(
  ctx: ExtensionContext,
  request: GateRequest,
  reason: string,
): Promise<ToolCallEventResult | undefined> {
  if (!ctx.hasUI) return { block: true, reason: `${reason} (no UI to confirm)` };

  const label = formatSubjectLabel(request);
  const subject = formatRequestTitle(request);
  const choice = await ctx.ui.select(
    `${label}:\n  ${subject}\n\nReason:\n  ${truncate(reason, 180)}`,
    ["Allow once", "Deny"],
    { signal: ctx.signal },
  );

  return choice === "Allow once" ? undefined : { block: true, reason: "Denied by user" };
}
