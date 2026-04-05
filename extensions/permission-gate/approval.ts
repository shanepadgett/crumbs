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
  const lines: OptionPickerLine[] = [{ text: `Reason: ${approvalReason}`, tone: "muted" }];

  const filteredSegments = failedSegments.filter(
    (segment) => segment.trim().length > 0 && segment.trim() !== command.trim(),
  );

  if (filteredSegments.length > 0) {
    lines.push({ text: "Unapproved segment(s):", tone: "muted" });
    for (const segment of filteredSegments.slice(0, 4)) {
      lines.push({ text: segment, tone: "text", indent: 2 });
    }

    if (filteredSegments.length > 4) {
      lines.push({ text: "…", tone: "dim", indent: 2 });
    }
  }

  const result = await showOptionPicker(ctx, {
    title: "Bash command requires approval",
    lines,
    options: APPROVAL_OPTIONS,
    cancelAction: "deny",
    reviewToggle: {
      key: "ctrl+r",
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

function formatUserNoteSection(note: string): string {
  return `[user note]\n${note}`;
}

function formatDecisionSection(text: string): string {
  return `[decision]\n${text}`;
}

export function userBlockReason(denyReason?: string): string {
  const note = (denyReason ?? "").trim();
  const sections: string[] = [];

  if (note.length > 0) {
    sections.push(formatUserNoteSection(note));
  }

  sections.push(formatDecisionSection("Denied by user"));
  return `Blocked by user\n\n${sections.join("\n\n")}`;
}

export function formatApprovalNote(note: string): string {
  return `${formatUserNoteSection(note)}\n\n[tool result]`;
}
