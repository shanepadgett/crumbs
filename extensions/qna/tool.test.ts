import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createEmptyQnaBranchState } from "./branch-state.js";
import { registerQnaTool } from "./tool.js";
import { QNA_STATE_ENTRY } from "./types.js";

function customStateEntry(id: string, data: unknown) {
  return {
    id,
    type: "custom",
    customType: QNA_STATE_ENTRY,
    data,
  } as any;
}

function buildState() {
  const state = createEmptyQnaBranchState();
  state.questions = [
    {
      questionId: "qna_0001",
      questionText: "Who owns this?",
      questionFingerprint: "who owns this",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    },
    {
      questionId: "qna_0002",
      questionText: "What is the deadline?",
      questionFingerprint: "what is the deadline",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    },
  ];
  return state;
}

function makePi() {
  let tool: any;
  const appended: unknown[] = [];
  return {
    appended,
    register(piOptions: Parameters<typeof registerQnaTool>[1]) {
      registerQnaTool(
        {
          registerTool(definition: unknown) {
            tool = definition;
          },
          appendEntry(_type: string, data: unknown) {
            appended.push(data);
          },
        } as unknown as ExtensionAPI,
        piOptions,
      );
      return tool;
    },
  };
}

describe("qna tool", () => {
  test("rejects stale question ids", async () => {
    const settled: string[] = [];
    const pi = makePi();
    const tool = pi.register({
      loopController: {
        isActive() {
          return true;
        },
        markSettled(reason: string) {
          settled.push(reason);
        },
      } as any,
      async showForm() {
        throw new Error("should not open");
      },
    });

    await expect(
      tool.execute(
        "call_1",
        { action: "question_batch", questionIds: ["missing"] },
        undefined,
        undefined,
        {
          hasUI: true,
          sessionManager: {
            getBranch() {
              return [customStateEntry("c1", buildState())];
            },
          },
          ui: { notify() {} },
        },
      ),
    ).rejects.toThrow("not currently open");

    expect(settled).toEqual([]);
  });

  test("persists drafts only on cancel", async () => {
    const pi = makePi();
    const tool = pi.register({
      loopController: {
        isActive() {
          return true;
        },
        markSettled() {},
      } as any,
      async showForm() {
        return {
          action: "cancel",
          draftSnapshot: [
            {
              questionId: "qna_0001",
              closureState: "open",
              questionNote: "Need owner",
              answerDraft: { kind: "freeform", text: "", note: "" },
            },
          ],
        };
      },
    });

    const result = await tool.execute(
      "call_1",
      { action: "question_batch", questionIds: ["qna_0001"] },
      undefined,
      undefined,
      {
        hasUI: true,
        sessionManager: {
          getBranch() {
            return [customStateEntry("c1", buildState())];
          },
        },
        ui: { notify() {} },
      },
    );

    expect(result.details.kind).toBe("question_batch_cancelled");
    expect(
      (pi.appended[0] as { runtimeDraftsByQuestionId: Record<string, { questionNote: string }> })
        .runtimeDraftsByQuestionId.qna_0001?.questionNote,
    ).toBe("Need owner");
  });

  test("settles on no_user_response without fabricating an answer summary", async () => {
    const settled: string[] = [];
    const notices: string[] = [];
    const pi = makePi();
    const tool = pi.register({
      loopController: {
        isActive() {
          return true;
        },
        markSettled(reason: string) {
          settled.push(reason);
        },
      } as any,
      async showForm() {
        return {
          action: "submit",
          draftSnapshot: [],
          submitResult: {
            kind: "no_user_response",
            requiresClarification: false,
            outcomes: [],
          },
        };
      },
    });

    const result = await tool.execute(
      "call_1",
      { action: "question_batch", questionIds: ["qna_0001"] },
      undefined,
      undefined,
      {
        hasUI: true,
        sessionManager: {
          getBranch() {
            return [customStateEntry("c1", buildState())];
          },
        },
        ui: {
          notify(message: string) {
            notices.push(message);
          },
        },
      },
    );

    expect(result.details.kind).toBe("no_user_response_settled");
    expect(result.content[0]?.text).toBe("No user response submitted.");
    expect(settled).toEqual(["no_user_response"]);
    expect(notices[0]).toContain("no submitted outcomes");
  });

  test("completes loop without changing remaining backlog", async () => {
    const settled: string[] = [];
    const pi = makePi();
    const tool = pi.register({
      loopController: {
        isActive() {
          return true;
        },
        markSettled(reason: string) {
          settled.push(reason);
        },
      } as any,
    });

    const result = await tool.execute("call_1", { action: "complete" }, undefined, undefined, {
      hasUI: true,
      sessionManager: {
        getBranch() {
          return [customStateEntry("c1", buildState())];
        },
      },
      ui: { notify() {} },
    });

    expect(result.details.kind).toBe("loop_completed");
    expect(result.details.remainingOpenQuestionIds).toEqual(["qna_0001", "qna_0002"]);
    expect(pi.appended).toHaveLength(0);
    expect(settled).toEqual(["agent_complete"]);
  });
});
