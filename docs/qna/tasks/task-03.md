# Task 03 — Shared branching, dependency resolution, drafts, and structured submission

## Overview

Implement the shared runtime engine that turns a question tree into an active user flow. This task covers follow-up activation, dependency ordering, hidden branch-state preservation, active-view numbering, draft restoration, and the structured payload rules sent back to the agent.

## Grouping methodology

This is one committable and testable unit because it completes the runtime semantics for non-trivial question trees. A single fixture with nested follow-ups, dependencies, reopened questions, and partial submission can prove the whole slice without any product-specific transcript or storage behavior.

## Dependencies

- Tasks 01-02.

## Parallelization

- Completion of this task unblocks the `/qna` and `/grill-me` product tracks.

## Spec coverage

### `docs/qna/question-runtime-core-spec.md`

- When a resurfaced question keeps the same stable ID but its options change, the system shall carry forward only selections and notes whose `optionId`s still exist.
- When the user partially submits a form, the system shall allow untouched visible questions to remain `open`.
- The system shall support dormant follow-up questions in question trees.
- The system shall allow follow-up activation from `yes_no` answers.
- The system shall allow follow-up activation from specific `multiple_choice` options.
- The system shall not allow follow-up activation from `freeform` inputs.
- The system shall support simple activation rules based on `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`.
- The system shall support recursive follow-up chains.
- The system shall enforce a maximum active follow-up depth of 3.
- When a follow-up graph contains a cycle, the system shall prevent that cycle from activating.
- The system shall render active questions as a dynamic flattened view of the conditional tree.
- When the active question set changes, the system shall recompute visible numbering from the active view instead of storing question numbers.
- When two activation paths surface the same follow-up stable ID, the system shall show that follow-up only once.
- When a question declares `dependsOnQuestionIds`, the system shall order surfaced questions dependency-first.
- A dependency shall count as resolved only when its current state is `answered`.
- A dependency in state `open`, `skipped`, or `needs_clarification` shall not unlock dependent questions.
- When a candidate question depends on an unresolved prerequisite in the same active view, the system shall suppress the dependent question until the prerequisite is resolved.
- When a user answer change deactivates a follow-up branch, the system shall preserve that branch's unsent drafts as hidden branch state.
- When a previously answered or closed follow-up branch becomes inactive, the system shall keep its prior result available for reactivation without treating it as currently active.
- When a form opens, the system shall render the current supplied question payload and shall not invent brand-new questions mid-form except by activating already-declared follow-ups.
- When the user submits the form, the system shall validate and construct payloads from currently active questions only.
- When a branch is inactive, the system shall not let that branch block submit.
- When a form is closed or cancelled after edits but before submit, the system shall preserve unsent drafts for later restoration.
- The system shall send structured payloads back to the agent rather than freeform `Q:` and `A:` text.
- The system shall use a turn-level `requiresClarification` flag when any submitted question is in `needs_clarification` state.
- When a form is submitted, the system shall include `answered`, `skipped`, and `needs_clarification` items in the payload.
- When a form is submitted, the system shall omit untouched `open` items from the payload.
- When an agent-driven form is submitted with no explicit outcomes, the system shall return a structured `no_user_response` result.

## Expected end-to-end outcome

- The shared runtime can drive a conditional question tree with dependencies, preserve hidden branch drafts, and submit only the active resolved work.
- The agent receives a structured payload with stable IDs, current outcomes, and a turn-level clarification signal instead of ad hoc text.

## User test at exit

1. Open a form with nested follow-ups and dependency-gated questions.
2. Activate and deactivate branches by changing answers, then confirm hidden drafts return when the branch reactivates.
3. Submit a partial response and confirm untouched visible questions stay `open` while inactive branches do not block submission.
4. Submit a turn with at least one `needs_clarification` item and confirm the payload includes the right structured flags.
