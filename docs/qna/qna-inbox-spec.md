# QnA Inbox Specification

## Product boundary

- The system shall treat `/qna` as a simple current-branch question inbox.
- The system shall treat `/qna` as opportunistic capture for the current chat branch rather than as a repo-scoped planning system.
- The system shall provide `/qna-ledger` as the browsing and editing view for ordinary QnA items.
- `/qna` and `/qna-ledger` shall not display or manage interview sessions.

## Entry and loop behavior

- `/qna` shall be user initiated.
- `/qna` shall run in smart merged mode without a mode picker.
- When the user starts `/qna`, the system shall activate the agent-facing `qna` tool only for the current QnA loop.
- The agent-facing `qna` tool shall remain distinct from the low-level shared question-runtime request tool and shall use that runtime only when structured forms are needed.
- While the agent-facing `qna` tool is active for `/qna`, the system shall still allow the agent to ask ordinary clarifying questions in chat when structured capture is unnecessary.
- When the current `/qna` loop settles, the system shall deactivate the agent-facing `qna` tool.
- When the current chat is attached to an interview session, the system shall block `/qna` and direct the user back to the interview instead of mixing the two systems in one chat.
- The `/qna` interview-attachment guard shall read a hidden current-chat marker `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.

## Branch-local state

- The system shall maintain a hidden branch-local QnA ledger in session state.
- The branch-local QnA ledger shall track ordinary QnA question records, answer states, notes, unsent edits, and send state.
- Each ordinary QnA record shall have one authoritative state, at minimum `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, or `superseded`.
- `/qna` shall own durable storage of ordinary QnA drafts and unsent edits outside the live shared runtime form.
- `/qna` shall persist the shared runtime's latest `draftSnapshot` keyed by `questionId` so cancelled edits and hidden inactive branch drafts can be restored later.
- The branch-local QnA ledger shall track enough per-record send revision metadata to send only items changed since the last send.
- The system shall maintain a branch-local durable scan boundary so repeated `/qna` runs do not rescan the full session.
- When the user forks a pi session, the ordinary QnA ledger, durable scan boundary, and unsent edits shall fork with that branch.

## Transcript extraction and reconciliation

- When `/qna` runs, the system shall inspect only assistant and user transcript content plus branch-local ordinary QnA ledger state.
- When `/qna` runs, the system shall stop transcript scanning at the most recent durable boundary.
- When the stored durable boundary is missing from the current branch, `/qna` shall fall back to a full current-branch scan and shall not duplicate already tracked questions as net-new items.
- When QnA processing completes successfully, including the no-unresolved case, the system shall advance the durable boundary.
- When a `/qna` run finds no new assistant or user transcript since the durable boundary, the system shall treat that run as a successful no-op, advance the boundary to the current branch tip, and show a notification.
- When extraction is cancelled or fails before completion, the system shall not advance the durable boundary.
- When the model determines that an unresolved ordinary QnA question has already been answered naturally in chat, the system shall close that question silently in the branch-local ledger.
- When newer chat has replaced an older open ordinary QnA question with a meaningfully different decision, the system shall close the old question and track the newer one as a separate question.
- When `/qna` reconciles ledger state, the system shall give the model existing unresolved question IDs to update.
- When `/qna` reconciles ledger state, the system shall ask the model to extract net-new questions separately from unresolved question updates.

## Submit and loop completion behavior

- `/qna` shall consume the shared runtime's structured submit result (`question_outcomes` or `no_user_response`) rather than parsing freeform text.
- When `/qna` applies structured submit results, the affected ordinary QnA records shall adopt authoritative ledger states `answered`, `skipped`, or `needs_clarification` without reparsing freeform text.
- When a shared runtime form closes or cancels during `/qna`, the system shall preserve the returned `draftSnapshot` in branch-local state without treating it as a send.
- When a visible ordinary QnA question is left untouched on submit, the system shall keep that question `open` in the branch-local ledger.
- When the form is submitted with no explicit outcomes in manual `/qna`, the system shall persist ledger state and notify the user without fabricating an agent response.
- When the agent signals completion for the current `/qna` loop, the system shall be allowed to end that loop even if older open ordinary QnA items remain in the ledger.
- When a `/qna` loop ends while older open ordinary QnA items remain, the system shall leave those items for future `/qna` or `/qna-ledger` work.

## No-results behavior

- When `/qna` finds no unresolved ordinary QnA questions, the system shall not open an empty review popup.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall record the successful scan boundary update and show a notification.

## QnA ledger browser

- When the user runs `/qna-ledger`, the system shall open a simple ordinary-QnA ledger overlay for the current branch.
- The `/qna-ledger` overlay shall prioritize browsing and filtering ordinary QnA questions rather than cross-session planning.
- The `/qna-ledger` overlay shall expose the authoritative ordinary-QnA record state for filtering and editing, including transcript-closed states such as `answered_in_chat` and `superseded`.
- The `/qna-ledger` overlay shall allow filtering by question state.
- The `/qna-ledger` overlay shall allow answering, skipping, marking `needs_clarification`, reopening, and editing previously closed ordinary QnA questions.
- When the user edits an ordinary QnA question from `/qna-ledger`, the system shall update the branch-local ledger immediately.
- The `/qna-ledger` overlay shall provide a manual `Send updates` action.
- When `/qna-ledger` sends updates, the system shall batch all unsent changed ordinary QnA items into one structured payload.
- When `/qna-ledger` sends updates, the system shall send only items changed since the last send.
- When `/qna-ledger` sends updates and any item is `needs_clarification`, the system shall reactivate the loop-scoped `qna` tool.

## Export

- The `/qna-ledger` overlay shall provide an export action.
- When the user exports ordinary QnA state, the system shall write a timestamped Markdown snapshot under `docs/qna/`.
