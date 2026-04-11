import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { QnaBranchStateStore } from "./branch-state.js";
import type { QnaLoopController } from "./loop-controller.js";
import { reconcileQnaTranscript } from "./model-reconcile.js";
import { applyQnaReconciliation, getUnresolvedQnaQuestions } from "./reconcile.js";
import { collectQnaTranscriptSinceBoundary } from "./transcript-scan.js";
import type { QnaReconcileModelResponse } from "./types.js";

function formatSummary(stats: {
  newQuestions: number;
  recoveryDedupedQuestions: number;
  closedAnsweredInChat: number;
  replacedQuestions: number;
}): string {
  const parts: string[] = [];

  if (stats.newQuestions > 0) parts.push(`${stats.newQuestions} new`);
  if (stats.closedAnsweredInChat > 0) parts.push(`${stats.closedAnsweredInChat} answered in chat`);
  if (stats.replacedQuestions > 0) parts.push(`${stats.replacedQuestions} replaced`);
  if (stats.recoveryDedupedQuestions > 0) {
    parts.push(`${stats.recoveryDedupedQuestions} recovery deduped`);
  }

  return parts.length > 0 ? `QnA ledger updated: ${parts.join(", ")}` : "QnA ledger unchanged";
}

async function runModelReconciliation(
  ctx: ExtensionCommandContext,
  input: {
    transcript: Parameters<typeof reconcileQnaTranscript>[0]["transcript"];
    unresolvedQuestions: Parameters<typeof reconcileQnaTranscript>[0]["unresolvedQuestions"];
  },
): Promise<QnaReconcileModelResponse | null> {
  return ctx.ui.custom<QnaReconcileModelResponse | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(
      tui,
      theme,
      `Reconciling QnA ledger with ${ctx.model!.id}...`,
    );
    let finished = false;

    function finish(value: QnaReconcileModelResponse | null) {
      if (finished) return;
      finished = true;
      done(value);
    }

    loader.onAbort = () => finish(null);

    reconcileQnaTranscript(input, ctx, loader.signal)
      .then(finish)
      .catch(() => finish(null));

    return loader;
  });
}

function persistHydratedStateIfNeeded(
  store: QnaBranchStateStore,
  snapshot: ReturnType<QnaBranchStateStore["getSnapshot"]>,
): void {
  if (!store.needsPersistedHydration()) return;
  store.replaceSnapshot(snapshot);
}

function buildNoResultsMessage(summary?: string): string {
  return summary && summary !== "QnA ledger unchanged"
    ? `${summary}. No unresolved QnA questions remain.`
    : "No unresolved QnA questions remain";
}

function maybeStartLoop(
  ctx: ExtensionCommandContext,
  options: QnaCommandOptions,
  unresolvedQuestions: ReturnType<typeof getUnresolvedQnaQuestions>,
  discoverySummary?: string,
): boolean {
  if (unresolvedQuestions.length === 0) {
    ctx.ui.notify(buildNoResultsMessage(discoverySummary), "info");
    return false;
  }

  if (!ctx.model) {
    ctx.ui.notify("QnA loop cannot start without a selected model", "error");
    return false;
  }

  options.loopController.startLoop({
    openQuestions: unresolvedQuestions,
    discoverySummary,
  });
  return true;
}

export interface QnaCommandOptions {
  loopController: QnaLoopController;
  getAttachedInterviewSessionId: (branch: SessionEntry[]) => string | null;
}

export function registerQnaCommand(pi: ExtensionAPI, options: QnaCommandOptions): void {
  pi.registerCommand("qna", {
    description: "Reconcile branch-local transcript changes into the hidden QnA ledger",
    handler: async (_args, ctx) => runQnaCommand(pi, ctx, options),
  });
}

export async function runQnaCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: QnaCommandOptions,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/qna requires interactive UI mode", "error");
    return;
  }

  const branch = ctx.sessionManager.getBranch();
  const attachedInterviewSessionId = options.getAttachedInterviewSessionId(branch);
  if (attachedInterviewSessionId) {
    ctx.ui.notify(
      `This chat is attached to interview ${attachedInterviewSessionId}. Return to /interview instead of /qna.`,
      "warning",
    );
    return;
  }

  const store = new QnaBranchStateStore(pi);
  store.hydrateFromBranch(branch);
  const currentState = store.getSnapshot();

  const transcript = collectQnaTranscriptSinceBoundary(branch, currentState.durableBoundaryEntryId);

  if (transcript.messages.length === 0) {
    const nextState = store.getSnapshot();
    nextState.durableBoundaryEntryId = transcript.latestBranchEntryId;
    store.replaceSnapshot(nextState);
    maybeStartLoop(ctx, options, getUnresolvedQnaQuestions(nextState));
    return;
  }

  if (!ctx.model) {
    persistHydratedStateIfNeeded(store, currentState);
    ctx.ui.notify("No model selected", "error");
    return;
  }

  const unresolvedQuestions = getUnresolvedQnaQuestions(currentState);
  const modelResult = await runModelReconciliation(ctx, {
    transcript: transcript.messages,
    unresolvedQuestions,
  });

  if (modelResult === null) {
    persistHydratedStateIfNeeded(store, currentState);
    ctx.ui.notify("QnA reconciliation cancelled or failed", "warning");
    return;
  }

  const result = applyQnaReconciliation({
    state: currentState,
    model: modelResult,
    dedupeNewQuestionsAgainstExisting:
      !!currentState.durableBoundaryEntryId && !transcript.boundaryMatched,
  });

  result.nextState.durableBoundaryEntryId = transcript.latestBranchEntryId;
  store.replaceSnapshot(result.nextState);
  const summary = formatSummary(result.stats);
  if (!maybeStartLoop(ctx, options, getUnresolvedQnaQuestions(result.nextState), summary)) {
    return;
  }

  ctx.ui.notify(summary, "info");
}
