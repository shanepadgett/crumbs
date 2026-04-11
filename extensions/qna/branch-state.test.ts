import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE } from "../question-runtime/repair-messages.js";
import { QnaBranchStateStore, createEmptyQnaBranchState } from "./branch-state.js";
import { QNA_STATE_ENTRY } from "./types.js";

function customEntry(id: string, data: unknown): SessionEntry {
  return {
    id,
    type: "custom",
    customType: QNA_STATE_ENTRY,
    data,
  } as SessionEntry;
}

function runtimeDraftEntry(id: string, draftSnapshot: unknown): SessionEntry {
  return {
    id,
    type: "custom_message",
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content: "Question runtime draft update",
    display: false,
    details: {
      type: "form_cancelled",
      requestId: "req-1",
      path: "@tmp/req-1.json",
      projectRelativePath: "tmp/req-1.json",
      draftSnapshot,
    },
  } as SessionEntry;
}

describe("QnaBranchStateStore", () => {
  test("latest valid snapshot wins", () => {
    const store = new QnaBranchStateStore({ appendEntry() {} } as unknown as ExtensionAPI);
    store.hydrateFromBranch([
      customEntry("a", createEmptyQnaBranchState()),
      customEntry("b", {
        schemaVersion: 1,
        durableBoundaryEntryId: "entry-2",
        nextQuestionSequence: 2,
        questions: [
          {
            questionId: "qna_0001",
            questionText: "Ship it?",
            questionFingerprint: "ship it",
            state: "open",
            sendState: { localRevision: 1, lastSentRevision: 0 },
          },
        ],
        runtimeDraftsByQuestionId: {},
      }),
    ]);

    expect(store.getSnapshot().durableBoundaryEntryId).toBe("entry-2");
    expect(store.getSnapshot().questions).toHaveLength(1);
  });

  test("ignores malformed snapshots and falls back to empty state", () => {
    const store = new QnaBranchStateStore({ appendEntry() {} } as unknown as ExtensionAPI);
    store.hydrateFromBranch([
      customEntry("a", { schemaVersion: 1, nextQuestionSequence: -1, questions: [] }),
    ]);

    expect(store.getSnapshot()).toEqual(createEmptyQnaBranchState());
  });

  test("returns cloned snapshots", () => {
    const appended: unknown[] = [];
    const store = new QnaBranchStateStore({
      appendEntry(_type: string, data: unknown) {
        appended.push(data);
      },
    } as unknown as ExtensionAPI);
    store.hydrateFromBranch([]);

    const snapshot = store.getSnapshot();
    snapshot.questions.push({
      questionId: "qna_0001",
      questionText: "Mutated?",
      questionFingerprint: "mutated",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    });

    expect(store.getSnapshot().questions).toHaveLength(0);

    const replacement = createEmptyQnaBranchState();
    replacement.questions.push({
      questionId: "qna_0001",
      questionText: "Persisted?",
      questionFingerprint: "persisted",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    });
    store.replaceSnapshot(replacement);
    replacement.questions[0]!.questionText = "changed after replace";

    expect(store.getSnapshot().questions[0]?.questionText).toBe("Persisted?");
    expect(
      (appended[0] as { questions: Array<{ questionText: string }> }).questions[0]?.questionText,
    ).toBe("Persisted?");
  });

  test("rehydrates ancestor state and later runtime drafts on a forked branch", () => {
    const store = new QnaBranchStateStore({ appendEntry() {} } as unknown as ExtensionAPI);
    const ancestorState = createEmptyQnaBranchState();
    ancestorState.durableBoundaryEntryId = "ancestor-tip";
    ancestorState.nextQuestionSequence = 2;
    ancestorState.questions.push({
      questionId: "qna_0001",
      questionText: "Ship it?",
      questionFingerprint: "ship it",
      state: "open",
      sendState: { localRevision: 1, lastSentRevision: 0 },
    });

    store.hydrateFromBranch([
      customEntry("ancestor-state", ancestorState),
      runtimeDraftEntry("fork-draft-1", [
        {
          questionId: "qna_0001",
          closureState: "needs_clarification",
          questionNote: "Need owner",
          answerDraft: { kind: "freeform", text: "", note: "" },
        },
      ]),
      runtimeDraftEntry("fork-draft-2", [
        {
          questionId: "qna_0001",
          closureState: "needs_clarification",
          questionNote: "Need final owner",
          answerDraft: { kind: "freeform", text: "", note: "" },
        },
      ]),
    ]);

    expect(store.getSnapshot().durableBoundaryEntryId).toBe("ancestor-tip");
    expect(store.getSnapshot().questions[0]?.questionId).toBe("qna_0001");
    expect(store.getSnapshot().runtimeDraftsByQuestionId.qna_0001?.questionNote).toBe(
      "Need final owner",
    );
    expect(store.needsPersistedHydration()).toBe(true);
  });
});
