import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE } from "../question-runtime/repair-messages.js";
import { runQnaCommand } from "./command.js";
import { createEmptyQnaBranchState } from "./branch-state.js";
import { QNA_STATE_ENTRY } from "./types.js";

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    loopController: {
      startLoop() {
        return { startedNewLoop: true, loopId: "loop_1" };
      },
    },
    getAttachedInterviewSessionId() {
      return null;
    },
    ...overrides,
  } as any;
}

function customStateEntry(id: string, data: unknown): SessionEntry {
  return {
    id,
    type: "custom",
    customType: QNA_STATE_ENTRY,
    data,
  } as SessionEntry;
}

function userEntry(id: string, text: string): SessionEntry {
  return {
    id,
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
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
      type: "form_submitted",
      requestId: "req-1",
      path: "@tmp/req-1.json",
      projectRelativePath: "tmp/req-1.json",
      draftSnapshot,
      submitResult: { kind: "no_user_response", requiresClarification: false, outcomes: [] },
    },
  } as SessionEntry;
}

function makeContext(branch: SessionEntry[], overrides: Partial<ExtensionCommandContext> = {}) {
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    hasUI: true,
    model: { id: "test-model" },
    modelRegistry: {
      async getApiKeyAndHeaders() {
        return { ok: true, apiKey: "key", headers: {} };
      },
    },
    sessionManager: {
      getBranch() {
        return branch;
      },
    },
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      async custom() {
        return null;
      },
    },
    ...overrides,
  } as unknown as ExtensionCommandContext;

  return { ctx, notifications };
}

describe("runQnaCommand", () => {
  test("advances boundary on no-op success", async () => {
    const appended: unknown[] = [];
    const state = createEmptyQnaBranchState();
    state.durableBoundaryEntryId = "u1";

    const branch = [userEntry("u1", "old"), customStateEntry("c1", state)];
    const { ctx, notifications } = makeContext(branch, { model: undefined });

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions(),
    );

    expect((appended[0] as { durableBoundaryEntryId?: string }).durableBoundaryEntryId).toBe("c1");
    expect(notifications).toContainEqual({
      message: "No unresolved QnA questions remain",
      level: "info",
    });
  });

  test("does not persist on failure", async () => {
    const appended: unknown[] = [];
    const state = createEmptyQnaBranchState();
    state.durableBoundaryEntryId = "u1";

    const branch = [customStateEntry("c1", state), userEntry("u2", "new")];
    const { ctx, notifications } = makeContext(branch);

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions(),
    );

    expect(appended).toHaveLength(0);
    expect(notifications).toContainEqual({
      message: "QnA reconciliation cancelled or failed",
      level: "warning",
    });
  });

  test("missing model only errors when reconciliation is needed", async () => {
    const appended: unknown[] = [];
    const state = createEmptyQnaBranchState();
    state.durableBoundaryEntryId = "missing";

    const branch = [userEntry("u1", "new")];
    const { ctx, notifications } = makeContext(branch, { model: undefined });

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions(),
    );

    expect(appended).toHaveLength(0);
    expect(notifications).toContainEqual({ message: "No model selected", level: "error" });
  });

  test("persists hydrated runtime drafts without advancing boundary when reconciliation fails", async () => {
    const appended: unknown[] = [];
    const state = createEmptyQnaBranchState();
    state.durableBoundaryEntryId = "u1";

    const branch = [
      userEntry("u1", "old"),
      customStateEntry("c1", state),
      runtimeDraftEntry("qr1", [
        {
          questionId: "qna_0001",
          closureState: "needs_clarification",
          questionNote: "Need owner",
          answerDraft: { kind: "freeform", text: "", note: "" },
        },
      ]),
      userEntry("u2", "new"),
    ];
    const { ctx, notifications } = makeContext(branch);

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions(),
    );

    expect(appended).toHaveLength(1);
    expect((appended[0] as { durableBoundaryEntryId?: string }).durableBoundaryEntryId).toBe("u1");
    expect(
      (
        appended[0] as {
          runtimeDraftsByQuestionId: Record<string, { questionNote: string }>;
        }
      ).runtimeDraftsByQuestionId.qna_0001?.questionNote,
    ).toBe("Need owner");
    expect(notifications).toContainEqual({
      message: "QnA reconciliation cancelled or failed",
      level: "warning",
    });
  });

  test("starts loop when unresolved backlog exists after no-op", async () => {
    const appended: unknown[] = [];
    const started: unknown[] = [];
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
    ];

    const branch = [userEntry("u1", "old"), customStateEntry("c1", state)];
    const { ctx, notifications } = makeContext(branch, { model: { id: "test-model" } as any });

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions({
        loopController: {
          startLoop(input: unknown) {
            started.push(input);
            return { startedNewLoop: true, loopId: "loop_1" };
          },
        },
      }),
    );

    expect(appended).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(notifications).toHaveLength(0);
  });

  test("starts one merged loop with existing backlog plus newly reconciled questions", async () => {
    const appended: unknown[] = [];
    const started: unknown[] = [];
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
    ];

    const branch = [
      userEntry("u1", "old"),
      customStateEntry("c1", state),
      userEntry("u2", "We still need to decide the deadline."),
    ];
    const { ctx, notifications } = makeContext(branch, {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
        async custom() {
          return {
            updates: [],
            newQuestions: [{ ref: "ref_1", questionText: "What is the deadline?" }],
          };
        },
      },
    } as unknown as Partial<ExtensionCommandContext>);

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions({
        loopController: {
          startLoop(input: unknown) {
            started.push(input);
            return { startedNewLoop: true, loopId: "loop_1" };
          },
        },
      }),
    );

    expect(appended).toHaveLength(1);
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual({
      openQuestions: [
        { questionId: "qna_0001", questionText: "Who owns this?" },
        { questionId: "qna_0002", questionText: "What is the deadline?" },
      ],
      discoverySummary: "QnA ledger updated: 1 new",
    });
    expect(notifications).toContainEqual({
      message: "QnA ledger updated: 1 new",
      level: "info",
    });
  });

  test("blocks when chat is attached to an interview", async () => {
    const appended: unknown[] = [];
    const branch = [userEntry("u1", "old")];
    const { ctx, notifications } = makeContext(branch);

    await runQnaCommand(
      {
        appendEntry(_type: string, data: unknown) {
          appended.push(data);
        },
      } as unknown as ExtensionAPI,
      ctx,
      makeOptions({
        getAttachedInterviewSessionId() {
          return "int_123";
        },
      }),
    );

    expect(appended).toHaveLength(0);
    expect(notifications[0]?.message).toContain("int_123");
  });
});
