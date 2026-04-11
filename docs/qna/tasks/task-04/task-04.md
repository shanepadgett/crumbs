# Task 04 — `/qna` branch-local ledger and transcript reconciliation

## Overview

Build the ordinary QnA branch-local data model and extraction pipeline on top of the shared runtime. This task creates the hidden branch ledger, durable scan boundary, incremental transcript scanning, and unresolved-question reconciliation against prior branch state.

## Grouping methodology

Everything here is specific to ordinary QnA state discovery and reconciliation within the current branch. It is one committable and testable unit because repeated `/qna` runs against the same branch can prove durable boundaries, silent closure, question replacement, and branch forking behavior without needing the ledger browser or full loop-control polish.

## Dependencies

- Tasks 01-03.

## Parallelization

- This starts the `/qna` track.
- Tasks 05-06 depend on this task.
- The `/interview` track can proceed in parallel once Task 03 is complete.

## Spec coverage

### `docs/qna/qna-inbox-spec.md`

- The system shall treat `/qna` as a simple current-branch question inbox.
  - Evidence: implemented — `extensions/qna/command.ts:runQnaCommand` reads only `ctx.sessionManager.getBranch()` and reconciles against branch-local `qna.state` snapshots.
- The system shall treat `/qna` as opportunistic capture for the current chat branch rather than as a repo-scoped planning system.
  - Evidence: implemented — `extensions/qna/command.ts` and `extensions/qna/transcript-scan.ts` only scan current-branch user/assistant transcript plus hydrated branch state; no repo-wide discovery code was added.
- The system shall maintain a hidden branch-local QnA ledger in session state.
  - Evidence: implemented — `extensions/qna/types.ts` defines `QNA_STATE_ENTRY = "qna.state"`; `extensions/qna/branch-state.ts:QnaBranchStateStore.replaceSnapshot` persists snapshots with `pi.appendEntry(...)` and `hydrateFromBranch()` reloads the latest valid branch entry.
- The branch-local QnA ledger shall track ordinary QnA question records, answer states, notes, unsent edits, and send state.
  - Evidence: implemented — `extensions/qna/types.ts` stores authoritative record `state` plus `sendState`, and `extensions/qna/branch-state.ts:hydrateFromBranch` overlays later `question-runtime.control` `draftSnapshot` payloads into `runtimeDraftsByQuestionId`; `extensions/qna/branch-state.test.ts` and `extensions/qna/command.test.ts` cover draft hydration and persistence.
- Each ordinary QnA record shall have one authoritative state, at minimum `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, or `superseded`.
  - Evidence: implemented — `extensions/qna/types.ts:QnaLedgerQuestionRecord` is a tagged union covering exactly `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, and `superseded`.
- `/qna` shall persist the shared runtime's latest `draftSnapshot` keyed by `questionId` so cancelled edits and hidden inactive branch drafts can be restored later.
  - Evidence: implemented — `extensions/qna/branch-state.ts:parseRuntimeDraftUpdateEntry` reads `form_submitted`/`form_cancelled` `question-runtime.control` entries and merges the latest per-question drafts into `runtimeDraftsByQuestionId`; `extensions/qna/command.ts:persistHydratedStateIfNeeded` writes that hydrated draft state back to `qna.state` without advancing the boundary; `extensions/qna/command.test.ts` covers it.
- The system shall maintain a branch-local durable scan boundary so repeated `/qna` runs do not rescan the full session.
  - Evidence: implemented — `extensions/qna/types.ts:QnaBranchStateSnapshot` stores `durableBoundaryEntryId`; `extensions/qna/transcript-scan.ts:collectQnaTranscriptSinceBoundary` scans backward until that entry.
- When the user forks a pi session, the ordinary QnA ledger, durable scan boundary, and unsent edits shall fork with that branch.
  - Evidence: implemented — `extensions/qna/branch-state.ts:hydrateFromBranch` rehydrates from the full current branch path, including ancestor `qna.state` snapshots and later `question-runtime.control` draft updates, and `extensions/qna/branch-state.test.ts` covers inherited ancestor state on a forked-branch fixture.
- When `/qna` runs, the system shall inspect only assistant and user transcript content plus branch-local ordinary QnA ledger state.
  - Evidence: implemented — `extensions/qna/transcript-scan.ts:toTranscriptMessage` accepts only `user` and completed `assistant` messages, and `extensions/qna/command.ts` passes only those messages plus `getUnresolvedQnaQuestions(currentState)` into reconciliation.
- When `/qna` runs, the system shall stop transcript scanning at the most recent durable boundary.
  - Evidence: implemented — `extensions/qna/transcript-scan.ts:collectQnaTranscriptSinceBoundary` breaks immediately when `entry.id === durableBoundaryEntryId` and reports `boundaryMatched`.
- When the stored durable boundary is missing from the current branch, `/qna` shall fall back to a full current-branch scan and shall not duplicate already tracked questions as net-new items.
  - Evidence: implemented — `extensions/qna/transcript-scan.ts` returns `boundaryMatched: false` and scans the full branch when the boundary is absent; `extensions/qna/command.ts` enables recovery dedupe in that case and `extensions/qna/reconcile.ts:applyQnaReconciliation` skips fingerprint matches; tests cover both paths in `transcript-scan.test.ts` and `reconcile.test.ts`.
- When QnA processing completes successfully, including the no-unresolved case, the system shall advance the durable boundary.
  - Evidence: implemented — `extensions/qna/command.ts` sets `result.nextState.durableBoundaryEntryId = transcript.latestBranchEntryId` on successful reconciliation and also updates the boundary in the no-op path before persisting.
- When a `/qna` run finds no new assistant or user transcript since the durable boundary, the system shall treat that run as a successful no-op, advance the boundary to the current branch tip, and show a notification.
  - Evidence: implemented — `extensions/qna/command.ts` short-circuits when `transcript.messages.length === 0`, persists a snapshot with the latest branch entry as boundary, and notifies `QnA ledger unchanged`; `extensions/qna/command.test.ts` covers it.
- When extraction is cancelled or fails before completion, the system shall not advance the durable boundary.
  - Evidence: implemented — `extensions/qna/command.ts` only calls `persistHydratedStateIfNeeded()` on failure and never changes `durableBoundaryEntryId` unless reconciliation succeeds or no-op completes; `extensions/qna/command.test.ts` covers both no-persist failure and persisted-drafts failure with the old boundary intact.
- When the model determines that an unresolved ordinary QnA question has already been answered naturally in chat, the system shall close that question silently in the branch-local ledger.
  - Evidence: implemented — `extensions/qna/types.ts` defines `action: "answered_in_chat"`; `extensions/qna/reconcile.ts:applyQnaReconciliation` transitions open records to `state: "answered_in_chat"`; `extensions/qna/reconcile.test.ts` covers the silent close.
- When newer chat has replaced an older open ordinary QnA question with a meaningfully different decision, the system shall close the old question and track the newer one as a separate question.
  - Evidence: implemented — `extensions/qna/reconcile.ts:applyQnaReconciliation` creates a new open record from `model.newQuestions` and rewrites the old open record to `state: "superseded"` with `supersededByQuestionId`; `extensions/qna/reconcile.test.ts` covers replacement.
- When `/qna` reconciles ledger state, the system shall give the model existing unresolved question IDs to update.
  - Evidence: implemented — `extensions/qna/reconcile.ts:getUnresolvedQnaQuestions` returns `{ questionId, questionText }` for open items, `extensions/qna/model-reconcile.ts:buildPromptText` sends them to the model, and `normalizeModelResponse()` rejects updates for unknown IDs.
- When `/qna` reconciles ledger state, the system shall ask the model to extract net-new questions separately from unresolved question updates.
  - Evidence: implemented — `extensions/qna/model-reconcile.ts` prompt/schema require separate `updates` and `newQuestions` arrays, and `normalizeModelResponse()` validates them independently.

## Expected end-to-end outcome

- `/qna` can incrementally discover and reconcile ordinary questions for the current branch without rescanning the entire transcript every time.
  - Evidence: implemented — `extensions/qna/command.ts`, `transcript-scan.ts`, and `reconcile.ts` compose boundary-aware incremental scans with recovery dedupe; `bun test extensions/qna/*.test.ts` passed.
- The branch-local ledger has one authoritative per-question state model and is ready to persist full shared-runtime `draftSnapshot` state for later restore without mixing it into transcript extraction.
  - Evidence: implemented — `extensions/qna/types.ts` separates authoritative `QnaLedgerQuestionRecord` state from `runtimeDraftsByQuestionId`, and `extensions/qna/branch-state.ts` plus `extensions/qna/command.ts` now hydrate and persist shared-runtime `draftSnapshot` data independently of transcript scanning.
- Existing unresolved questions can be updated, silently closed, or replaced when newer chat changes the underlying decision.
  - Evidence: implemented — `extensions/qna/model-reconcile.ts` and `extensions/qna/reconcile.ts` support unchanged items, `answered_in_chat`, and `replace` flows; `extensions/qna/reconcile.test.ts` exercises close and replace behavior.
- Recovery full scans do not duplicate already tracked questions as net-new items.
  - Evidence: implemented — `extensions/qna/reconcile.ts:buildQnaQuestionFingerprint` plus recovery dedupe on missing-boundary rescans prevent duplicate net-new records; `extensions/qna/reconcile.test.ts` covers dedupe.
- Successful no-op runs still advance the boundary and notify the user.
  - Evidence: implemented — `extensions/qna/command.ts` persists the latest boundary and calls `ctx.ui.notify("QnA ledger unchanged", "info")`; `extensions/qna/command.test.ts` covers the no-op case.
- Forked chats inherit the current ordinary QnA work instead of starting from nothing.
  - Evidence: implemented — `extensions/qna/branch-state.ts:hydrateFromBranch` reconstructs ledger state from ancestor branch entries and later draft updates on the current branch path; `extensions/qna/branch-state.test.ts` covers the fork-inheritance fixture.

## User test at exit

1. Run `/qna` on a branch with unresolved questions and confirm items land in a hidden branch-local ledger.
2. Run `/qna` again after new chat and confirm only content after the durable boundary is scanned.
3. Answer a question naturally in chat, rerun `/qna`, and confirm the prior open ledger item silently closes.
4. Fork the chat and confirm the new branch inherits the ordinary QnA ledger, scan boundary, and unsent edits.
5. Run `/qna` again with no new assistant or user transcript and confirm it only advances the boundary and shows a notification.
