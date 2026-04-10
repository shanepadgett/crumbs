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
- The system shall treat `/qna` as opportunistic capture for the current chat branch rather than as a repo-scoped planning system.
- The system shall maintain a hidden branch-local QnA ledger in session state.
- The branch-local QnA ledger shall track ordinary QnA question records, answer states, notes, unsent edits, and send state.
- `/qna` shall persist the shared runtime's latest `draftSnapshot` keyed by `questionId` so cancelled edits and hidden inactive branch drafts can be restored later.
- The system shall maintain a branch-local durable scan boundary so repeated `/qna` runs do not rescan the full session.
- When the user forks a pi session, the ordinary QnA ledger, durable scan boundary, and unsent edits shall fork with that branch.
- When `/qna` runs, the system shall inspect only assistant and user transcript content plus branch-local ordinary QnA ledger state.
- When `/qna` runs, the system shall stop transcript scanning at the most recent durable boundary.
- When QnA processing completes successfully, including the no-unresolved case, the system shall advance the durable boundary.
- When extraction is cancelled or fails before completion, the system shall not advance the durable boundary.
- When the model determines that an unresolved ordinary QnA question has already been answered naturally in chat, the system shall close that question silently in the branch-local ledger.
- When newer chat has replaced an older open ordinary QnA question with a meaningfully different decision, the system shall close the old question and track the newer one as a separate question.
- When `/qna` reconciles ledger state, the system shall give the model existing unresolved question IDs to update.
- When `/qna` reconciles ledger state, the system shall ask the model to extract net-new questions separately from unresolved question updates.

## Expected end-to-end outcome

- `/qna` can incrementally discover and reconcile ordinary questions for the current branch without rescanning the entire transcript every time.
- The branch-local ledger is ready to persist full shared-runtime `draftSnapshot` state for later restore without mixing it into transcript extraction.
- Existing unresolved questions can be updated, silently closed, or replaced when newer chat changes the underlying decision.
- Forked chats inherit the current ordinary QnA work instead of starting from nothing.

## User test at exit

1. Run `/qna` on a branch with unresolved questions and confirm items land in a hidden branch-local ledger.
2. Run `/qna` again after new chat and confirm only content after the durable boundary is scanned.
3. Answer a question naturally in chat, rerun `/qna`, and confirm the prior open ledger item silently closes.
4. Fork the chat and confirm the new branch inherits the ordinary QnA ledger, scan boundary, and unsent edits.
