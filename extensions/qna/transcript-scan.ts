import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import type { QnaTranscriptMessage, QnaTranscriptScanResult } from "./types.js";

type TextPart = { type: "text"; text: string };

function extractTextContent(message: { content?: unknown }): string {
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";

  return message.content
    .filter(
      (part: unknown): part is TextPart =>
        !!part && typeof part === "object" && (part as { type?: unknown }).type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function toTranscriptMessage(entry: SessionEntry): QnaTranscriptMessage | null {
  if (entry.type !== "message") return null;
  if (entry.message.role !== "user" && entry.message.role !== "assistant") return null;
  if (entry.message.role === "assistant" && entry.message.stopReason !== "stop") return null;

  const text = extractTextContent(entry.message);
  if (!text) return null;

  return {
    entryId: entry.id,
    role: entry.message.role,
    text,
  };
}

export function collectQnaTranscriptSinceBoundary(
  branch: SessionEntry[],
  durableBoundaryEntryId?: string,
): QnaTranscriptScanResult {
  const messages: QnaTranscriptMessage[] = [];
  let boundaryMatched = false;

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]!;

    if (durableBoundaryEntryId && entry.id === durableBoundaryEntryId) {
      boundaryMatched = true;
      break;
    }

    const message = toTranscriptMessage(entry);
    if (message) messages.push(message);
  }

  messages.reverse();

  return {
    messages,
    latestBranchEntryId: branch.at(-1)?.id,
    boundaryMatched,
  };
}
