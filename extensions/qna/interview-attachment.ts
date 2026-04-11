import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export const INTERVIEW_CHAT_ATTACHMENT_ENTRY = "interview.chat_attachment";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseInterviewAttachment(value: unknown): string | null | undefined {
  if (!isObject(value)) return undefined;
  if (value.schemaVersion !== 1) return undefined;
  if (value.interviewSessionId === null) return null;
  if (typeof value.interviewSessionId !== "string") return undefined;
  return value.interviewSessionId.trim().length > 0 ? value.interviewSessionId : undefined;
}

export function getAttachedInterviewSessionIdFromBranch(branch: SessionEntry[]): string | null {
  let attached: string | null = null;

  for (const entry of branch) {
    if (entry.type !== "custom") continue;
    if (entry.customType !== INTERVIEW_CHAT_ATTACHMENT_ENTRY) continue;

    const parsed = parseInterviewAttachment(entry.data);
    if (parsed === undefined) continue;
    attached = parsed;
  }

  return attached;
}
