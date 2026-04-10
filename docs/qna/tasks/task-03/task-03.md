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
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:restoreQuestionDraft` filters `selectedOptionIds` and `optionNoteDrafts` through `getSelectableOptionIds`; `extensions/question-runtime/runtime-engine.test.ts` covers stale option removal.
- When the user partially submits a form, the system shall allow untouched visible questions to remain `open`.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:validateFormForSubmit` does not block `open` questions; `buildStructuredSubmitResult` omits `open` outcomes and `buildQuestionRuntimeFormResult` preserves open drafts in `draftSnapshot`.
- The system shall support dormant follow-up questions in a question graph.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:normalizeQuestionGraph` records all authored `followUps` as edges, while `buildActiveQuestionView` only surfaces activated nodes.
- The system may accept follow-up relationships authored inline, but it shall normalize active questions by `questionId`.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:normalizeQuestionGraph` keys canonical nodes in `questionsById` and active candidates in a `Map` keyed by `questionId`.
- When follow-up relationships are authored inline, `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` shall be treated as occurrence-level activation metadata rather than canonical question-definition fields.
  - Evidence: implemented — `extensions/question-runtime/types.ts` isolates occurrence metadata; `extensions/question-runtime/question-definition.ts` canonical signatures and `stripOccurrenceFields` omit activation arrays and nested `followUps`.
- Root questions shall not declare `anyOfSelectedOptionIds` or `allOfSelectedOptionIds`.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts:validateQuestionNode` raises `invalid_activation` for root activation arrays; `extensions/question-runtime/request-validator.test.ts` covers rejection.
- The system shall allow follow-up activation from `yes_no` answers.
  - Evidence: implemented — `extensions/question-runtime/question-model.ts` exposes `yes`/`no` as selectable IDs and `extensions/question-runtime/question-graph.ts:edgePasses` matches them against current answered state.
- The system shall allow follow-up activation from specific `multiple_choice` options.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:edgePasses` checks selected multiple-choice IDs against edge `anyOfSelectedOptionIds`/`allOfSelectedOptionIds`; `extensions/question-runtime/runtime-engine.test.ts` activates `shared` from `rootB.go`.
- The system shall not allow follow-up activation from `freeform` inputs.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts:appendActivationRuleIssues` rejects activation arrays under freeform parents, and `validateQuestionNode` rejects freeform `followUps` entirely.
- The system shall reject `followUps` under `freeform` questions because freeform inputs never activate follow-ups.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts:validateQuestionNode` emits `invalid_activation` on `freeform.followUps`; `extensions/question-runtime/request-validator.test.ts` covers it.
- The system shall support simple activation rules based on `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:edgePasses` enforces `anyOf`/`allOf` with `some` plus `every` over current selected option IDs.
- When a follow-up occurrence under a `yes_no` or `multiple_choice` parent omits both activation arrays, the system shall activate it whenever the parent's current state is `answered`.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:edgePasses` returns `true` when both activation arrays are empty and parent `responseState` is `answered`; `extensions/question-runtime/runtime-engine.test.ts` covers default activation from `rootA`.
- When evaluating follow-up activation, the system shall use only the parent's current `answered` state and current selected option IDs.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` re-reads `getQuestionState(questionId)` and `edgePasses` only consumes current `responseState` plus current selected IDs.
- The system shall support recursive follow-up chains.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:normalizeQuestionGraph` and `buildActiveQuestionView.visit` recurse through nested `followUps`.
- Root questions shall count as activation depth `0`.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` adds roots with `activationDepth: 0`.
- The system shall enforce a maximum active follow-up depth of 3.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` stops recursion when `childDepth > 3`.
- When a follow-up graph contains a cycle, the system shall prevent that cycle from activating.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` tracks `ancestry` and skips edges whose child already appears in the current path.
- The system shall render active questions as a dynamic flattened view of the active question graph.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` returns the current flattened `entries`, and `extensions/question-runtime/form-shell.ts:getActiveView` recomputes it on every render and mutation.
- When the active question set changes, the system shall recompute visible numbering from the active view instead of storing question numbers.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts:tabLabel` derives numbering from the current `activeView.entries` index on render; form state stores no question numbers.
- When two activation paths surface the same `questionId`, the system shall show that question only once.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` dedupes candidates in a `Map` keyed by `questionId`; `extensions/question-runtime/runtime-engine.test.ts` keeps `shared` single.
- When the same `questionId` is activated by multiple current paths, the system shall preserve combined activation provenance so the UI can explain why that question is visible.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:ActiveQuestionEntry.visibilityReasons` merges unique reasons; `extensions/question-runtime/form-shell.ts:renderVisibilityReasons` displays them; `extensions/question-runtime/runtime-engine.test.ts` expects two reasons for `shared`.
- When the same `questionId` is authored inline more than once, the canonical question definition shall match across occurrences after excluding nested follow-up lists and occurrence-level activation metadata.
  - Evidence: implemented — `extensions/question-runtime/question-definition.ts:sameCanonicalQuestionDefinition` ignores `followUps` and occurrence fields; `extensions/question-runtime/request-validator.ts:appendConflictingQuestionDefinitionIssues` enforces it; tests cover matching vs conflicting repeats.
- When matching repeated occurrences of the same `questionId` declare different outgoing follow-up relationships, the normalized graph shall merge those outgoing relationships.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:normalizeQuestionGraph` visits every occurrence's `followUps` and accumulates `outgoingEdgesByParentId` per canonical parent `questionId`.
- When a question declares `dependsOnQuestionIds`, the system shall order surfaced questions dependency-first.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` now returns resolved entries in dependency-safe insertion order, and `extensions/question-runtime/runtime-engine.test.ts` covers a dependent authored before its prerequisite.
- A dependency shall count as resolved only when its current state is `answered`.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` only resolves dependents when `dependencyState === "answered"`.
- A dependency in state `open`, `skipped`, or `needs_clarification` shall not unlock dependent questions.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` blocks on any dependency state other than `answered`.
- When a candidate question depends on an unresolved prerequisite in the same active view, the system shall suppress the dependent question until the prerequisite is resolved.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` blocks when a dependency candidate is missing, unanswered, or not yet in `resolved`; `extensions/question-runtime/runtime-engine.test.ts` surfaces `dependent` only after `shared` is answered.
- When an active candidate set contains a dependency cycle, the system shall suppress that cycle instead of surfacing an unstable order.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` breaks when no dependency progress is possible and only returns `resolved` entries, dropping cyclic candidates.
- When a user answer change deactivates a follow-up branch, the system shall preserve that branch's unsent drafts as hidden branch state.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts` keeps drafts for every `questionOrder` item regardless of visibility, and `extensions/question-runtime/runtime-engine.test.ts` deactivates `branch` without losing its draft.
- When a previously answered or closed follow-up branch becomes inactive, the system shall keep its prior result available for reactivation without treating it as currently active.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts:buildActiveQuestionView` omits inactive branches from `entries`, while `extensions/question-runtime/form-state.ts:getQuestionDraft` retains their prior draft and closure state; `extensions/question-runtime/runtime-engine.test.ts` restores `branch` on reactivation.
- When a form opens, the system shall render the current supplied question payload and shall not invent brand-new questions mid-form except by activating already-declared graph edges.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts:showQuestionRuntimeFormShell` builds one normalized graph from `payload.request`, and later visibility changes come only from `buildActiveQuestionView` over declared nodes and edges.
- When the user submits the form, the system shall validate and construct payloads from currently active questions only.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` submits via `validateFormForSubmit(activeView, state)` and `buildStructuredSubmitResult(activeView, state)`; both iterate `activeView.entries` only.
- When a branch is inactive, the system shall not let that branch block submit.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:validateFormForSubmit` only checks `activeView.entries`, so hidden inactive branches never contribute blockers or outcomes.
- When a form is closed or cancelled after edits but before submit, the system shall preserve unsent drafts for later restoration.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildQuestionRuntimeFormResult` returns the full cancel `draftSnapshot`; `extensions/question-runtime/request-validator.ts:validateDraftSnapshot` now accepts empty `questionNote` strings, and `runtime-engine.test.ts` round-trips a cancel snapshot back through request validation.
- The system shall send structured payloads back to the agent rather than freeform `Q:` and `A:` text.
  - Evidence: implemented — `extensions/question-runtime/types.ts` defines `QuestionRuntimeStructuredSubmitResult`, `extensions/question-runtime/repair-messages.ts:buildFormSubmittedMessage` serializes it, and `extensions/question-runtime/index.ts` sends hidden control messages with structured details.
- When a form is submitted, the shared runtime shall return the latest `draftSnapshot` alongside the structured submit envelope.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildQuestionRuntimeFormResult` includes both `draftSnapshot` and `submitResult` for `action: "submit"`; `extensions/question-runtime/index.ts` forwards both.
- When a form is cancelled, the shared runtime shall return the latest `draftSnapshot` and no synthetic submit payload.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildQuestionRuntimeFormResult` cancel branch returns only `action` plus `draftSnapshot`; `extensions/question-runtime/repair-messages.ts:buildFormCancelledMessage` carries no submit result.
- The system shall use a turn-level `requiresClarification` flag when any submitted question is in `needs_clarification` state.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult` sets `requiresClarification` when any submitted outcome has `state === "needs_clarification"`.
- When a form is submitted, the system shall include `answered`, `skipped`, and `needs_clarification` items in the payload.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildQuestionOutcome` emits `answered`, `skipped`, and `needs_clarification`, and `buildStructuredSubmitResult` keeps every non-`open` outcome.
- When a form is submitted, the system shall omit untouched `open` items from the payload.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult` filters out `state: "open"`; `extensions/question-runtime/runtime-engine.test.ts` confirms `openQuestion` is omitted.
- When an agent-driven form is submitted with no explicit outcomes, the system shall return a structured `no_user_response` result.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult` returns `{ kind: "no_user_response" }` when no non-open outcomes remain; `extensions/question-runtime/runtime-engine.test.ts` covers it.

## Expected end-to-end outcome

- The shared runtime can drive a conditional question graph with occurrence-owned activation metadata, dependencies, combined activation provenance, hidden branch drafts, and active-only submission.
  - Evidence: implemented — `extensions/question-runtime/question-graph.ts`, `form-state.ts`, `form-shell.ts`, and `request-validator.ts` now cover dependency-safe active ordering, hidden draft round-tripping, provenance, and active-only submission; `runtime-engine.test.ts` exercises both dependency ordering and cancel snapshot restoration.
- The agent receives either a structured submit envelope plus the latest `draftSnapshot` or a cancel result with the latest `draftSnapshot`, instead of ad hoc text.
  - Evidence: implemented — `extensions/question-runtime/form-state.ts`, `repair-messages.ts`, and `index.ts` return structured submit or cancel control messages with `draftSnapshot`.

## User test at exit

1. Open a form with nested follow-ups, shared follow-up nodes, and dependency-gated questions.
2. Activate the same follow-up through more than one current parent and confirm it appears once with combined provenance.
3. Activate and deactivate branches by changing answers, then confirm hidden drafts return when the branch reactivates.
4. Submit a partial response and confirm untouched visible questions stay `open` while inactive branches do not block submission.
5. Cancel after edits and confirm the returned `draftSnapshot` can restore hidden inactive branch drafts on reopen.
