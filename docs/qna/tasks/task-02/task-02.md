# Task 02 — Shared question rendering, answer controls, and response-state model

## Overview

Implement the shared question experience inside the runtime form. This task covers all supported question kinds, recommendation and justification rendering, answer controls, reserved option-ID handling, notes, and the full per-question state model users interact with directly.

## Grouping methodology

This is one committable and testable unit because it delivers the complete answer-entry surface for a static question payload without needing transcript extraction, session storage, or graph activation logic. A single mixed-question fixture can exercise the whole slice.

## Dependencies

- Task 01.

## Parallelization

- Completion of this task unblocks Task 03 and all product-specific tasks that depend on fully interactive answer controls.

## Spec coverage

### `docs/qna/question-runtime-core-spec.md`

- The system shall support exactly three question kinds: `yes_no`, `multiple_choice`, and `freeform`.
  - Evidence: implemented — `extensions/question-runtime/types.ts` defines `QuestionKind` as `yes_no | multiple_choice | freeform`; `extensions/question-runtime/request-validator.ts` rejects unsupported `kind` values.
- Each question shall expose a short primary `prompt`.
  - Evidence: implemented — `extensions/question-runtime/types.ts` adds `prompt` to `AuthorizedQuestionBase`; `extensions/question-runtime/request-validator.ts` requires non-empty `prompt`; `extensions/question-runtime/form-shell.ts` renders `entry.question.prompt`.
- Each question may expose an optional `context` block.
  - Evidence: implemented — `extensions/question-runtime/types.ts` adds optional `context`; `extensions/question-runtime/request-validator.ts` validates optional non-empty `context`; `extensions/question-runtime/form-shell.ts` renders a collapsed/expanded context section.
- When authoring a question payload, the agent shall prefer `yes_no` for decisions that are truly binary.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` `appendQuestionKindPreferenceIssues()` emits `authoring_guidance` for obvious yes/no misclassification while leaving final kind selection agent-authored.
- When authoring a question payload, the agent shall prefer `multiple_choice` when the decision can be reduced to a finite authored option set.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` `parseEnumeratedChoices()` and `appendQuestionKindPreferenceIssues()` flag freeform payloads whose suggested answers already enumerate a finite option set.
- When authoring a question payload, the agent shall use `freeform` only when reducing the question to `yes_no` or `multiple_choice` would lose essential nuance.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` requires freeform `justification` and `appendQuestionKindPreferenceIssues()` emits `authoring_guidance` when a freeform payload looks reducible instead of meaningfully open-ended.
- Every surfaced question shall include recommendation data.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` requires `recommendedOptionId` for `yes_no`, `recommendedOptionIds` for `multiple_choice`, and `suggestedAnswer` for `freeform`; `extensions/question-runtime/form-shell.ts` surfaces each recommendation in the active question view.
- Every surfaced question shall include a justification.
  - Evidence: implemented — `extensions/question-runtime/types.ts` adds required `justification`; `extensions/question-runtime/request-validator.ts` requires it; `extensions/question-runtime/form-shell.ts` renders a Justification block for the active question.
- When the question kind is `freeform`, the system shall require a separate `suggestedAnswer` field in addition to the justification.
  - Evidence: implemented — `extensions/question-runtime/types.ts` adds `suggestedAnswer` on freeform questions; `extensions/question-runtime/request-validator.ts` requires non-empty `suggestedAnswer` for `freeform`.
- When the question kind is `freeform`, the system shall render the suggested answer as a read-only block separate from user input.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` renders `Suggested answer` from `entry.question.suggestedAnswer` above the editable `Answer` row.
- When the question kind is `multiple_choice`, the system shall render recommended options inline on option rows.
  - Evidence: implemented — `extensions/question-runtime/question-model.ts` marks options with `recommended`; `extensions/question-runtime/form-shell.ts` appends `[recommended]` on matching option rows.
- When the question kind is `yes_no`, the system shall render the recommended side inline on the yes or no choice.
  - Evidence: implemented — `extensions/question-runtime/question-model.ts` marks `yes`/`no` using `recommendedOptionId`; `extensions/question-runtime/form-shell.ts` appends `[recommended]` on the matching row.
- Every `multiple_choice` question shall declare `selectionMode: single | multi` explicitly.
  - Evidence: implemented — `extensions/question-runtime/types.ts` requires `selectionMode`; `extensions/question-runtime/request-validator.ts` errors when `selectionMode` is missing or unsupported.
- The shared runtime shall reserve option IDs `yes`, `no`, and `other`.
  - Evidence: implemented — `extensions/question-runtime/types.ts` exports `RESERVED_OPTION_IDS`; `extensions/question-runtime/request-validator.ts` rejects authored multiple-choice `optionId` values `yes`, `no`, and `other`.
- Every `multiple_choice` question shall append an `Other` option automatically using `optionId: other`.
  - Evidence: implemented — `extensions/question-runtime/question-model.ts` appends an automatic `{ optionId: "other", label: "Other" }` runtime option to every multiple-choice model.
- Agent-authored `multiple_choice` options shall not redundantly include the automatic `Other` option.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` raises `reserved_identifier` when an authored multiple-choice option uses reserved `optionId` `other`.
- Every `yes_no` question shall model `yes` and `no` using the reserved option IDs `yes` and `no`.
  - Evidence: implemented — `extensions/question-runtime/question-model.ts` builds yes/no runtime options with fixed `optionId` values `yes` and `no`.
- A `multiple_choice` option may include optional description or subtext.
  - Evidence: implemented — `extensions/question-runtime/types.ts` adds optional `description`; `extensions/question-runtime/request-validator.ts` validates it; `extensions/question-runtime/form-shell.ts` renders `option.description` on a second line.
- When `selectionMode` is `multi`, the system shall allow the agent to recommend more than one option.
  - Evidence: implemented — `extensions/question-runtime/types.ts` models `recommendedOptionIds: string[]`; `extensions/question-runtime/request-validator.ts` allows one or more recommended IDs when `selectionMode` is `multi`.
- The system shall not impose an artificial cap on the number of agent-provided `multiple_choice` options.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` validates the options array but does not impose any maximum length.
- When the user selects `Other`, the form shall require non-empty `otherText` before submit.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` marks a multiple-choice answer incomplete when `other` is selected without text and adds `missing_other_text` in `validateFormForSubmit`.
- When the user selects `Other`, the payload shall send `optionId: other` plus separate `otherText`.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `buildQuestionOutcome()` emits a `selections` entry with `optionId: "other"` and separate `otherText` when selected.
- When the question is multi-select, the system shall allow `Other` alongside normal selected options.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `toggleMultipleChoiceOption()` appends selections independently in `multi` mode, allowing `other` plus authored options.
- When the user selects `Other`, the system shall not allow a separate note on that option.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` renders `Other text` but skips an option-note row for `optionId === "other"`; `extensions/question-runtime/form-state.ts` omits notes for `other` in `buildQuestionOutcome()`.
- The UI may allow note entry on any option row for ease of use.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` renders a `Note for <label>` editor row for every authored multiple-choice option, regardless of selection state.
- When a `multiple_choice` answer is submitted, the payload shall include notes only for selected options.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `buildQuestionOutcome()` derives multiple-choice `selections` from `selectedOptionIds` only, attaching notes only on those selected entries.
- The system shall support per-question response states `answered`, `needs_clarification`, `skipped`, and `open`.
  - Evidence: implemented — `extensions/question-runtime/types.ts` defines `QuestionResponseState`; `extensions/question-runtime/form-state.ts` `getQuestionResponseState()` returns all four states and `form-shell.ts` uses them in tabs and review.
- The system shall use the term `note` for all user-authored supplemental text.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` labels editable supplemental fields as `Answer note`, `Note for <label>`, and `Question note`; `extensions/question-runtime/types.ts` and `form-state.ts` store supplemental text in `note`/`questionNote` fields.
- When a question is answered as `multiple_choice`, the system shall store notes per selected option.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` stores per-option drafts in `optionNoteDrafts` and serializes selected option notes in multiple-choice `selections`.
- When a question is answered as `yes_no` or `freeform`, the system shall store one answer-level note.
  - Evidence: implemented — `extensions/question-runtime/types.ts` defines `note` on yes/no and freeform answer payloads; `extensions/question-runtime/form-state.ts` stores `answerDraft.note` for both kinds and serializes it in `buildQuestionOutcome()`.
- When a question is marked `needs_clarification`, the system shall store one question-level note.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` keeps a single `questionNote` per question and emits it as the `needs_clarification` outcome note.
- When a question is marked `skipped`, the system shall store one optional question-level note.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` stores `questionNote` and serializes a skipped outcome with optional sanitized `note`.
- When the user marks a question `needs_clarification`, the system shall require a note before allowing final submit.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `validateFormForSubmit()` adds `missing_clarification_note` when `closureState === "needs_clarification"` and `questionNote` is empty; `form-shell.ts` blocks submit and routes to review blockers.
- When the user marks a question `needs_clarification`, the system shall treat that state as mutually exclusive with any answered state.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` returns `needs_clarification` before checking answer completeness and serializes a clarification outcome instead of an answer when closure state is set.
- When the user marks a question `needs_clarification`, the system shall dim and lock answer controls while preserving prior drafts underneath.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` treats non-open questions as `closed`, marks answer rows `disabled`, renders them dim, and leaves underlying draft state untouched until reopened.
- When the user marks a question `skipped`, the system shall dim and lock answer controls while preserving prior drafts underneath.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` uses the same closed-state handling for `skipped`, disabling answer rows without clearing answer drafts.
- When the user skips a question, the system shall treat that question as closed until it is explicitly reopened.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` replaces open-state actions with `Question note` and `Reopen question` when `closureState !== "open"`.
- When a user reopens a previously `skipped` or `needs_clarification` question and submits a normal answer, that latest answer shall become the question's current state.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `setClosureState()` can restore `open` without clearing drafts, and `buildQuestionOutcome()` emits the preserved answer once closure state is back to `open` and the answer is complete.
- The system shall show `prompt`, recommendation, and justification by default for the active question.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` always renders the active question prompt and justification; recommendation markers are shown inline in the default answer rows for yes/no and multiple-choice, and freeform shows `Suggested answer` in the active view.
- When a question has `context`, the system shall keep that context collapsed by default and shall allow the user to reveal it on demand.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` starts with no question IDs in `expandedContext`, renders `Show context` by default, and toggles expansion with the context action row.
- When the user is viewing a multi-select question, the system shall allow multiple options to be selected at once.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` `toggleMultipleChoiceOption()` accumulates selections in `multi` mode instead of replacing the current selection.

## Expected end-to-end outcome

- A single shared form can render `yes_no`, `multiple_choice`, and `freeform` questions with the right recommendations, notes, and validation.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts`, `question-model.ts`, and `form-state.ts` cover all three kinds, render recommendation/notes UI, and use `validateFormForSubmit()` for submit blockers.
- Users can answer, skip, mark `needs_clarification`, reopen, and edit every supported question kind without product-specific code paths.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` exposes answer editing plus `Mark skipped`, `Mark needs clarification`, and `Reopen question` actions for the shared runtime; `extensions/question-runtime/index.ts` launches the same shell for validated requests.

## User test at exit

1. Open one form containing all three question kinds.
2. Confirm recommendations, justifications, and freeform suggested answers render in the right places.
3. Confirm reserved `yes` / `no` / `other` behavior, `Other` text requirements, multi-select behavior, and note restrictions.
4. Mark questions `skipped` and `needs_clarification`, then reopen and answer them normally.
