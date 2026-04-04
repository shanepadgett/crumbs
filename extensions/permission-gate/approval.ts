/**
 * Shared Crumbs permission gate approval UI helpers.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showOptionPicker, type OptionPickerLine } from "../shared/option-picker.js";
import type { ApprovalAction, ApprovalResult } from "./types.js";

const APPROVAL_OPTIONS: ReadonlyArray<{ id: ApprovalAction; label: string }> = [
  { id: "allow-once", label: "Allow once" },
  { id: "always-project", label: "Always allow (project)" },
  { id: "always-user", label: "Always allow (user)" },
  { id: "deny", label: "Deny" },
];

export async function showApprovalPrompt(
  ctx: ExtensionContext,
  command: string,
  approvalReason: string,
  failedSegments: string[],
): Promise<ApprovalResult | null> {
  const commandLines = command.split("\n");
  const shownCommandLines = commandLines.slice(0, 8);

  const lines: OptionPickerLine[] = [
    { text: `Reason: ${approvalReason}`, tone: "muted" },
    { text: "Command:", tone: "muted" },
  ];

  for (const line of shownCommandLines) {
    lines.push({ text: line, tone: "text", indent: 2 });
  }

  if (commandLines.length > shownCommandLines.length) {
    lines.push({ text: "…", tone: "dim", indent: 2 });
  }

  if (failedSegments.length > 0) {
    lines.push({ text: "Unapproved segment(s):", tone: "muted" });
    for (const segment of failedSegments.slice(0, 4)) {
      lines.push({ text: segment, tone: "text", indent: 2 });
    }

    if (failedSegments.length > 4) {
      lines.push({ text: "…", tone: "dim", indent: 2 });
    }
  }

  const result = await showOptionPicker(ctx, {
    title: "Bash command requires approval",
    lines,
    options: APPROVAL_OPTIONS,
    cancelAction: "deny",
    reviewToggle: {
      key: "r",
      label: "review",
    },
  });

  if (!result) return null;

  const selectedNote = (result.notes[result.action] ?? "").trim();
  const note = selectedNote.length > 0 ? selectedNote : undefined;
  const markedForReview = result.reviewMarked === true;

  if (result.action === "deny") {
    return {
      action: "deny",
      approvalReason,
      markedForReview,
      note,
      denyReason: note,
    };
  }

  return {
    action: result.action,
    approvalReason,
    markedForReview,
    note,
  };
}

export function userBlockReason(denyReason?: string): string {
  if (!denyReason || denyReason.trim().length === 0) return "Blocked by user";
  return `Blocked by user: ${denyReason.trim()}`;
}

export function formatApprovalNote(note: string): string {
  return `[crumbs approval note]\n${note}`;
}
