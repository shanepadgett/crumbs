import { describe, expect, test } from "bun:test";
import { buildQnaLoopKickoffMessage, isQnaLoopKickoffMessage } from "./loop-control-message.js";

describe("loop-control-message", () => {
  test("builds hidden kickoff messages", () => {
    const message = buildQnaLoopKickoffMessage({
      type: "kickoff",
      loopId: "loop_1",
      openQuestionIds: ["qna_0001"],
      discoverySummary: "QnA ledger updated: 1 new",
    });

    expect(message.customType).toBe("qna.loop.control");
    expect(message.display).toBe(false);
    expect(
      isQnaLoopKickoffMessage({ role: "custom", ...message, timestamp: Date.now() } as any),
    ).toBe(true);
  });

  test("rejects malformed kickoff messages", () => {
    expect(
      isQnaLoopKickoffMessage({
        role: "custom",
        customType: "qna.loop.control",
        content: "bad",
        display: false,
        details: { type: "kickoff", loopId: "", openQuestionIds: [] },
        timestamp: Date.now(),
      } as any),
    ).toBe(false);
  });
});
