# Task 03 — Shared graph activation, dependency resolution, drafts, and structured submission

## Overview

Implement the shared runtime engine that turns a question graph into an active user flow. This task covers occurrence-owned follow-up activation, dependency ordering, combined activation provenance, hidden branch-state preservation, active-view numbering, draft restoration, and the structured submit or cancel payload rules sent back to the agent.

## Grouping methodology

This is one committable and testable unit because it completes the runtime semantics for non-trivial question graphs. A single fixture with nested follow-ups, shared follow-up nodes, dependencies, reopened questions, and partial submission can prove the whole slice without any product-specific transcript or storage behavior.

## Dependencies

- Tasks 01-02.

## Parallelization

- Completion of this task unblocks the `/qna` and `/interview` product tracks.

## Spec coverage

### `docs/qna/question-runtime-core-spec.md`

- When a resurfaced question keeps the same stable ID but its options change, the system shall carry forward only selections and notes whose `optionId`s still exist.
- When the user partially submits a form, the system shall allow untouched visible questions to remain `open`.
- The system shall support dormant follow-up questions in a question graph.
- The system may accept follow-up relationships authored inline, but it shall normalize active questions by `questionId`.
- When follow-up relationships are authored inline, `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` shall be treated as occurrence-level activation metadata rather than canonical question-definition fields.
- Root questions shall not declare `anyOfSelectedOptionIds` or `allOfSelectedOptionIds`.
- The system shall allow follow-up activation from `yes_no` answers.
- The system shall allow follow-up activation from specific `multiple_choice` options.
- The system shall not allow follow-up activation from `freeform` inputs.
- The system shall reject `followUps` under `freeform` questions because freeform inputs never activate follow-ups.
- The system shall support simple activation rules based on `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`.
- When a follow-up occurrence under a `yes_no` or `multiple_choice` parent omits both activation arrays, the system shall activate it whenever the parent's current state is `answered`.
- When evaluating follow-up activation, the system shall use only the parent's current `answered` state and current selected option IDs.
- The system shall support recursive follow-up chains.
- Root questions shall count as activation depth `0`.
- The system shall enforce a maximum active follow-up depth of 3.
- When a follow-up graph contains a cycle, the system shall prevent that cycle from activating.
- The system shall render active questions as a dynamic flattened view of the active question graph.
- When the active question set changes, the system shall recompute visible numbering from the active view instead of storing question numbers.
- When two activation paths surface the same `questionId`, the system shall show that question only once.
- When the same `questionId` is activated by multiple current paths, the system shall preserve combined activation provenance so the UI can explain why that question is visible.
- When the same `questionId` is authored inline more than once, the canonical question definition shall match across occurrences after excluding nested follow-up lists and occurrence-level activation metadata.
- When matching repeated occurrences of the same `questionId` declare different outgoing follow-up relationships, the normalized graph shall merge those outgoing relationships.
- When a question declares `dependsOnQuestionIds`, the system shall order surfaced questions dependency-first.
- A dependency shall count as resolved only when its current state is `answered`.
- A dependency in state `open`, `skipped`, or `needs_clarification` shall not unlock dependent questions.
- When a candidate question depends on an unresolved prerequisite in the same active view, the system shall suppress the dependent question until the prerequisite is resolved.
- When an active candidate set contains a dependency cycle, the system shall suppress that cycle instead of surfacing an unstable order.
- When a user answer change deactivates a follow-up branch, the system shall preserve that branch's unsent drafts as hidden branch state.
- When a previously answered or closed follow-up branch becomes inactive, the system shall keep its prior result available for reactivation without treating it as currently active.
- When a form opens, the system shall render the current supplied question payload and shall not invent brand-new questions mid-form except by activating already-declared graph edges.
- When the user submits the form, the system shall validate and construct payloads from currently active questions only.
- When a branch is inactive, the system shall not let that branch block submit.
- When a form is closed or cancelled after edits but before submit, the system shall preserve unsent drafts for later restoration.
- The system shall send structured payloads back to the agent rather than freeform `Q:` and `A:` text.
- When a form is submitted, the shared runtime shall return the latest `draftSnapshot` alongside the structured submit envelope.
- When a form is cancelled, the shared runtime shall return the latest `draftSnapshot` and no synthetic submit payload.
- The system shall use a turn-level `requiresClarification` flag when any submitted question is in `needs_clarification` state.
- When a form is submitted, the system shall include `answered`, `skipped`, and `needs_clarification` items in the payload.
- When a form is submitted, the system shall omit untouched `open` items from the payload.
- When an agent-driven form is submitted with no explicit outcomes, the system shall return a structured `no_user_response` result.

## Expected end-to-end outcome

- The shared runtime can drive a conditional question graph with occurrence-owned activation metadata, dependencies, combined activation provenance, hidden branch drafts, and active-only submission.
- The agent receives either a structured submit envelope plus the latest `draftSnapshot` or a cancel result with the latest `draftSnapshot`, instead of ad hoc text.

## User test at exit

1. Open a form with nested follow-ups, shared follow-up nodes, and dependency-gated questions.
2. Activate the same follow-up through more than one current parent and confirm it appears once with combined provenance.
3. Activate and deactivate branches by changing answers, then confirm hidden drafts return when the branch reactivates.
4. Submit a partial response and confirm untouched visible questions stay `open` while inactive branches do not block submission.
5. Cancel after edits and confirm the returned `draftSnapshot` can restore hidden inactive branch drafts on reopen.
