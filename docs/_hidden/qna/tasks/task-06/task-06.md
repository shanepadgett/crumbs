# Task 06 — `/qna-ledger` overlay, batched sends, and Markdown export

## Overview

Build the ordinary QnA ledger browser for the current branch. This task adds the `/qna-ledger` overlay, state filtering across the authoritative record state model from tasks 04-05, direct editing of branch-local records, batched update sending, and timestamped Markdown export under `docs/qna/`.

## Grouping methodology

This is one committable and testable unit because it is the complete maintenance surface for ordinary QnA outside the live `/qna` loop. A user can browse, edit, send, and export ordinary questions without touching Interview or transcript extraction logic.

## Dependencies

- Tasks 04-05.

## Parallelization

- This completes the ordinary QnA track.

## Spec coverage

### `docs/qna/qna-inbox-spec.md`

- The system shall provide `/qna-ledger` as the browsing and editing view for ordinary QnA items.
  - Evidence: implemented — `extensions/qna.ts` registers `registerQnaLedgerCommand(...)`; `extensions/qna/ledger-command.ts:registerQnaLedgerCommand` adds `/qna-ledger` and runs the ordinary-ledger command loop.
- `/qna` and `/qna-ledger` shall not display or manage interview sessions.
  - Evidence: implemented — `extensions/qna/command.ts:runQnaCommand` and `extensions/qna/ledger-command.ts:runQnaLedgerCommand` both early-return on attached interviews; `/qna-ledger` reads only `QnaBranchStateStore` ordinary records and never loads interview UI/state.
- When the current chat is attached to an interview session, the system shall block `/qna-ledger` and direct the user back to the interview instead of mixing the two systems in one chat.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:71-77` checks `getAttachedInterviewSessionId(...)` and warns `Return to /interview instead of /qna-ledger.` before exiting.
- When the user runs `/qna-ledger`, the system shall open a simple ordinary-QnA ledger overlay for the current branch.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:79-88` hydrates current-branch ledger state and calls `showQnaLedgerOverlay(...)` in a command loop.
- The `/qna-ledger` overlay shall prioritize browsing and filtering ordinary QnA questions rather than cross-session planning.
  - Evidence: implemented — `extensions/qna/ledger-overlay.ts` renders a simple per-record list with filter/select/edit/reopen/send/export controls only; no cross-session planning or interview navigation is present.
- The `/qna-ledger` overlay shall expose the authoritative ordinary-QnA record state for filtering and editing, including transcript-closed states such as `answered_in_chat` and `superseded`.
  - Evidence: implemented — `extensions/qna/ledger-overlay.ts:FILTERS` includes `answered_in_chat` and `superseded`; `extensions/qna/ledger-command.ts:24-31` allows editing `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, and `superseded` records.
- The `/qna-ledger` overlay shall allow filtering by question state.
  - Evidence: implemented — `extensions/qna/ledger-overlay.ts:FILTERS` defines state filters and `handleInput` rotates them with `←→`; `getVisibleQuestions(...)` filters by `question.state`.
- The `/qna-ledger` overlay shall allow answering, skipping, marking `needs_clarification`, reopening, and editing previously closed ordinary QnA questions.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:95-128` opens the shared runtime form for closed and open records; `extensions/qna/ledger-records.ts:41-94` applies answered/skipped/needs_clarification edits; `extensions/qna/ledger-command.ts:132-140` supports explicit reopen.
- When the user edits an ordinary QnA question from `/qna-ledger`, the system shall update the branch-local ledger immediately.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:111-127` reloads latest branch state, applies the edit, and immediately persists with `latestStore.replaceSnapshot(...)`.
- The `/qna-ledger` overlay shall provide a manual `Send updates` action.
  - Evidence: implemented — `extensions/qna/ledger-overlay.ts:111-120,191-199` binds `s` to `send_updates` and shows a send key hint.
- When `/qna-ledger` sends updates, the system shall batch all unsent changed ordinary QnA items into one structured payload.
  - Evidence: implemented — `extensions/qna/send.ts:20-33` builds one `QnaLedgerSendBatch` with all pending items; `extensions/qna/ledger-command.ts:147-166` sends one structured `qna.ledger.send` message built from that batch.
- When `/qna-ledger` sends updates, the system shall send only items changed since the last send.
  - Evidence: implemented — `extensions/qna/send.ts:5-18` selects only records where `localRevision > lastSentRevision`; `extensions/qna/send.ts:35-52` advances `lastSentRevision` after send.
- When `/qna-ledger` sends updates and any item is `needs_clarification`, the system shall reactivate the loop-scoped `qna` tool.
  - Evidence: implemented — `extensions/qna/send.ts:20-33` sets `requiresClarification`; `extensions/qna/ledger-command.ts:160-166` starts a `qna_ledger_send` loop when that flag is true.
- When `/qna-ledger` reactivates the loop-scoped `qna` tool after a `needs_clarification` send, the system shall preserve the existing structured-review semantics of `qna` for currently `open` ordinary QnA items while allowing clarification follow-up to continue in ordinary chat and later ledger edits.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:47-54,160-166` scopes review questions to currently `open` items only; `extensions/qna/tool.ts:47-93` still rejects ids outside the active loop and only builds requests for `allowedStates: ["open"]`; `extensions/qna/loop-controller.ts:116-129` adds source-specific prompt text telling the agent to continue clarification follow-up in ordinary chat.
- The `/qna-ledger` overlay shall provide an export action.
  - Evidence: implemented — `extensions/qna/ledger-overlay.ts:115-123,191-199` binds `x` to `export_markdown` and shows an export key hint.
- When the user exports ordinary QnA state, the system shall write a timestamped Markdown snapshot under `docs/qna/`.
  - Evidence: implemented — `extensions/qna/ledger-command.ts:182-188` calls `writeQnaLedgerMarkdownSnapshot(...)`; `extensions/qna/markdown-export.ts:112-135` writes `docs/qna/qna-ledger-<ISO timestamp>.md`.

## Expected end-to-end outcome

- A user can browse the current branch's ordinary QnA backlog, including transcript-closed `answered_in_chat` and `superseded` items, filter by state, and edit items directly from a dedicated overlay.
- The user can send just the unsent delta back to the agent in one structured batch, and `needs_clarification` sends can reopen a scoped follow-up loop without widening the existing `qna` tool contract beyond `open` questions.
- The user can export a shareable Markdown snapshot of the branch-local ordinary QnA state.

## User test at exit

1. Open `/qna-ledger` and filter the current branch's questions by state, including transcript-closed items.
1. Edit an answered or closed item and confirm the ledger updates immediately.
1. Trigger `Send updates` and confirm only changed items are batched into one payload.
1. Export the ledger and confirm a timestamped Markdown file is written under `docs/qna/`.
1. Trigger `Send updates` with at least one `needs_clarification` item and confirm the agent gets the batch plus an active `qna` loop for follow-up, while structured `qna` review remains limited to currently `open` items.
