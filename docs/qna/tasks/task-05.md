# Task 05 — `/qna` loop control, scoped tool activation, and no-results behavior

## Overview

Add the interactive `/qna` loop behavior around the ledger-backed extraction pipeline. This task scopes the agent-facing `qna` tool to a single loop, keeps ordinary chat clarification available when structured capture is unnecessary, and defines how empty runs, untouched questions, and loop completion behave.

## Grouping methodology

This is one committable and testable unit because it completes the user-facing `/qna` command semantics for a manual run. A small set of interactive runs can verify tool activation, loop teardown, no-results handling, and persistence of still-open questions.

## Dependencies

- Task 04.

## Parallelization

- Task 06 depends on this task for `Send updates` reactivation behavior.

## Spec coverage

### `docs/qna/qna-inbox-spec.md`

- `/qna` shall be user initiated.
- `/qna` shall run in smart merged mode without a mode picker.
- When the user starts `/qna`, the system shall activate the agent-facing `qna` tool only for the current QnA loop.
- While the agent-facing `qna` tool is active for `/qna`, the system shall still allow the agent to ask ordinary clarifying questions in chat when structured capture is unnecessary.
- When the current `/qna` loop settles, the system shall deactivate the agent-facing `qna` tool.
- When the current chat is attached to a Grill Me interview session, the system shall block `/qna` and direct the user back to Grill Me instead of mixing the two systems in one chat.
- When a visible ordinary QnA question is left untouched on submit, the system shall keep that question `open` in the branch-local ledger.
- When the form is submitted with no explicit outcomes in manual `/qna`, the system shall persist ledger state and notify the user without fabricating an agent response.
- When the agent signals completion for the current `/qna` loop, the system shall be allowed to end that loop even if older open ordinary QnA items remain in the ledger.
- When a `/qna` loop ends while older open ordinary QnA items remain, the system shall leave those items for future `/qna` or `/qna-ledger` work.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall not open an empty review popup.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall record the successful scan boundary update and show a notification.

## Expected end-to-end outcome

- A user can run `/qna` as a scoped manual loop, answer some questions, leave others open, and exit cleanly without losing unresolved backlog.
- Empty `/qna` runs do not show dead-end UI and instead update the scan boundary and notify the user.
- `/qna` refuses to run inside an attached Grill Me chat.

## User test at exit

1. Start `/qna` and confirm the `qna` tool activates only for that loop.
2. Leave one visible question untouched, submit, and confirm it remains `open` in the ledger.
3. Submit a manual run with no explicit outcomes and confirm the system persists state and only shows a notification.
4. Run `/qna` when there are no unresolved questions and confirm there is no empty popup.
