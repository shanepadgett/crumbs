# Task 02 — Shared question rendering, answer controls, and response-state model

## Overview

Implement the shared question experience inside the runtime form. This task covers all supported question kinds, recommendation and justification rendering, answer controls, `Other` handling, notes, and the full per-question state model users interact with directly.

## Grouping methodology

This is one committable and testable unit because it delivers the complete answer-entry surface for a static question payload without needing transcript extraction, session storage, or branch activation logic. A single mixed-question fixture can exercise the whole slice.

## Dependencies

- Task 01.

## Parallelization

- Completion of this task unblocks Task 03 and all product-specific tasks that depend on fully interactive answer controls.

## Spec coverage

### `docs/qna/question-runtime-core-spec.md`

- The system shall support exactly three question kinds: `yes_no`, `multiple_choice`, and `freeform`.
- Each question shall expose a short primary `prompt`.
- Each question may expose an optional `context` block.
- When a question can be reduced to a true yes or no decision, the system shall prefer `yes_no`.
- When a question can be reduced to a finite set of options, the system shall prefer `multiple_choice`.
- When a question cannot be reduced to `yes_no` or `multiple_choice` without losing essential nuance, the system shall use `freeform`.
- Every surfaced question shall include recommendation data.
- Every surfaced question shall include a justification.
- When the question kind is `freeform`, the system shall require a separate `suggestedAnswer` field in addition to the justification.
- When the question kind is `freeform`, the system shall render the suggested answer as a read-only block separate from user input.
- When the question kind is `multiple_choice`, the system shall render recommended options inline on option rows.
- When the question kind is `yes_no`, the system shall render the recommended side inline on the yes or no choice.
- Every `multiple_choice` question shall declare `selectionMode: single | multi` explicitly.
- Every `multiple_choice` question shall append an `Other` option automatically.
- Every `yes_no` question shall model `yes` and `no` as explicit option IDs.
- A `multiple_choice` option may include optional description or subtext.
- When `selectionMode` is `multi`, the system shall allow the agent to recommend more than one option.
- The system shall not impose an artificial cap on the number of agent-provided `multiple_choice` options.
- When the user selects `Other`, the form shall require non-empty `otherText` before submit.
- When the user selects `Other`, the payload shall send `optionId: other` plus separate `otherText`.
- When the question is multi-select, the system shall allow `Other` alongside normal selected options.
- When the user selects `Other`, the system shall not allow a separate note on that option.
- The UI may allow note entry on any option row for ease of use.
- When a `multiple_choice` answer is submitted, the payload shall include notes only for selected options.
- The system shall support per-question response states `answered`, `needs_clarification`, `skipped`, and `open`.
- The system shall use the term `note` for all user-authored supplemental text.
- When a question is answered as `multiple_choice`, the system shall store notes per selected option.
- When a question is answered as `yes_no` or `freeform`, the system shall store one answer-level note.
- When a question is marked `needs_clarification`, the system shall store one question-level note.
- When a question is marked `skipped`, the system shall store one optional question-level note.
- When the user marks a question `needs_clarification`, the system shall require a note before allowing final submit.
- When the user marks a question `needs_clarification`, the system shall treat that state as mutually exclusive with any answered state.
- When the user marks a question `needs_clarification`, the system shall dim and lock answer controls while preserving prior drafts underneath.
- When the user marks a question `skipped`, the system shall dim and lock answer controls while preserving prior drafts underneath.
- When the user skips a question, the system shall treat that question as closed until it is explicitly reopened.
- When a user reopens a previously `skipped` or `needs_clarification` question and submits a normal answer, that latest answer shall become the question's current state.
- The system shall show `prompt`, recommendation, and justification by default for the active question.
- When a question has `context`, the system shall keep that context collapsed by default and shall allow the user to reveal it on demand.
- When the user is viewing a multi-select question, the system shall allow multiple options to be selected at once.

## Expected end-to-end outcome

- A single shared form can render `yes_no`, `multiple_choice`, and `freeform` questions with the right recommendations, notes, and validation.
- Users can answer, skip, mark `needs_clarification`, reopen, and edit every supported question kind without product-specific code paths.

## User test at exit

1. Open one form containing all three question kinds.
2. Confirm recommendations, justifications, and freeform suggested answers render in the right places.
3. Confirm `Other` requires text, multi-select supports multiple selections, and notes only stick to allowed places.
4. Mark questions `skipped` and `needs_clarification`, then reopen and answer them normally.
