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
    );

    expect((appended[0] as { durableBoundaryEntryId?: string }).durableBoundaryEntryId).toBe("c1");
    expect(notifications).toContainEqual({ message: "QnA ledger unchanged", level: "info" });
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
});
