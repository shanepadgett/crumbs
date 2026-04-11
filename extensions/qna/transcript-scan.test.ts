import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { collectQnaTranscriptSinceBoundary } from "./transcript-scan.js";

function messageEntry(id: string, role: string, text: string, stopReason = "stop"): SessionEntry {
  return {
    id,
    type: "message",
    message: {
      role,
      stopReason,
      content: [{ type: "text", text }],
    },
  } as SessionEntry;
}

describe("collectQnaTranscriptSinceBoundary", () => {
  test("collects only assistant and user text in chronological order", () => {
    const result = collectQnaTranscriptSinceBoundary([
      messageEntry("u1", "user", "first"),
      messageEntry("t1", "toolResult", "skip"),
      { id: "c1", type: "custom", customType: "other", data: {} } as SessionEntry,
      messageEntry("a1", "assistant", "second"),
    ]);

    expect(result.messages).toEqual([
      { entryId: "u1", role: "user", text: "first" },
      { entryId: "a1", role: "assistant", text: "second" },
    ]);
    expect(result.latestBranchEntryId).toBe("a1");
  });

  test("stops at durable boundary", () => {
    const result = collectQnaTranscriptSinceBoundary(
      [messageEntry("u1", "user", "old"), messageEntry("a1", "assistant", "new")],
      "u1",
    );

    expect(result.boundaryMatched).toBe(true);
    expect(result.messages).toEqual([{ entryId: "a1", role: "assistant", text: "new" }]);
  });

  test("falls back to full scan when boundary is missing", () => {
    const result = collectQnaTranscriptSinceBoundary(
      [messageEntry("u1", "user", "first"), messageEntry("a1", "assistant", "second")],
      "missing",
    );

    expect(result.boundaryMatched).toBe(false);
    expect(result.messages).toHaveLength(2);
  });

  test("skips incomplete assistant messages", () => {
    const result = collectQnaTranscriptSinceBoundary([
      messageEntry("a1", "assistant", "partial", "length"),
      messageEntry("u1", "user", "keep"),
    ]);

    expect(result.messages).toEqual([{ entryId: "u1", role: "user", text: "keep" }]);
  });
});
