/**
 * Question Runtime Extension
 *
 * What it does:
 * - Adds shared low-level question request plumbing for authorized JSON files.
 * - Validates request payloads, sends hidden repair messages, enforces retry prompts, and launches an interactive form shell.
 *
 * How to use it:
 * - Call `question_runtime_request`, write JSON to the issued path, and keep repairing in place until valid.
 * - Valid requests open the shell immediately; exhausted retries ask Continue/Abort.
 *
 * Example:
 * - Use `question_runtime_request`, edit the emitted `@.../qr_0001.json`, then save a valid payload.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { showOptionPicker } from "../shared/option-picker.js";
import { showQuestionRuntimeFormShell } from "./form-shell.js";
import {
  buildAbortMessage,
  buildFormCancelledMessage,
  buildFormSubmittedMessage,
  buildRetryGrantedMessage,
  buildValidationFailureMessage,
} from "./repair-messages.js";
import { resolveRuntimeRequestDirectory } from "./request-paths.js";
import { QuestionRuntimeRequestStore } from "./request-store.js";
import {
  QuestionRuntimeRequestWatcher,
  type ValidatedRequestFileEvent,
} from "./request-watcher.js";
import { registerQuestionRuntimeRequestTool } from "./tool.js";
import type { AuthorizedQuestionRequest } from "./types.js";

interface ReadyQueueItem {
  requestId: string;
  request: AuthorizedQuestionRequest;
}

type ControlMessage =
  | ReturnType<typeof buildValidationFailureMessage>
  | ReturnType<typeof buildRetryGrantedMessage>
  | ReturnType<typeof buildAbortMessage>
  | ReturnType<typeof buildFormSubmittedMessage>
  | ReturnType<typeof buildFormCancelledMessage>;

export default function questionRuntimeExtension(pi: ExtensionAPI): void {
  const store = new QuestionRuntimeRequestStore(pi);

  let ctxRef: ExtensionContext | null = null;
  let watcher: QuestionRuntimeRequestWatcher | null = null;
  let requestDirectory: string | null = null;
  let modalOpen = false;
  let activeRetryRequestId: string | null = null;

  const retryQueue: string[] = [];
  const readyQueue: ReadyQueueItem[] = [];

  function sendHiddenMessage(message: ControlMessage): void {
    if (!ctxRef) return;
    if (ctxRef.isIdle()) {
      pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
      return;
    }
    pi.sendMessage(message, { deliverAs: "steer" });
  }

  function enqueueRetryPrompt(requestId: string): void {
    if (activeRetryRequestId === requestId) return;
    if (retryQueue.includes(requestId)) return;
    retryQueue.push(requestId);
  }

  function enqueueReadyShell(item: ReadyQueueItem): void {
    if (readyQueue.some((queued) => queued.requestId === item.requestId)) return;
    readyQueue.push(item);
  }

  function clearQueues(): void {
    retryQueue.length = 0;
    readyQueue.length = 0;
    activeRetryRequestId = null;
  }

  async function processValidatedFileEvent(event: ValidatedRequestFileEvent): Promise<void> {
    const record = store.getRecordByPath(event.absolutePath);
    if (!record) return;

    const shouldProcess = store.shouldProcess(record.requestId, event.contentHash);
    if (!shouldProcess.process) return;

    if (!event.validation.ok) {
      const invalid = store.recordInvalid(record.requestId, event.contentHash);
      if (!invalid) return;

      sendHiddenMessage(
        buildValidationFailureMessage({
          requestId: invalid.record.requestId,
          path: invalid.record.path,
          projectRelativePath: invalid.record.projectRelativePath,
          issues: event.validation.issues,
          failureCount: invalid.record.failureCount,
          allowedFailures: invalid.allowedFailures,
          retryDecisionRequired: invalid.exhaustionReached,
        }),
      );

      if (invalid.exhaustionReached) {
        enqueueRetryPrompt(invalid.record.requestId);
      }

      await flushVisibleQueue();
      return;
    }

    const ready = store.markReady(record.requestId, event.contentHash);
    if (!ready) return;
    enqueueReadyShell({ requestId: ready.requestId, request: event.validation.request });
    await flushVisibleQueue();
  }

  async function showRetryPrompt(requestId: string): Promise<void> {
    if (!ctxRef) return;
    const record = store.getRecordByRequestId(requestId);
    if (!record || !record.pendingRetryDecision) return;

    activeRetryRequestId = requestId;

    const result = await showOptionPicker(ctxRef, {
      title: "Question runtime retries exhausted",
      lines: [
        `requestId: ${record.requestId}`,
        `file: ${record.projectRelativePath}`,
        `failed validations: ${record.failureCount}/${store.allowedFailures(record.requestId)}`,
      ],
      options: [
        { id: "continue", label: "Continue (grant 4 more hidden retries)" },
        { id: "abort", label: "Abort this request" },
      ],
      cancelAction: "abort",
    });

    activeRetryRequestId = null;
    if (!result || result.action === "abort") {
      const aborted = store.abortRequest(requestId);
      if (aborted) {
        sendHiddenMessage(
          buildAbortMessage({
            requestId: aborted.requestId,
            path: aborted.path,
            projectRelativePath: aborted.projectRelativePath,
          }),
        );
      }
      return;
    }

    const continued = store.grantRetryBlock(requestId);
    if (!continued) return;
    sendHiddenMessage(
      buildRetryGrantedMessage({
        requestId: continued.requestId,
        path: continued.path,
        projectRelativePath: continued.projectRelativePath,
        allowedFailures: store.allowedFailures(continued.requestId),
      }),
    );
  }

  async function showReadyShell(item: ReadyQueueItem): Promise<void> {
    if (!ctxRef) return;
    const locked = store.lockRequest(item.requestId);
    if (!locked) return;

    const result = await showQuestionRuntimeFormShell(ctxRef, {
      requestId: item.requestId,
      projectRelativePath: locked.projectRelativePath,
      request: item.request,
    });

    if (result.action === "submit") {
      sendHiddenMessage(
        buildFormSubmittedMessage({
          requestId: item.requestId,
          path: locked.path,
          projectRelativePath: locked.projectRelativePath,
          draftSnapshot: result.draftSnapshot,
          submitResult: result.submitResult,
        }),
      );
      return;
    }

    sendHiddenMessage(
      buildFormCancelledMessage({
        requestId: item.requestId,
        path: locked.path,
        projectRelativePath: locked.projectRelativePath,
        draftSnapshot: result.draftSnapshot,
      }),
    );
  }

  async function flushVisibleQueue(): Promise<void> {
    if (modalOpen || !ctxRef) return;

    modalOpen = true;
    try {
      while (ctxRef) {
        const nextRetry = retryQueue.shift();
        if (nextRetry) {
          await showRetryPrompt(nextRetry);
          continue;
        }

        const nextReady = readyQueue.shift();
        if (nextReady) {
          await showReadyShell(nextReady);
          continue;
        }

        break;
      }
    } finally {
      modalOpen = false;
    }
  }

  async function rehydrateAndRescan(ctx: ExtensionContext): Promise<void> {
    ctxRef = ctx;
    store.hydrateFromBranch(ctx.sessionManager.getBranch());

    if (!requestDirectory) {
      const resolved = await resolveRuntimeRequestDirectory(pi.exec, ctx);
      requestDirectory = resolved.requestDirectory;
      watcher = new QuestionRuntimeRequestWatcher(requestDirectory, (event) => {
        void processValidatedFileEvent(event);
      });
      watcher.start();
    }

    watcher?.setKnownPaths(store.getKnownPaths());
    await watcher?.rescanKnownFiles();
    await flushVisibleQueue();
  }

  registerQuestionRuntimeRequestTool(pi, store, () => {
    watcher?.setKnownPaths(store.getKnownPaths());
  });

  pi.on("session_start", async (_event, ctx) => {
    clearQueues();
    await rehydrateAndRescan(ctx);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    clearQueues();
    await rehydrateAndRescan(ctx);
  });

  pi.on("session_shutdown", async () => {
    watcher?.stop();
    watcher = null;
    requestDirectory = null;
    clearQueues();
    ctxRef = null;
  });
}
