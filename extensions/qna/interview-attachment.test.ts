import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
  INTERVIEW_CHAT_ATTACHMENT_ENTRY,
  getAttachedInterviewSessionIdFromBranch,
} from "./interview-attachment.js";

function attachmentEntry(id: string, data: unknown): SessionEntry {
  return {
    id,
    type: "custom",
    customType: INTERVIEW_CHAT_ATTACHMENT_ENTRY,
    data,
  } as SessionEntry;
}

describe("interview-attachment", () => {
  test("latest valid entry wins", () => {
    expect(
      getAttachedInterviewSessionIdFromBranch([
        attachmentEntry("a1", { schemaVersion: 1, interviewSessionId: "int_1" }),
        attachmentEntry("a2", { schemaVersion: 1, interviewSessionId: "int_2" }),
      ]),
    ).toBe("int_2");
  });

  test("ignores malformed entries and supports null clear", () => {
    expect(
      getAttachedInterviewSessionIdFromBranch([
        attachmentEntry("a1", { schemaVersion: 1, interviewSessionId: "int_1" }),
        attachmentEntry("a2", { bad: true }),
        attachmentEntry("a3", { schemaVersion: 1, interviewSessionId: null }),
      ]),
    ).toBeNull();
  });
});
