import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { showQuestionRuntimeFormShell } from "../question-runtime/form-shell.js";
import { validateAuthorizedQuestionRequest } from "../question-runtime/request-validator.js";
import type {
  AuthorizedQuestionRequest,
  QuestionRuntimeFormResult,
} from "../question-runtime/types.js";
import { QnaBranchStateStore } from "./branch-state.js";
import { QnaLoopController } from "./loop-controller.js";
import { applyQnaDraftSnapshot, applyQnaStructuredSubmitResult } from "./runtime-submit.js";
import type {
  QnaBranchStateSnapshot,
  QnaOpenQuestionReference,
  QnaToolInput,
  QnaToolResultDetails,
} from "./types.js";

const QNA_TOOL_PARAMS = Type.Union([
  Type.Object({
    action: Type.Literal("question_batch"),
    questionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  }),
  Type.Object({
    action: Type.Literal("complete"),
    reason: Type.Optional(Type.String()),
  }),
]);

function getOpenQuestions(state: QnaBranchStateSnapshot): QnaOpenQuestionReference[] {
  return state.questions
    .filter((question) => question.state === "open")
    .map((question) => ({ questionId: question.questionId, questionText: question.questionText }));
}

function getOpenQuestionMap(state: QnaBranchStateSnapshot) {
  return new Map(
    state.questions
      .filter((question) => question.state === "open")
      .map((question) => [question.questionId, question]),
  );
}

function dedupeQuestionIds(questionIds: string[]): string[] {
  return [...new Set(questionIds)];
}

export interface RegisterQnaToolOptions {
  loopController: QnaLoopController;
  showForm?: typeof showQuestionRuntimeFormShell;
}

export function buildQuestionRuntimeRequest(input: {
  state: QnaBranchStateSnapshot;
  batchQuestionIds: string[];
}): AuthorizedQuestionRequest {
  const openQuestions = getOpenQuestionMap(input.state);

  return {
    questions: input.batchQuestionIds.map((questionId) => {
      const question = openQuestions.get(questionId);
      if (!question) {
        throw new Error(`Question ${questionId} is not currently open`);
      }

      return {
        questionId: question.questionId,
        kind: "freeform" as const,
        prompt: question.questionText,
        justification:
          "Structured manual QnA review captures the current authoritative outcome for this open ledger question.",
        suggestedAnswer: "Answer with the clearest current decision, fact, or unresolved blocker.",
      };
    }),
    draftSnapshot: input.batchQuestionIds
      .map((questionId) => input.state.runtimeDraftsByQuestionId[questionId])
      .filter((draft) => !!draft),
  };
}

function validateBatchInput(state: QnaBranchStateSnapshot, questionIds: string[]): string[] {
  const batchQuestionIds = dedupeQuestionIds(questionIds);
  if (batchQuestionIds.length === 0) {
    throw new Error("questionIds must contain at least one open question id");
  }

  const openQuestions = getOpenQuestionMap(state);
  for (const questionId of batchQuestionIds) {
    if (!openQuestions.has(questionId)) {
      throw new Error(`Question ${questionId} is not currently open`);
    }
  }

  return batchQuestionIds;
}

async function executeQuestionBatch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: RegisterQnaToolOptions,
  state: QnaBranchStateSnapshot,
  questionIds: string[],
): Promise<{ content: Array<{ type: "text"; text: string }>; details: QnaToolResultDetails }> {
  const batchQuestionIds = validateBatchInput(state, questionIds);
  const request = buildQuestionRuntimeRequest({ state, batchQuestionIds });
  const validation = validateAuthorizedQuestionRequest(JSON.stringify(request));
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.message ?? "Invalid qna runtime request");
  }

  const formResult: QuestionRuntimeFormResult = await (
    options.showForm ?? showQuestionRuntimeFormShell
  )(ctx, {
    requestId: "qna/manual",
    projectRelativePath: "qna/manual",
    request,
  });

  const store = new QnaBranchStateStore(pi);
  store.hydrateFromBranch(ctx.sessionManager.getBranch());
  const latestState = store.getSnapshot();

  if (formResult.action === "cancel") {
    const nextState = applyQnaDraftSnapshot(latestState, formResult.draftSnapshot);
    store.replaceSnapshot(nextState);
    const remainingOpenQuestionIds = getOpenQuestions(nextState).map(
      (question) => question.questionId,
    );
    return {
      content: [{ type: "text", text: "QnA batch cancelled." }],
      details: {
        kind: "question_batch_cancelled",
        remainingOpenQuestionIds,
        loopSettled: false,
      },
    };
  }

  const applied = applyQnaStructuredSubmitResult({
    state: latestState,
    batchQuestionIds,
    draftSnapshot: formResult.draftSnapshot,
    submitResult: formResult.submitResult,
  });
  store.replaceSnapshot(applied.nextState);

  if (formResult.submitResult.kind === "no_user_response") {
    ctx.ui.notify("QnA loop settled with no submitted outcomes", "info");
    options.loopController.markSettled("no_user_response");
    return {
      content: [{ type: "text", text: "No user response submitted." }],
      details: {
        kind: "no_user_response_settled",
        remainingOpenQuestionIds: applied.remainingOpenQuestionIds,
        loopSettled: true,
      },
    };
  }

  const loopSettled = applied.remainingOpenQuestionIds.length === 0;
  if (loopSettled) {
    options.loopController.markSettled("all_questions_resolved");
  }

  return {
    content: [{ type: "text", text: "QnA batch submitted." }],
    details: {
      kind: "question_batch_submitted",
      submitResult: formResult.submitResult,
      remainingOpenQuestionIds: applied.remainingOpenQuestionIds,
      loopSettled,
    },
  };
}

export function registerQnaTool(pi: ExtensionAPI, options: RegisterQnaToolOptions): void {
  pi.registerTool({
    name: "qna",
    label: "QnA",
    description: "Review open ordinary QnA ledger questions during an active /qna loop.",
    promptSnippet: "Review open ordinary QnA questions during an active /qna loop",
    promptGuidelines: [
      "Use qna only while a manual /qna loop is active.",
      'Use action: "question_batch" for structured review of specific open questionIds.',
      'Use action: "complete" only when the current /qna loop should end without closing remaining backlog.',
    ],
    parameters: QNA_TOOL_PARAMS,
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold(`qna ${args.action}`)), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!options.loopController.isActive()) {
        throw new Error("qna is available only during an active /qna loop");
      }

      if (!ctx.hasUI) {
        throw new Error("qna requires interactive UI mode");
      }

      const store = new QnaBranchStateStore(pi);
      store.hydrateFromBranch(ctx.sessionManager.getBranch());
      const state = store.getSnapshot();
      const input = params as QnaToolInput;

      if (input.action === "complete") {
        options.loopController.markSettled("agent_complete");
        return {
          content: [{ type: "text", text: "QnA loop completed." }],
          details: {
            kind: "loop_completed",
            remainingOpenQuestionIds: getOpenQuestions(state).map(
              (question) => question.questionId,
            ),
            loopSettled: true,
          },
        };
      }

      return executeQuestionBatch(pi, ctx, options, state, input.questionIds);
    },
  });
}
