import { describe, expect, test } from "bun:test";
import { applyQnaReconciliation } from "./reconcile.js";
import type { QnaBranchStateSnapshot } from "./types.js";

function baseState(): QnaBranchStateSnapshot {
  return {
    schemaVersion: 1,
    durableBoundaryEntryId: "entry-1",
    nextQuestionSequence: 2,
    questions: [
      {
        questionId: "qna_0001",
        questionText: "Ship it?",
        questionFingerprint: "ship it",
        state: "open",
        sendState: { localRevision: 2, lastSentRevision: 1 },
      },
    ],
    runtimeDraftsByQuestionId: {
      qna_0001: {
        questionId: "qna_0001",
        closureState: "open",
        questionNote: "keep",
        answerDraft: { kind: "freeform", text: "draft", note: "" },
      },
    },
  };
}

describe("applyQnaReconciliation", () => {
  test("closes answered-in-chat questions silently", () => {
    const result = applyQnaReconciliation({
      state: baseState(),
      model: {
        updates: [{ questionId: "qna_0001", action: "answered_in_chat" }],
        newQuestions: [],
      },
      dedupeNewQuestionsAgainstExisting: false,
    });

    expect(result.nextState.questions[0]).toMatchObject({
      questionId: "qna_0001",
      state: "answered_in_chat",
      sendState: { localRevision: 3, lastSentRevision: 1 },
    });
    expect(result.stats.closedAnsweredInChat).toBe(1);
    expect(result.nextState.runtimeDraftsByQuestionId.qna_0001?.questionNote).toBe("keep");
  });

  test("replaces old questions with distinct new records", () => {
    const result = applyQnaReconciliation({
      state: baseState(),
      model: {
        updates: [{ questionId: "qna_0001", action: "replace", replacementRef: "n1" }],
        newQuestions: [{ ref: "n1", questionText: "Ship with feature flag?" }],
      },
      dedupeNewQuestionsAgainstExisting: false,
    });

    expect(result.nextState.questions[0]).toMatchObject({
      questionId: "qna_0001",
      state: "superseded",
      supersededByQuestionId: "qna_0002",
      sendState: { localRevision: 3, lastSentRevision: 1 },
    });
    expect(result.nextState.questions[1]).toMatchObject({
      questionId: "qna_0002",
      questionText: "Ship with feature flag?",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    });
    expect(result.nextState.nextQuestionSequence).toBe(3);
    expect(result.stats.replacedQuestions).toBe(1);
    expect(result.stats.newQuestions).toBe(1);
  });

  test("dedupes recovery-scan questions against tracked records", () => {
    const result = applyQnaReconciliation({
      state: baseState(),
      model: {
        updates: [],
        newQuestions: [{ ref: "n1", questionText: "Ship it?!" }],
      },
      dedupeNewQuestionsAgainstExisting: true,
    });

    expect(result.nextState.questions).toHaveLength(1);
    expect(result.stats.recoveryDedupedQuestions).toBe(1);
    expect(result.stats.newQuestions).toBe(0);
  });
});
