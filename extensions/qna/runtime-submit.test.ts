import { describe, expect, test } from "bun:test";
import { createEmptyQnaBranchState } from "./branch-state.js";
import { applyQnaDraftSnapshot, applyQnaStructuredSubmitResult } from "./runtime-submit.js";

function buildState() {
  const state = createEmptyQnaBranchState();
  state.durableBoundaryEntryId = "u1";
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
      sendState: { localRevision: 2, lastSentRevision: 0 },
    },
  ];
  return state;
}

describe("runtime-submit", () => {
  test("applies structured submit outcomes and leaves untouched questions open", () => {
    const state = buildState();
    const result = applyQnaStructuredSubmitResult({
      state,
      batchQuestionIds: ["qna_0001", "qna_0002"],
      draftSnapshot: [
        {
          questionId: "qna_0001",
          closureState: "open",
          questionNote: "",
          answerDraft: { kind: "freeform", text: "Sam", note: "" },
        },
      ],
      submitResult: {
        kind: "question_outcomes",
        requiresClarification: false,
        outcomes: [
          {
            questionId: "qna_0001",
            state: "answered",
            answer: { kind: "freeform", text: "Sam" },
          },
        ],
      },
    });

    expect(result.nextState.durableBoundaryEntryId).toBe("u1");
    expect(result.nextState.questions[0]?.state).toBe("answered");
    expect(result.nextState.questions[0]?.sendState.localRevision).toBe(2);
    expect(result.nextState.questions[1]?.state).toBe("open");
    expect(result.nextState.questions[1]?.sendState.localRevision).toBe(2);
    expect(result.stats).toEqual({ answered: 1, skipped: 0, needsClarification: 0, untouched: 1 });
    expect(result.remainingOpenQuestionIds).toEqual(["qna_0002"]);
  });

  test("keeps ledger open on no_user_response while persisting drafts", () => {
    const state = buildState();
    const result = applyQnaStructuredSubmitResult({
      state,
      batchQuestionIds: ["qna_0001"],
      draftSnapshot: [
        {
          questionId: "qna_0001",
          closureState: "needs_clarification",
          questionNote: "Need owner",
          answerDraft: { kind: "freeform", text: "", note: "" },
        },
      ],
      submitResult: {
        kind: "no_user_response",
        requiresClarification: false,
        outcomes: [],
      },
    });

    expect(result.nextState.questions[0]?.state).toBe("open");
    expect(result.changedQuestionIds).toEqual([]);
    expect(result.nextState.runtimeDraftsByQuestionId.qna_0001?.questionNote).toBe("Need owner");
    expect(result.remainingOpenQuestionIds).toEqual(["qna_0001", "qna_0002"]);
  });

  test("persists drafts without changing authoritative state", () => {
    const state = buildState();
    const nextState = applyQnaDraftSnapshot(state, [
      {
        questionId: "qna_0002",
        closureState: "open",
        questionNote: "Waiting on pm",
        answerDraft: { kind: "freeform", text: "Friday", note: "" },
      },
    ]);

    expect(nextState.questions).toEqual(state.questions);
    expect(nextState.runtimeDraftsByQuestionId.qna_0002?.questionNote).toBe("Waiting on pm");
  });
});
