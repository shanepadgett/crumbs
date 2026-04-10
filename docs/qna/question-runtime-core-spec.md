# Shared Question Runtime Specification

## Scope

- The system shall use this runtime as shared infrastructure for `/qna` and `/grill-me`.
- The system shall keep product-specific workflow and storage policy out of this shared spec.
- The shared runtime shall own only low-level structured-question request protocol, validation, retry control, and question-form rendering.
- Product-specific no-question outcomes and terminal screens shall remain product-owned rather than extending the shared question runtime protocol.
- The shared runtime authorized-question tool shall remain distinct from any product-level agent tool.

## Question model

- The system shall support exactly three question kinds: `yes_no`, `multiple_choice`, and `freeform`.
- Each question shall have a stable `questionId` owned by the calling extension.
- The shared runtime shall validate caller-supplied `questionId`s but shall not generate or reconcile them.
- Each question shall expose a short primary `prompt`.
- Each question may expose an optional `context` block.
- The system shall allow per-run presentation fields to change without changing the stable `questionId`.
- When a question can be reduced to a true yes or no decision, the system shall prefer `yes_no`.
- When a question can be reduced to a finite set of options, the system shall prefer `multiple_choice`.
- When a question cannot be reduced to `yes_no` or `multiple_choice` without losing essential nuance, the system shall use `freeform`.

## Recommendations and justification

- Every surfaced question shall include recommendation data.
- Every surfaced question shall include a justification.
- When the question kind is `freeform`, the system shall require a separate `suggestedAnswer` field in addition to the justification.
- When the question kind is `freeform`, the system shall render the suggested answer as a read-only block separate from user input.
- When the question kind is `multiple_choice`, the system shall render recommended options inline on option rows.
- When the question kind is `yes_no`, the system shall render the recommended side inline on the yes or no choice.

## Options and answer shapes

- Every `multiple_choice` question shall declare `selectionMode: single | multi` explicitly.
- The shared runtime shall reserve option IDs `yes`, `no`, and `other`.
- Every `multiple_choice` question shall append an `Other` option automatically using `optionId: other`.
- Agent-authored `multiple_choice` options shall not redundantly include the automatic `Other` option.
- Every `multiple_choice` option shall have a stable `optionId` separate from its display label.
- Every `yes_no` question shall model `yes` and `no` using the reserved option IDs `yes` and `no`.
- The shared runtime shall validate caller-supplied `optionId`s but shall not generate or reconcile them.
- A `multiple_choice` option may include optional description or subtext.
- When `selectionMode` is `multi`, the system shall allow the agent to recommend more than one option.
- The system shall not impose an artificial cap on the number of agent-provided `multiple_choice` options.
- When the user selects `Other`, the form shall require non-empty `otherText` before submit.
- When the user selects `Other`, the payload shall send `optionId: other` plus separate `otherText`.
- When the question is multi-select, the system shall allow `Other` alongside normal selected options.
- When the user selects `Other`, the system shall not allow a separate note on that option.
- The UI may allow note entry on any option row for ease of use.
- When a `multiple_choice` answer is submitted, the payload shall include notes only for selected options.
- When a resurfaced `multiple_choice` option keeps the same meaning, the system shall preserve its `optionId` across rewrites.
- The calling extension shall own `optionId`s and shall pass existing `optionId`s into reconciliation so same-meaning options keep their IDs and only truly new options get new IDs.
- When a resurfaced question keeps the same stable ID but its options change, the system shall carry forward only selections and notes whose `optionId`s still exist.

## Response states and notes

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
- When the user partially submits a form, the system shall allow untouched visible questions to remain `open`.
- When the user skips a question, the system shall treat that question as closed until it is explicitly reopened.
- When a user reopens a previously `skipped` or `needs_clarification` question and submits a normal answer, that latest answer shall become the question's current state.

## Conditional follow-ups and dependencies

- The system shall support dormant follow-up questions in a question graph.
- The system may accept follow-up relationships authored inline, but it shall normalize active questions by `questionId`.
- The system shall allow follow-up activation from `yes_no` answers.
- The system shall allow follow-up activation from specific `multiple_choice` options.
- The system shall not allow follow-up activation from `freeform` inputs.
- The system shall support simple activation rules based on `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`.
- The system shall support recursive follow-up chains.
- The system shall enforce a maximum active follow-up depth of 3.
- When a follow-up graph contains a cycle, the system shall prevent that cycle from activating.
- The system shall render active questions as a dynamic flattened view of the active question graph.
- When the active question set changes, the system shall recompute visible numbering from the active view instead of storing question numbers.
- When two activation paths surface the same `questionId`, the system shall show that question only once.
- When the same `questionId` is activated by multiple current paths, the system shall preserve combined activation provenance so the UI can explain why that question is visible.
- When a question declares `dependsOnQuestionIds`, the system shall order surfaced questions dependency-first.
- A dependency shall count as resolved only when its current state is `answered`.
- A dependency in state `open`, `skipped`, or `needs_clarification` shall not unlock dependent questions.
- When a candidate question depends on an unresolved prerequisite in the same active view, the system shall suppress the dependent question until the prerequisite is resolved.
- When a user answer change deactivates a follow-up branch, the system shall preserve that branch's unsent drafts as hidden branch state.
- When a previously answered or closed follow-up branch becomes inactive, the system shall keep its prior result available for reactivation without treating it as currently active.

## Form behavior

- The system shall present the question form in a tab-oriented interface.
- The system shall use a cleaner UI and shall not use the current robot icon.
- The system shall show `prompt`, recommendation, and justification by default for the active question.
- When a question has `context`, the system shall keep that context collapsed by default and shall allow the user to reveal it on demand.
- When the user is viewing a multi-select question, the system shall allow multiple options to be selected at once.
- When a form opens, the system shall render the current supplied question payload and shall not invent brand-new questions mid-form except by activating already-declared graph edges.
- When the user submits the form, the system shall validate and construct payloads from currently active questions only.
- When a branch is inactive, the system shall not let that branch block submit.
- When a form is closed or cancelled after edits but before submit, the system shall preserve unsent drafts for later restoration.
- Product systems shall own durable storage policy for drafts outside the live form lifecycle.

## Submission and payload rules

- The system shall send structured payloads back to the agent rather than freeform `Q:` and `A:` text.
- The system shall use a turn-level `requiresClarification` flag when any submitted question is in `needs_clarification` state.
- When a form is submitted, the system shall include `answered`, `skipped`, and `needs_clarification` items in the payload.
- When a form is submitted, the system shall omit untouched `open` items from the payload.
- When an agent-driven form is submitted with no explicit outcomes, the system shall return a structured `no_user_response` result.

## Agent-authored question protocol

- When the agent needs to ask structured questions, the system shall require use of an authorized question tool flow rather than arbitrary file watching.
- When the authorized question tool is called, the system shall issue a request ID and a tool-usable absolute JSON path rooted in a project-local temp location, and it may also return a repo-relative display path.
- The system shall require the agent to write the structured question spec to that authorized path rather than to an arbitrary file.
- The structured question spec shall contain the full question graph needed for the current request.
- The structured question spec shall contain at least one renderable question.
- The structured question spec shall not encode product-level loop-control or terminal-screen semantics.
- The system shall require the structured question spec to be deterministic for the known fields the UI depends on.
- The system shall ignore unknown extra fields in an otherwise valid JSON file.
- When the authorized file is created or edited, the system shall validate the current JSON immediately.
- When the authorized file is valid, the system shall present the question UI immediately.
- When the authorized file is invalid, the system shall send hidden repair feedback to the agent instead of opening the UI.
- The system shall allow the agent to repair the authorized file in place with its normal file-editing tools.
- When a valid authorized request has been consumed and the UI has been shown, the system shall lock that request ID so later edits to the same file do not reopen it.
- When a product flow has no renderable questions for the current step, it shall handle that outcome without launching the shared question runtime form.

## Validation and retry control

- When validation fails, the system shall send a hidden custom message rather than a visible user message.
- When validation fails, the hidden custom message shall include the same request ID and authorized path.
- When validation fails, the hidden custom message shall describe the field path, expected shape, actual problem, and a concise fix hint for every deterministic error the validator can report.
- When the agent repeatedly fails to produce a valid authorized file, the system shall enforce a hidden retry budget of 4 failed validations.
- When the hidden retry budget is exhausted, the system shall ask the user whether to continue or abort that request.
- While the retry-exhaustion decision is pending, later edits to that same authorized request shall be ignored.
- When the user chooses Continue after the retry budget is exhausted, the system shall grant exactly one additional block of 4 hidden retries.
- When the user chooses Abort after the retry budget is exhausted, the system shall stop that request.
