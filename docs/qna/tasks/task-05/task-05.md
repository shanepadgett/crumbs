# Task 05 — `/qna` loop control, scoped tool activation, and no-results behavior

## Overview

Add the interactive `/qna` loop behavior around the ledger-backed extraction pipeline. This task scopes the agent-facing `qna` tool above the shared runtime, keeps ordinary chat clarification available when structured capture is unnecessary, and defines how empty runs, untouched questions, and loop completion behave.

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
- The agent-facing `qna` tool shall remain distinct from the low-level shared question-runtime request tool and shall use that runtime only when structured forms are needed.
- While the agent-facing `qna` tool is active for `/qna`, the system shall still allow the agent to ask ordinary clarifying questions in chat when structured capture is unnecessary.
- When the current `/qna` loop settles, the system shall deactivate the agent-facing `qna` tool.
- When the current chat is attached to an interview session, the system shall block `/qna` and direct the user back to the interview instead of mixing the two systems in one chat.
- `/qna` shall consume the shared runtime's structured submit result (`question_outcomes` or `no_user_response`) rather than parsing freeform text.
- When a shared runtime form closes or cancels during `/qna`, the system shall preserve the returned `draftSnapshot` in branch-local state without treating it as a send.
- When a visible ordinary QnA question is left untouched on submit, the system shall keep that question `open` in the branch-local ledger.
- When the form is submitted with no explicit outcomes in manual `/qna`, the system shall persist ledger state and notify the user without fabricating an agent response.
- When the agent signals completion for the current `/qna` loop, the system shall be allowed to end that loop even if older open ordinary QnA items remain in the ledger.
- When a `/qna` loop ends while older open ordinary QnA items remain, the system shall leave those items for future `/qna` or `/qna-ledger` work.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall not open an empty review popup.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall record the successful scan boundary update and show a notification.

## Expected end-to-end outcome

- A user can run `/qna` as a scoped manual loop layered above the shared runtime, consume structured submit results, leave others open, and exit cleanly without losing unresolved backlog or cancelled draft state.
- Empty `/qna` runs do not show dead-end UI and instead update the scan boundary and notify the user.
- `/qna` refuses to run inside an attached interview chat.

## User test at exit

1. Start `/qna` and confirm the `qna` tool activates only for that loop.
2. Leave one visible question untouched, submit, and confirm it remains `open` in the ledger.
3. Submit a manual run with no explicit outcomes and confirm the system persists state and only shows a notification.
4. Run `/qna` when there are no unresolved questions and confirm there is no empty popup.
