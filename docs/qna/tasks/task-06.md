# Task 06 — `/qna-ledger` overlay, batched sends, and Markdown export

## Overview

Build the ordinary QnA ledger browser for the current branch. This task adds the `/qna-ledger` overlay, state filtering, direct editing of branch-local records, batched update sending, and timestamped Markdown export under `docs/qna/`.

## Grouping methodology

This is one committable and testable unit because it is the complete maintenance surface for ordinary QnA outside the live `/qna` loop. A user can browse, edit, send, and export ordinary questions without touching Grill Me or transcript extraction logic.

## Dependencies

- Tasks 04-05.

## Parallelization

- This completes the ordinary QnA track.

## Spec coverage

### `docs/qna/qna-inbox-spec.md`

- The system shall provide `/qna-ledger` as the browsing and editing view for ordinary QnA items.
- `/qna` and `/qna-ledger` shall not display or manage Grill Me interview sessions.
- When the user runs `/qna-ledger`, the system shall open a simple ordinary-QnA ledger overlay for the current branch.
- The `/qna-ledger` overlay shall prioritize browsing and filtering ordinary QnA questions rather than cross-session planning.
- The `/qna-ledger` overlay shall allow filtering by question state.
- The `/qna-ledger` overlay shall allow answering, skipping, marking `needs_clarification`, reopening, and editing previously closed ordinary QnA questions.
- When the user edits an ordinary QnA question from `/qna-ledger`, the system shall update the branch-local ledger immediately.
- The `/qna-ledger` overlay shall provide a manual `Send updates` action.
- When `/qna-ledger` sends updates, the system shall batch all unsent changed ordinary QnA items into one structured payload.
- When `/qna-ledger` sends updates, the system shall send only items changed since the last send.
- When `/qna-ledger` sends updates and any item is `needs_clarification`, the system shall reactivate the loop-scoped `qna` tool.
- The `/qna-ledger` overlay shall provide an export action.
- When the user exports ordinary QnA state, the system shall write a timestamped Markdown snapshot under `docs/qna/`.

## Expected end-to-end outcome

- A user can browse the current branch's ordinary QnA backlog, filter by state, and edit items directly from a dedicated overlay.
- The user can send just the unsent delta back to the agent in one structured batch.
- The user can export a shareable Markdown snapshot of the branch-local ordinary QnA state.

## User test at exit

1. Open `/qna-ledger` and filter the current branch's questions by state.
2. Edit an answered or closed item and confirm the ledger updates immediately.
3. Trigger `Send updates` and confirm only changed items are batched into one payload.
4. Export the ledger and confirm a timestamped Markdown file is written under `docs/qna/`.
