### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-03/task-03.md`
- `Task Title:` `Task 03 — Shared graph activation, dependency resolution, drafts, and structured submission`
- `Task Signature:` `task-03-shared-graph-activation-dependency-resolution-drafts-structured-submission`
- `Primary Code Scope:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-model.ts`, `extensions/question-runtime/question-definition.ts`, `extensions/question-runtime/request-validator.ts`, `extensions/question-runtime/question-graph.ts`, `extensions/question-runtime/form-state.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/repair-messages.ts`, `extensions/question-runtime/index.ts`, `extensions/question-runtime/request-validator.test.ts`, `extensions/question-runtime/runtime-engine.test.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, product-owned `/qna` and `/interview` workflow or storage code, request-path and watcher plumbing outside runtime semantics (`extensions/question-runtime/request-paths.ts`, `extensions/question-runtime/request-watcher.ts`), and unrelated repo areas

### 2. Executive Summary

This task should replace the current static pre-order tree rendering with a normalized graph runtime built around two separate concepts: canonical question definitions keyed by `questionId`, and occurrence-owned activation edges authored inline under `followUps`. That separation is the seam that makes shared follow-up nodes, dependency-first ordering, hidden branch draft preservation, and active-only submission deterministic instead of ad hoc.

The implementation should keep all drafts in one canonical map keyed by `questionId`, derive the visible active view from the current answered states, and return machine-readable submit or cancel results that always carry the latest `draftSnapshot`. Existing request issuance, hidden validation-repair flow, per-question draft mutation helpers, and the current tabbed shell chrome should stay reusable.

### 3. Resolved Runtime Semantics

1. **Canonical node vs inline occurrence**
   - Canonical question identity is owned by `questionId`.
   - Inline `followUps` are only one authored way to declare graph edges.
   - `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` are occurrence-owned activation metadata, not canonical question-definition fields.

2. **Canonical definition matching**
   - Repeated authored occurrences of the same `questionId` are allowed only when their canonical question-definition fields match exactly.
   - Canonical matching excludes nested `followUps`, `anyOfSelectedOptionIds`, and `allOfSelectedOptionIds`.

3. **Outgoing edge merge**
   - When repeated matching occurrences of the same `questionId` declare different outgoing follow-ups, the normalized graph merges those outgoing edges.
   - Identical duplicate edges collapse.

4. **Root activation rules**
   - Top-level root questions may not declare `anyOfSelectedOptionIds` or `allOfSelectedOptionIds`.
   - Validator rejects those fields on roots.

5. **Freeform follow-up behavior**
   - Freeform questions never activate follow-ups.
   - Validator rejects `followUps` under `freeform` questions instead of leaving runtime suppression ambiguous.

6. **Default activation rule behavior**
   - When a follow-up occurrence under a `yes_no` or `multiple_choice` parent omits both activation arrays, it activates whenever the parent is currently `answered`.

7. **Answered-only activation**
   - Follow-up activation uses only the parent’s current `responseState === "answered"` plus the parent’s current selected option IDs.
   - Preserved answer drafts under `open`, `skipped`, or `needs_clarification` never keep a branch active.

8. **Activation rule evaluation**
   - `anyOfSelectedOptionIds` passes when the current selected option set intersects the authored set.
   - `allOfSelectedOptionIds` passes when the current selected option set fully contains the authored set.
   - When both arrays are present, both checks must pass.

9. **Depth counting**
   - Root questions are depth `0`.
   - Direct follow-ups are depth `1`.
   - The deepest visible follow-up depth is `3`.

10. **Cycle behavior**
    - Follow-up traversal suppresses only the cyclic path or edge.
    - A node may still appear if another non-cyclic current path activates it.
    - Dependency cycles in the active candidate set are suppressed as unresolved instead of surfacing unstable ordering.

11. **Structured form results**
    - Submit returns a structured submit envelope plus the latest `draftSnapshot`.
    - Cancel returns only the latest `draftSnapshot` and no synthetic submit payload.

12. **Scope of submission and validation**
    - Review counts, blockers, emitted outcomes, and numbering are all derived from the current active view only.
    - Hidden inactive questions remain in canonical draft state but do not block submit and do not emit outcomes until active again.

### 4. Requirement Map

1. **Requirement:** `When a resurfaced question keeps the same stable ID but its options change, the system shall carry forward only selections and notes whose optionIds still exist.`
   - `Current files/functions/types:` `extensions/question-runtime/form-state.ts` creates blank drafts only and has no restore path.
   - `Planned implementation move:` Add request-level `draftSnapshot` hydration, restore by `questionId`, and filter restored multiple-choice selections and option-note drafts against the current valid option IDs plus runtime `other`.

2. **Requirement:** `When the user partially submits a form, the system shall allow untouched visible questions to remain open.`
   - `Current files/functions/types:` `validateFormForSubmit()` does not block incomplete answers, but `buildQuestionRuntimeFormResult()` still serializes every flattened question.
   - `Planned implementation move:` Keep active open questions non-blocking, show them in Review, and omit them from the structured submit payload.

3. **Requirement:** `The system shall support dormant follow-up questions in a question graph.`
   - `Current files/functions/types:` `flattenQuestionsPreOrder()` in `extensions/question-runtime/question-model.ts` immediately surfaces every nested node.
   - `Planned implementation move:` Normalize the authored graph once, then derive a separate active projection so dormant follow-ups stay hidden until their activation rules pass.

4. **Requirement:** `The system may accept follow-up relationships authored inline, but it shall normalize active questions by questionId.`
   - `Current files/functions/types:` `request-validator.ts` rejects duplicate `questionId`s and current flattening duplicates inline occurrences.
   - `Planned implementation move:` Allow repeated inline occurrences when canonical definitions match, normalize them into one canonical node per `questionId`, and treat activation metadata as edge-owned occurrence data.

5. **Requirement:** `The system shall allow follow-up activation from yes_no answers.`
   - `Current files/functions/types:` `setYesNoSelection()` only mutates draft state.
   - `Planned implementation move:` Evaluate yes/no follow-up edges only when the parent question is currently `answered` and the current selected option ID satisfies the edge rule.

6. **Requirement:** `The system shall allow follow-up activation from specific multiple_choice options.`
   - `Current files/functions/types:` `toggleMultipleChoiceOption()` only updates selections; nothing recomputes visibility.
   - `Planned implementation move:` Match follow-up activation rules against the current selected multiple-choice option IDs, including runtime `other`, shared-node dedupe, and provenance aggregation.

7. **Requirement:** `The system shall not allow follow-up activation from freeform inputs.`
   - `Current files/functions/types:` current authored shape allows `followUps` generically on every question kind.
   - `Planned implementation move:` Reject `followUps` under `freeform` questions during validation and never evaluate freeform text as an activation source.

8. **Requirement:** `The system shall support simple activation rules based on anyOfSelectedOptionIds and allOfSelectedOptionIds.`
   - `Current files/functions/types:` no current type or validator support for either array.
   - `Planned implementation move:` Add typed occurrence metadata, validate arrays deterministically, and implement the exact `anyOf` or `allOf` rule evaluation described in the resolved semantics.

9. **Requirement:** `The system shall support recursive follow-up chains.`
   - `Current files/functions/types:` current recursion is static tree flattening only.
   - `Planned implementation move:` Traverse normalized graph edges recursively so activated children can activate deeper descendants.

10. **Requirement:** `The system shall enforce a maximum active follow-up depth of 3.`
    - `Current files/functions/types:` no depth tracking exists.
    - `Planned implementation move:` Track activation depth during traversal with root depth `0` and suppress descendants whose next depth would exceed `3`.

11. **Requirement:** `When a follow-up graph contains a cycle, the system shall prevent that cycle from activating.`
    - `Current files/functions/types:` there is no logical cycle detection because there is no canonical graph.
    - `Planned implementation move:` Track ancestry during traversal and suppress edges that would re-enter the current path.

12. **Requirement:** `The system shall render active questions as a dynamic flattened view of the active question graph.`
    - `Current files/functions/types:` `form-shell.ts` flattens once at startup and renders a fixed set of tabs.
    - `Planned implementation move:` Replace the static flattened array with an `ActiveQuestionView` recomputed from canonical graph plus current drafts after every mutation.

13. **Requirement:** `When the active question set changes, the system shall recompute visible numbering from the active view instead of storing question numbers.`
    - `Current files/functions/types:` numbering is derived from the immutable pre-order index.
    - `Planned implementation move:` Keep numbering derived only from the current active entry order.

14. **Requirement:** `When two activation paths surface the same questionId, the system shall show that question only once.`
    - `Current files/functions/types:` duplicate `questionId`s are rejected today.
    - `Planned implementation move:` Canonicalize node identity by `questionId` and merge all current paths into one visible entry.

15. **Requirement:** `When the same questionId is activated by multiple current paths, the system shall preserve combined activation provenance so the UI can explain why that question is visible.`
    - `Current files/functions/types:` there is no provenance model in the runtime.
    - `Planned implementation move:` Add visibility-reason records based on current parent question IDs and matched option IDs, then render human-readable `Visible because` lines in the shell.

16. **Requirement:** `When a question declares dependsOnQuestionIds, the system shall order surfaced questions dependency-first.`
    - `Current files/functions/types:` `AuthorizedQuestionBase` has no dependency field and ordering is static pre-order only.
    - `Planned implementation move:` Add canonical `dependsOnQuestionIds`, validate references, then stable-toposort the active candidate set using first-seen canonical order as the tie-break.

17. **Requirement:** `A dependency shall count as resolved only when its current state is answered.`
    - `Current files/functions/types:` `getQuestionResponseState()` already computes per-question state, but no consumer uses it.
    - `Planned implementation move:` Gate dependency resolution on `getQuestionResponseState(...) === "answered"` only.

18. **Requirement:** `A dependency in state open, skipped, or needs_clarification shall not unlock dependent questions.`
    - `Current files/functions/types:` those states exist but do not affect visibility.
    - `Planned implementation move:` Treat every non-`answered` dependency as unresolved during active-view construction.

19. **Requirement:** `When a candidate question depends on an unresolved prerequisite in the same active view, the system shall suppress the dependent question until the prerequisite is resolved.`
    - `Current files/functions/types:` current shell always shows every flattened node.
    - `Planned implementation move:` After activation candidate collection, run a stable dependency ordering and suppression pass until only dependency-satisfied entries remain visible.

20. **Requirement:** `When a user answer change deactivates a follow-up branch, the system shall preserve that branch's unsent drafts as hidden branch state.`
    - `Current files/functions/types:` `QuestionRuntimeFormState` already keeps drafts by `questionId`, but branches never deactivate.
    - `Planned implementation move:` Preserve one canonical draft map for all normalized questions and make activation a projection over that map without clearing hidden drafts.

21. **Requirement:** `When a previously answered or closed follow-up branch becomes inactive, the system shall keep its prior result available for reactivation without treating it as currently active.`
    - `Current files/functions/types:` `buildQuestionOutcome()` can reconstruct states from preserved drafts, but submit and review logic include all questions today.
    - `Planned implementation move:` Keep the draft and implied current result in canonical state, but include it in review and submission only while the question is currently active.

22. **Requirement:** `When a form opens, the system shall render the current supplied question payload and shall not invent brand-new questions mid-form except by activating already-declared graph edges.`
    - `Current files/functions/types:` current shell only uses the supplied payload, but surfaces every declared node immediately.
    - `Planned implementation move:` Normalize only the supplied payload once at form open and allow visibility changes only by traversing declared edges from that normalized graph.

23. **Requirement:** `When the user submits the form, the system shall validate and construct payloads from currently active questions only.`
    - `Current files/functions/types:` submit validation and result building iterate the full flattened list.
    - `Planned implementation move:` Make validation, review summaries, and payload construction consume the current `ActiveQuestionView` only.

24. **Requirement:** `When a branch is inactive, the system shall not let that branch block submit.`
    - `Current files/functions/types:` there is no active or inactive distinction.
    - `Planned implementation move:` Restrict blocker checks to the current active view.

25. **Requirement:** `When a form is closed or cancelled after edits but before submit, the system shall preserve unsent drafts for later restoration.`
    - `Current files/functions/types:` `buildQuestionRuntimeFormResult()` already returns `draftSnapshot`, but `index.ts` ignores it and requests cannot restore it.
    - `Planned implementation move:` Validate and hydrate incoming `draftSnapshot`, return `draftSnapshot` on cancel, and emit it through a hidden structured cancel message for product-owned persistence.

26. **Requirement:** `The system shall send structured payloads back to the agent rather than freeform Q: and A: text.`
    - `Current files/functions/types:` `index.ts` discards the shell result and no submit or cancel hidden message exists.
    - `Planned implementation move:` Extend hidden control messages with submit and cancel result messages and emit them from `index.ts` after the shell closes.

27. **Requirement:** `The system shall use a turn-level requiresClarification flag when any submitted question is in needs_clarification state.`
    - `Current files/functions/types:` per-question clarification outcomes exist, but no aggregate flag exists.
    - `Planned implementation move:` Build the structured submit envelope with `requiresClarification = outcomes.some((item) => item.state === "needs_clarification")`.

28. **Requirement:** `When a form is submitted, the system shall include answered, skipped, and needs_clarification items in the payload.`
    - `Current files/functions/types:` `buildQuestionOutcome()` can build these states, but current shell result includes `open` and nothing is delivered to the agent.
    - `Planned implementation move:` Filter active outcomes down to explicit non-open states and wrap them in the structured submit envelope.

29. **Requirement:** `When a form is submitted, the system shall omit untouched open items from the payload.`
    - `Current files/functions/types:` `QuestionRuntimeQuestionOutcome` includes `state: "open"`, and current result building includes every question.
    - `Planned implementation move:` Keep `open` internal for draft-state reasoning only and omit it from structured submit payloads.

30. **Requirement:** `When an agent-driven form is submitted with no explicit outcomes, the system shall return a structured no_user_response result.`
    - `Current files/functions/types:` no submit envelope type exists.
    - `Planned implementation move:` Emit `kind: "no_user_response"` when the active non-open outcome list is empty.

### 5. Current Architecture Deep Dive

#### Relevant files and current roles

- `extensions/question-runtime/types.ts`
  - Owns the shared authored request schema, validation issue codes, question draft types, outcome union, and shell result type.
  - Missing today: dependency fields, occurrence-owned activation metadata, request-side draft restoration, and structured submit or cancel result envelopes.

- `extensions/question-runtime/question-model.ts`
  - Mixes two unrelated jobs: static `flattenQuestionsPreOrder()` tree rendering and reusable choice-row modeling.
  - The flattening helper is the main reason the shell behaves like a static nested list instead of an active graph.

- `extensions/question-runtime/request-validator.ts`
  - Validates the current task-01 and task-02 request shape.
  - Rejects repeated `questionId`s outright, validates multiple-choice options and recommendations, and preserves unknown extra fields.
  - Does not validate dependencies, activation arrays, or inbound `draftSnapshot`.

- `extensions/question-runtime/form-state.ts`
  - Owns blank draft creation, cloning, mutation helpers, answer completeness, response-state computation, submit blockers, and per-question outcome serialization.
  - Operates over static `FlattenedQuestion[]`, so validation and result building include every authored node.

- `extensions/question-runtime/form-shell.ts`
  - Builds one tab per flattened question plus Review.
  - Stores shell-local UI state such as `tabIndex`, focus row, and context expansion.
  - Assumes a fixed list through several hard-coded static-array seams:
    - `const reviewTabIndex = flattened.length;`
    - `function focusKey(): string { ... flattened[tabIndex] ... }`
    - tab switching modulo `(flattened.length + 1)`
    - `flattened.findIndex(...)` jump targets
    - post-submit `tabIndex = reviewTabIndex`
    - `const row = rows[focusByTab.get(focusKey()) ?? 0];`

- `extensions/question-runtime/index.ts`
  - Orchestrates request-store hydration, watcher startup, validation or retry hidden messages, modal queueing, request locking, and shell launch.
  - Ignores the shell result after `await showQuestionRuntimeFormShell(...)`.

- `extensions/question-runtime/repair-messages.ts`
  - Formats hidden validation failure, retry granted, and abort messages under one custom message family.
  - Has no submit or cancel result builders yet.

#### Current runtime flow

1. `question_runtime_request` issues an authorized request file and store record.
2. The watcher validates the file on write and either sends hidden repair feedback or marks the request ready.
3. `index.ts` locks the ready request and launches `showQuestionRuntimeFormShell(...)`.
4. `form-shell.ts` flattens the full authored tree once with `flattenQuestionsPreOrder(...)`.
5. `form-state.ts` creates one blank draft per flattened question and the shell renders all tabs at once.
6. Submit or cancel returns a shell-local result, but `index.ts` drops it, so no structured data reaches the agent or product layer.

#### Reusable pieces that should be preserved

- `buildChoiceQuestionModel()` and current automatic `yes`, `no`, and `other` option behavior.
- `getQuestionResponseState()` and `isAnswerDraftComplete()` as the single source of truth for per-question status.
- Existing per-question mutation helpers: `setYesNoSelection`, `toggleMultipleChoiceOption`, `setFreeformText`, answer-note setters, question-note setters, and closure-state setters.
- The task-01 request issuance, request watcher, retry budget, and hidden validation loop.
- The tabbed shell chrome, keyboard bindings, context collapse behavior, and review-tab affordance.

#### Missing seams that this task must add

- A reusable canonical question-definition helper shared by validator and graph normalization.
- A reusable option-ID helper shared by validator, activation evaluation, provenance rendering, and draft restoration.
- A pure graph module that separates canonical node identity from occurrence-owned activation edges.
- Structured submit or cancel message builders so `index.ts` can deliver results back to the agent without inventing product semantics.

### 6. Target Architecture

#### Module responsibilities

- `types.ts`
  - Shared external contract for authored requests, drafts, validation issues, internal outcomes, and structured submit or cancel form results.

- `question-model.ts`
  - Runtime choice-row helpers plus shared option label and selectable-option helpers.

- `question-definition.ts` **(new)**
  - Canonical question-definition extraction and equality helpers used by both validator and graph normalization.

- `request-validator.ts`
  - Deterministic schema and reference validation.
  - Root or follow-up occurrence validation.
  - Canonical repeated-`questionId` consistency checks.
  - `draftSnapshot` structure and reference validation.

- `question-graph.ts` **(new)**
  - Normalize authored inline questions into canonical nodes plus activation edges.
  - Build the active candidate set, merge visibility reasons, enforce depth and cycle guards, then stable-order and dependency-filter the visible active view.

- `form-state.ts`
  - Own all canonical drafts keyed by `questionId`.
  - Hydrate and sanitize `draftSnapshot` input.
  - Build active-only blockers and structured submit results.

- `form-shell.ts`
  - Own only UI-local state.
  - Recompute the active view after every mutation.
  - Keep tab selection and focus stable across active-view changes.
  - Render visibility reasons and active-only review.

- `repair-messages.ts`
  - Keep one hidden message family constant.
  - Preserve validation and retry builders.
  - Add submit and cancel result builders.

- `index.ts`
  - Keep request lifecycle orchestration.
  - Capture the shell result and emit hidden submit or cancel messages.

#### Normalization and active-view algorithm

1. Traverse the authored request in pre-order.
2. For each occurrence:
   - extract the canonical question-definition signature with nested follow-ups and occurrence metadata removed
   - record first-seen `questionOrder`
   - record root membership if the occurrence is top-level
3. For each parent -> child occurrence:
   - add one activation edge using the child occurrence’s `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`
   - keep the occurrence path for deterministic validation or debugging only, not primary UI text
4. Merge repeated canonical nodes by `questionId` when signatures match.
5. Union outgoing edges across repeated matching occurrences.
6. Build active candidates by traversing from roots:
   - root depth is `0`
   - parent must currently be `answered`
   - evaluate default activation or explicit `anyOf` and `allOf`
   - suppress edges that exceed depth `3`
   - suppress only the cyclic path when ancestry would repeat
7. Merge active candidates by `questionId`:
   - keep minimum activation depth
   - append all current visibility reasons
8. Stable-toposort the active candidate set by `dependsOnQuestionIds`, using first-seen `questionOrder` as the tie-break.
9. Suppress any candidate whose dependency is absent, unresolved, or part of a dependency cycle.
10. Return the final `ActiveQuestionView` in current visible order.

#### Structured submission flow

1. Shell mutations update canonical drafts only.
2. Active view is recomputed from canonical graph plus current drafts.
3. Review summaries and blockers consume only the active view.
4. Submit builds an active-only structured submit envelope plus the latest canonical `draftSnapshot`.
5. Cancel builds only the latest canonical `draftSnapshot`.
6. `index.ts` sends one hidden structured message after the shell closes.

```text
Authorized JSON request
        |
        v
request-validator.ts
  - schema
  - references
  - canonical repeated-definition checks
  - draftSnapshot structure
        |
        v
question-graph.ts
  normalize by questionId
  keep occurrence-owned edges
        |
        v
form-state.ts
  hydrate canonical drafts
        |
        v
+---------------- form-shell.ts ----------------+
| derive ActiveQuestionView after each edit     |
| render active tabs, numbering, and reasons    |
| mutate canonical draft state only             |
+--------------------+--------------------------+
                     |
                     v
   structured submit envelope or cancel result
                     |
                     v
  repair-messages.ts builders + index.ts sender
```

### 7. File-by-File Implementation Plan

#### `Path:` `extensions/question-runtime/types.ts`

- `Action:` modify
- `Why:` The shared contract needs dependency fields, occurrence-owned activation metadata, draft restoration, and structured submit or cancel result envelopes.
- `Responsibilities:`
  - Extend the authored request shape.
  - Add new validation issue codes.
  - Define structured submit and cancel result types.
- `Planned exports / signatures:`

  ```ts
  export interface AuthorizedQuestionRequest {
    questions: AuthorizedQuestionNode[];
    draftSnapshot?: QuestionRuntimeQuestionDraft[];
  }

  export interface AuthorizedQuestionBase {
    questionId: string;
    prompt: string;
    context?: string;
    justification: string;
    dependsOnQuestionIds?: string[];
    followUps?: AuthorizedQuestionNode[];
  }

  export interface AuthorizedQuestionOccurrenceMetadata {
    anyOfSelectedOptionIds?: string[];
    allOfSelectedOptionIds?: string[];
  }

  export type AuthorizedQuestionNode =
    | (AuthorizedYesNoQuestion & AuthorizedQuestionOccurrenceMetadata)
    | (AuthorizedFreeformQuestion & AuthorizedQuestionOccurrenceMetadata)
    | (AuthorizedMultipleChoiceQuestion & AuthorizedQuestionOccurrenceMetadata);

  export type ValidationIssueCode =
    | ...existing...
    | "conflicting_question_definition"
    | "invalid_activation";

  export type SubmittedQuestionRuntimeQuestionOutcome = Exclude<
    QuestionRuntimeQuestionOutcome,
    { state: "open" }
  >;

  export type QuestionRuntimeStructuredSubmitResult =
    | {
        kind: "question_outcomes";
        requiresClarification: boolean;
        outcomes: SubmittedQuestionRuntimeQuestionOutcome[];
      }
    | {
        kind: "no_user_response";
        requiresClarification: false;
        outcomes: [];
      };

  export type QuestionRuntimeFormResult =
    | {
        action: "cancel";
        draftSnapshot: QuestionRuntimeQuestionDraft[];
      }
    | {
        action: "submit";
        draftSnapshot: QuestionRuntimeQuestionDraft[];
        submitResult: QuestionRuntimeStructuredSubmitResult;
      };
  ```

- `Key logic to add or change:`
  - Keep `dependsOnQuestionIds` on canonical question definitions.
  - Keep activation arrays on inline node objects because authored JSON is occurrence-inline, but document that validator and graph normalization treat them as occurrence metadata.
  - Keep existing per-question outcome union for internal reasoning.
- `Dependencies:` none
- `Risks / notes:` Keep task-01 and task-02 fields backward-compatible. Do not mix graph-engine internal helper types into the external authored request contract unless multiple modules truly need them.

#### `Path:` `extensions/question-runtime/question-model.ts`

- `Action:` modify
- `Why:` Choice modeling should remain here, but static tree flattening should leave this file and option-ID helpers should be centralized here.
- `Responsibilities:`
  - Keep yes/no and multiple-choice runtime option modeling.
  - Export one shared selectable-option helper.
  - Export one shared option-label lookup helper.
  - Remove or stop exporting `flattenQuestionsPreOrder()`.
- `Planned exports / signatures:`

  ```ts
  export interface RuntimeChoiceOption { ... }
  export interface RuntimeChoiceQuestionModel { ... }

  export function buildChoiceQuestionModel(
    question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
  ): RuntimeChoiceQuestionModel;

  export function getSelectableOptionIds(
    question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
  ): string[];

  export function getChoiceOptionLabel(
    question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
    optionId: string,
  ): string | null;
  ```

- `Key logic to add or change:`
  - Preserve automatic `yes`, `no`, and `other` semantics exactly.
  - Make `getSelectableOptionIds()` the shared source of truth for valid activation-rule and draft-restore option IDs.
- `Dependencies:` `extensions/question-runtime/types.ts`
- `Risks / notes:` Keep automatic-option behavior identical to task-02 so note and `otherText` semantics do not drift.

#### `Path:` `extensions/question-runtime/question-definition.ts`

- `Action:` add
- `Why:` Validator and graph normalization both need the same canonical question-definition comparison logic.
- `Responsibilities:`
  - Strip occurrence-owned fields and nested follow-ups from authored nodes.
  - Build deterministic canonical signatures.
  - Compare repeated authored occurrences by canonical definition.
- `Planned exports / signatures:`

  ```ts
  export interface CanonicalQuestionDefinitionSignature {
    questionId: string;
    kind: "yes_no" | "multiple_choice" | "freeform";
    prompt: string;
    context?: string;
    justification: string;
    dependsOnQuestionIds: string[];
    recommendedOptionId?: "yes" | "no";
    suggestedAnswer?: string;
    selectionMode?: "single" | "multi";
    options?: Array<{ optionId: string; label: string; description?: string }>;
    recommendedOptionIds?: string[];
  }

  export function getCanonicalQuestionDefinitionSignature(
    question: AuthorizedQuestionNode,
  ): CanonicalQuestionDefinitionSignature;

  export function sameCanonicalQuestionDefinition(
    left: AuthorizedQuestionNode,
    right: AuthorizedQuestionNode,
  ): boolean;
  ```

- `Key logic to add or change:`
  - Normalize optional arrays like `dependsOnQuestionIds` for deterministic comparison.
  - Exclude `followUps`, `anyOfSelectedOptionIds`, and `allOfSelectedOptionIds` from the signature.
- `Dependencies:` `extensions/question-runtime/types.ts`
- `Risks / notes:` Keep this module pure and product-agnostic. It should not know about active-view traversal.

#### `Path:` `extensions/question-runtime/request-validator.ts`

- `Action:` modify
- `Why:` Current validation rejects shared nodes and ignores task-03 graph and draft fields.
- `Responsibilities:`
  - Validate `dependsOnQuestionIds`, occurrence activation arrays, and optional `draftSnapshot`.
  - Replace duplicate-`questionId` rejection with canonical-definition consistency checks.
  - Preserve deterministic issue ordering and unknown-extra-field tolerance.
- `Planned exports / signatures:`

  ```ts
  export function validateAuthorizedQuestionRequest(text: string): RequestValidationResult;
  ```

  Internal helpers expected:

  ```ts
  function validateStringArray(...): Array<{ value: string; path: string }> | null;
  function appendDependencyReferenceIssues(...): void;
  function appendActivationRuleIssues(...): void;
  function appendConflictingQuestionDefinitionIssues(...): void;
  function validateDraftSnapshot(...): void;
  ```

- `Key logic to add or change:`
  - Track traversal context so each occurrence knows whether it is a root and what parent question kind owns the edge.
  - Reject activation arrays on roots.
  - Reject `followUps` under `freeform` parents.
  - Validate activation arrays against parent option IDs using `getSelectableOptionIds()` for yes/no and multiple-choice parents.
  - Allow repeated `questionId` occurrences only when `sameCanonicalQuestionDefinition(...)` passes.
  - Validate `dependsOnQuestionIds` after the full question ID set is known.
  - Validate `draftSnapshot` structure and question-kind compatibility, but do not reject stale removed multiple-choice option IDs because hydration will filter them.
  - Preserve deterministic issue order in this exact sequence:
    1. top-level request-shape issues
    2. pre-order occurrence issues
    3. conflicting repeated-definition issues
    4. dependency reference issues
    5. activation reference issues
    6. `draftSnapshot` structural and reference issues
- `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-definition.ts`, `extensions/question-runtime/question-model.ts`
- `Risks / notes:` Do not regress current authoring-guidance heuristics or forbidden-field checks. Keep deterministic output stable for the hidden repair loop.

#### `Path:` `extensions/question-runtime/question-graph.ts`

- `Action:` add
- `Why:` The repo needs one pure runtime module that turns the authored inline tree into canonical graph semantics and a dynamic active view.
- `Responsibilities:`
  - Normalize repeated inline occurrences into canonical nodes keyed by `questionId`.
  - Record outgoing activation edges separately from canonical question definitions.
  - Build active candidates, merge visibility reasons, enforce depth and cycle guards, and perform dependency-first ordering and suppression.
- `Planned exports / signatures:`

  ```ts
  export interface NormalizedQuestionGraph {
    questionOrder: string[];
    rootQuestionIds: string[];
    questionsById: Record<string, NormalizedQuestionNode>;
    outgoingEdgesByParentId: Record<string, QuestionActivationEdge[]>;
  }

  export interface NormalizedQuestionNode {
    questionId: string;
    question: AuthorizedQuestionNode;
    dependsOnQuestionIds: string[];
  }

  export interface QuestionActivationEdge {
    parentQuestionId: string;
    childQuestionId: string;
    occurrencePath: string;
    anyOfSelectedOptionIds: string[];
    allOfSelectedOptionIds: string[];
  }

  export interface QuestionVisibilityReason {
    kind: "root" | "follow_up";
    parentQuestionId?: string;
    matchedOptionIds?: string[];
  }

  export interface ActiveQuestionEntry {
    questionId: string;
    question: AuthorizedQuestionNode;
    activationDepth: number;
    visibilityReasons: QuestionVisibilityReason[];
  }

  export interface ActiveQuestionView {
    entries: ActiveQuestionEntry[];
  }

  export function normalizeQuestionGraph(
    request: AuthorizedQuestionRequest,
  ): NormalizedQuestionGraph;

  export function buildActiveQuestionView(
    graph: NormalizedQuestionGraph,
    getQuestionState: (questionId: string) => {
      draft: QuestionRuntimeQuestionDraft;
      responseState: QuestionResponseState;
    },
  ): ActiveQuestionView;
  ```

- `Key logic to add or change:`
  - Use `getCanonicalQuestionDefinitionSignature()` so repeated-definition logic matches the validator.
  - Merge outgoing edges from repeated matching occurrences.
  - Evaluate activation rules only when the parent is currently `answered`.
  - Use minimum activation depth and merged visibility reasons when a node is surfaced by multiple current paths.
  - Stable-toposort active candidates by dependencies using canonical `questionOrder` as the tie-break.
  - Suppress dependency cycles instead of surfacing unstable order.
- `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-definition.ts`
- `Risks / notes:` Keep `occurrencePath` internal-facing. UI text should come from parent question IDs and option labels, not raw authored JSON paths.

#### `Path:` `extensions/question-runtime/form-state.ts`

- `Action:` modify
- `Why:` State creation, validation, and result building must move from static flattened-tree scope to canonical graph and active-view scope.
- `Responsibilities:`
  - Create one draft per canonical `questionId`.
  - Hydrate and sanitize optional `draftSnapshot`.
  - Preserve current per-question mutation APIs.
  - Build active-only blockers and structured submit results.
- `Planned exports / signatures:`

  ```ts
  export interface QuestionRuntimeFormState {
    questions: Record<string, QuestionRuntimeQuestionDraft>;
    questionOrder: string[];
  }

  export function createQuestionRuntimeFormState(
    graph: NormalizedQuestionGraph,
    draftSnapshot?: QuestionRuntimeQuestionDraft[],
  ): QuestionRuntimeFormState;

  export function getQuestionDraft(
    state: QuestionRuntimeFormState,
    questionId: string,
  ): QuestionRuntimeQuestionDraft;

  export function getQuestionResponseState(
    question: AuthorizedQuestionNode,
    draft: QuestionRuntimeQuestionDraft,
  ): QuestionResponseState;

  export function validateFormForSubmit(
    activeView: ActiveQuestionView,
    state: QuestionRuntimeFormState,
  ): FormValidationIssue[];

  export function buildStructuredSubmitResult(
    activeView: ActiveQuestionView,
    state: QuestionRuntimeFormState,
  ): QuestionRuntimeStructuredSubmitResult;

  export function buildQuestionRuntimeFormResult(input:
    | { action: "cancel"; state: QuestionRuntimeFormState }
    | {
        action: "submit";
        state: QuestionRuntimeFormState;
        submitResult: QuestionRuntimeStructuredSubmitResult;
      }
  ): QuestionRuntimeFormResult;
  ```

- `Key logic to add or change:`
  - Add `restoreQuestionDraft(...)` helpers that merge by `questionId`.
  - For restored multiple-choice drafts:
    - keep only selected option IDs still valid
    - keep only option-note entries for still-valid option IDs
    - clear `otherText` unless `other` remains selected
  - Preserve hidden inactive branch drafts by never clearing canonical state on deactivation.
  - Build submit results from active questions only, filter out `open`, compute `requiresClarification`, and emit `no_user_response` when nothing explicit remains.
- `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-graph.ts`, `extensions/question-runtime/question-model.ts`
- `Risks / notes:` Do not change task-02 semantics for `skipped`, `needs_clarification`, `otherText`, or note sanitization except where active-only scoping requires it.

#### `Path:` `extensions/question-runtime/form-shell.ts`

- `Action:` modify
- `Why:` The shell is the current static-tree bottleneck and must move to a questionId-based active-view UI.
- `Responsibilities:`
  - Normalize the request once, create hydrated canonical state, and recompute the active view after every mutation.
  - Render only active questions plus Review.
  - Preserve tab and focus state across active-view changes.
  - Render combined human-readable visibility reasons.
- `Planned exports / signatures:`

  ```ts
  export async function showQuestionRuntimeFormShell(
    ctx: ExtensionContext,
    payload: {
      requestId: string;
      projectRelativePath: string;
      request: AuthorizedQuestionRequest;
    },
  ): Promise<QuestionRuntimeFormResult>;
  ```

  Internal helpers expected:

  ```ts
  function getActiveView(): ActiveQuestionView;
  function syncCurrentTabAfterActiveViewChange(...): void;
  function buildQuestionRows(
    entry: ActiveQuestionEntry,
    draft: QuestionRuntimeQuestionDraft,
    contextExpanded: boolean,
  ): FocusableRow[];
  function renderVisibilityReasons(entry: ActiveQuestionEntry): string[];
  ```

- `Key logic to add or change:`
  - Replace startup `flattenQuestionsPreOrder(...)` with `normalizeQuestionGraph(...)`.
  - Replace numeric `tabIndex` state with `currentTabId: string | "__review__"`.
  - Keep `focusByQuestionId`, `expandedContextByQuestionId`, and `lastActiveQuestionIds` keyed by question ID rather than array index.
  - On active-view changes:
    - keep the current question if it still exists
    - otherwise move to the nearest surviving question based on prior active order
    - otherwise fall back to Review
  - Renumber tabs from active array order each render.
  - Replace static `path:`-centric rendering with `Visible because` lines built from parent question IDs and matched option labels.
  - Keep review counts, blockers, and jump targets scoped to active questions only.
  - On submit, build the current `ActiveQuestionView`, validate it, build the structured submit result, and return it with the latest `draftSnapshot`.
  - On cancel, return only the latest `draftSnapshot`.
- `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-graph.ts`, `extensions/question-runtime/form-state.ts`, `extensions/question-runtime/question-model.ts`
- `Risks / notes:` Keep existing keyboard bindings and editor-launch flow intact. Guard against stale row references when a mutation changes activation before the next render.

#### `Path:` `extensions/question-runtime/repair-messages.ts`

- `Action:` modify
- `Why:` The hidden control-message family needs reusable submit and cancel result builders without splitting transport strings across files.
- `Responsibilities:`
  - Preserve validation, retry, and abort message behavior.
  - Export the shared custom message type constant.
  - Add form submit and cancel result message builders.
- `Planned exports / signatures:`

  ```ts
  export const QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE = "question-runtime.control";

  export function buildFormSubmittedMessage(input: {
    requestId: string;
    path: string;
    projectRelativePath: string;
    draftSnapshot: QuestionRuntimeQuestionDraft[];
    submitResult: QuestionRuntimeStructuredSubmitResult;
  }): { ... };

  export function buildFormCancelledMessage(input: {
    requestId: string;
    path: string;
    projectRelativePath: string;
    draftSnapshot: QuestionRuntimeQuestionDraft[];
  }): { ... };
  ```

- `Key logic to add or change:`
  - Keep existing `details.type` shapes for validation, retry, and abort unchanged.
  - Add new hidden `details.type` values `form_submitted` and `form_cancelled`.
  - Keep concise hidden `content`; put the real machine contract in `details`.
- `Dependencies:` `extensions/question-runtime/types.ts`
- `Risks / notes:` This remains low-level transport only. Do not add product-owned loop-control semantics here.

#### `Path:` `extensions/question-runtime/index.ts`

- `Action:` modify
- `Why:` Structured form results are currently discarded.
- `Responsibilities:`
  - Capture submit or cancel results from the shell.
  - Send hidden structured result messages back to the agent.
  - Preserve request locking, retry prompts, and modal queue behavior.
- `Planned exports / signatures:`

  ```ts
  export default function questionRuntimeExtension(pi: ExtensionAPI): void;
  ```

  Internal helper expected:

  ```ts
  async function showReadyShell(item: ReadyQueueItem): Promise<void>;
  ```

- `Key logic to add or change:`
  - Update the top-of-file extension header so it no longer says the shell is read-only.
  - Replace the current message union with a broader `HiddenMessage` union that includes submit and cancel messages.
  - After `await showQuestionRuntimeFormShell(...)`, branch on `result.action` and send `buildFormSubmittedMessage(...)` or `buildFormCancelledMessage(...)`.
  - Continue using `deliverAs: "steer"` and `triggerTurn: true` when idle so the agent can react to user input.
- `Dependencies:` `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/repair-messages.ts`, `extensions/question-runtime/request-store.ts`
- `Risks / notes:` Do not disturb queue semantics or the task-01 guarantee that a consumed request stays locked.

#### `Path:` `extensions/question-runtime/request-validator.test.ts`

- `Action:` add
- `Why:` Validator behavior changes substantially and needs its own deterministic coverage.
- `Responsibilities:`
  - Lock down repeated-`questionId` acceptance or rejection behavior.
  - Lock down activation-rule and `draftSnapshot` validation semantics.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Use `bun:test`.
  - Cover:
    - activation arrays rejected on roots
    - `followUps` rejected under `freeform`
    - matching repeated `questionId` accepted
    - conflicting repeated `questionId` rejected
    - invalid dependency references and self-dependencies
    - invalid activation option IDs for yes/no and multiple-choice parents
    - duplicate `draftSnapshot` question IDs
    - snapshot kind mismatch
    - stale removed multiple-choice option IDs allowed structurally so hydrator can filter them later
- `Dependencies:` `extensions/question-runtime/request-validator.ts`
- `Risks / notes:` Keep tests deterministic and pure.

#### `Path:` `extensions/question-runtime/runtime-engine.test.ts`

- `Action:` add
- `Why:` Task-03 needs one pure runtime fixture that proves graph activation, dependency ordering, draft restoration, and active-only submission semantics.
- `Responsibilities:`
  - Exercise normalization, active-view computation, restore filtering, and structured submit result building without a live Pi session.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Use one or two fixtures that cover:
    - shared follow-up dedupe by `questionId`
    - combined visibility reasons
    - default activation when both arrays are omitted
    - yes/no and multiple-choice activation
    - answered-only activation
    - freeform non-activation
    - `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`
    - depth cap of `3`
    - follow-up cycle suppression
    - dependency-first ordering
    - unresolved dependency suppression
    - dependency-cycle suppression
    - hidden branch draft preservation and reactivation
    - restored draft option filtering when options changed
    - open-item omission from submit payload
    - `no_user_response` when no active explicit outcomes exist
    - cancel and submit result shapes carrying full `draftSnapshot`
- `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-graph.ts`, `extensions/question-runtime/form-state.ts`
- `Risks / notes:` Keep the file Bun-compatible and pure so it can run with a direct `bun test` command.

### 8. File Fingerprints

#### `extensions/question-runtime/types.ts` fingerprint

- `Existing anchors to search for:` `export interface AuthorizedQuestionRequest {`, `export interface AuthorizedQuestionBase {`, `export interface QuestionRuntimeFormResult {`
- `New anchors expected after implementation:` `export interface AuthorizedQuestionOccurrenceMetadata {`, `dependsOnQuestionIds?: string[];`, `export type QuestionRuntimeStructuredSubmitResult =`, `kind: "no_user_response"`
- `Unsafe areas to avoid touching:` `QUESTION_RUNTIME_STATE_ENTRY`, `RuntimeRequestRecord`, request-store persistence snapshot types

#### `extensions/question-runtime/question-model.ts` fingerprint

- `Existing anchors to search for:` `export function flattenQuestionsPreOrder(`, `export function buildChoiceQuestionModel(`
- `New anchors expected after implementation:` `export function getSelectableOptionIds(`, `export function getChoiceOptionLabel(`
- `Unsafe areas to avoid touching:` automatic `yes` or `no` or `other` option generation and current recommendation flags

#### `extensions/question-runtime/question-definition.ts` fingerprint

- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export interface CanonicalQuestionDefinitionSignature {`, `export function getCanonicalQuestionDefinitionSignature(`, `export function sameCanonicalQuestionDefinition(`
- `Unsafe areas to avoid touching:` none; new isolated pure module

#### `extensions/question-runtime/request-validator.ts` fingerprint

- `Existing anchors to search for:` `function validateQuestionNode(`, `function appendDuplicateQuestionIssues(`, `export function validateAuthorizedQuestionRequest(`
- `New anchors expected after implementation:` `function appendConflictingQuestionDefinitionIssues(`, `function appendDependencyReferenceIssues(`, `function appendActivationRuleIssues(`, `function validateDraftSnapshot(`
- `Unsafe areas to avoid touching:` current forbidden-field logic, authoring-guidance heuristics, deterministic issue ordering for existing task-01 and task-02 cases

#### `extensions/question-runtime/question-graph.ts` fingerprint

- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export interface NormalizedQuestionGraph {`, `export interface QuestionActivationEdge {`, `export interface ActiveQuestionEntry {`, `export function normalizeQuestionGraph(`, `export function buildActiveQuestionView(`
- `Unsafe areas to avoid touching:` none; new isolated pure module

#### `extensions/question-runtime/form-state.ts` fingerprint

- `Existing anchors to search for:` `export function createQuestionRuntimeFormState(`, `export function getQuestionResponseState(`, `export function validateFormForSubmit(`, `export function buildQuestionRuntimeFormResult(`
- `New anchors expected after implementation:` `function restoreQuestionDraft(`, `export function buildStructuredSubmitResult(`, `draftSnapshot?: QuestionRuntimeQuestionDraft[]`
- `Unsafe areas to avoid touching:` current note sanitization helpers, closure-state mutation semantics, task-02 answer-draft field names

#### `extensions/question-runtime/form-shell.ts` fingerprint

- `Existing anchors to search for:` `const reviewTabIndex = flattened.length;`, `function focusKey(): string {`, `tabIndex = (tabIndex + 1) % (flattened.length + 1);`, `tabIndex = (tabIndex - 1 + flattened.length + 1) % (flattened.length + 1);`, `const targetIndex = flattened.findIndex(`, `tabIndex = reviewTabIndex;`, `const row = rows[focusByTab.get(focusKey()) ?? 0];`
- `New anchors expected after implementation:` `const graph = normalizeQuestionGraph(payload.request);`, `let currentTabId: string | "__review__"`, `function getActiveView(`, `function syncCurrentTabAfterActiveViewChange(`, `Visible because`
- `Unsafe areas to avoid touching:` keyboard bindings, editor-launch flow, context collapse toggle behavior, existing row action names unless the graph work truly requires it

#### `extensions/question-runtime/repair-messages.ts` fingerprint

- `Existing anchors to search for:` `const CUSTOM_TYPE = "question-runtime.control";`, `export function buildValidationFailureMessage(`
- `New anchors expected after implementation:` `export const QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE = "question-runtime.control";`, `export function buildFormSubmittedMessage(`, `export function buildFormCancelledMessage(`, `type: "form_submitted"`, `type: "form_cancelled"`
- `Unsafe areas to avoid touching:` existing validation, retry, and abort detail shapes

#### `extensions/question-runtime/index.ts` fingerprint

- `Existing anchors to search for:` `type ControlMessage =`, `function sendHiddenMessage(`, `async function showReadyShell(item: ReadyQueueItem): Promise<void>`, `await showQuestionRuntimeFormShell(ctxRef, {`
- `New anchors expected after implementation:` `type HiddenMessage =`, `buildFormSubmittedMessage`, `buildFormCancelledMessage`, `const result = await showQuestionRuntimeFormShell(`
- `Unsafe areas to avoid touching:` retry queue flow, `flushVisibleQueue()`, request rehydration, request locking semantics

#### `extensions/question-runtime/request-validator.test.ts` fingerprint

- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `import { describe, expect, test } from "bun:test"`, `conflicting_question_definition`, `invalid_activation`, `draftSnapshot`
- `Unsafe areas to avoid touching:` none

#### `extensions/question-runtime/runtime-engine.test.ts` fingerprint

- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `import { describe, expect, test } from "bun:test"`, `shared follow-up`, `Visible because`, `no_user_response`
- `Unsafe areas to avoid touching:` none

### 9. Stepwise Execution Plan

1. **Expand shared contracts first.**
   - Update `types.ts` with dependencies, occurrence activation metadata, inbound `draftSnapshot`, and structured submit or cancel result types.

2. **Split reusable question helpers.**
   - Trim `question-model.ts` down to choice and option helpers.
   - Add `question-definition.ts` for canonical question-definition comparison.

3. **Refactor validation onto the new contract.**
   - Add deterministic validation for dependencies, activation metadata, repeated canonical definitions, and optional restored drafts.
   - Keep existing unknown-extra-field tolerance and authoring guidance.

4. **Add the pure graph runtime.**
   - Introduce `question-graph.ts` for normalization plus active-view construction.
   - Lock its behavior with pure tests as soon as the exported API stabilizes.

5. **Upgrade form state around the canonical graph.**
   - Hydrate canonical drafts from `NormalizedQuestionGraph` plus optional `draftSnapshot`.
   - Switch blockers and submit construction to `ActiveQuestionView`.

6. **Refactor the shell to consume the dynamic active view.**
   - Replace numeric tab index assumptions, active numbering, review scoping, and provenance rendering.
   - Preserve keyboard behavior and editor flows.

7. **Wire structured hidden result messages.**
   - Extend `repair-messages.ts` and make `index.ts` emit submit or cancel result messages after the shell closes.
   - Update the extension header comment in `index.ts` to match the new behavior.

8. **Add tests and repo checks.**
   - Add `request-validator.test.ts` and `runtime-engine.test.ts`.
   - Run both `bun test` commands.
   - Run `mise run check`.

9. **Reload and manually verify.**
   - Reload the extension because files under `extensions/question-runtime/` changed.
   - Drive one nested or shared or dependency fixture through the shell and confirm visibility, restore, and hidden result-message behavior.

### 10. Validation Plan

#### Automated verification

- `extensions/question-runtime/request-validator.test.ts`
  - root activation arrays rejected
  - `followUps` rejected under `freeform`
  - matching repeated `questionId` accepted
  - conflicting repeated `questionId` rejected
  - invalid dependency references and self-dependencies rejected
  - invalid activation option IDs rejected
  - duplicate `draftSnapshot` question IDs rejected
  - snapshot kind mismatches rejected
  - stale removed multiple-choice option IDs accepted structurally for later filtering

- `extensions/question-runtime/runtime-engine.test.ts`
  - shared follow-up dedupe by `questionId`
  - combined visibility reasons
  - default activation when both arrays are omitted
  - yes/no and multiple-choice activation
  - answered-only activation
  - freeform non-activation
  - `anyOfSelectedOptionIds` and `allOfSelectedOptionIds`
  - follow-up depth cap of `3`
  - follow-up cycle suppression
  - dependency-first ordering with stable tie-breaks
  - unresolved dependency suppression
  - dependency-cycle suppression
  - hidden branch draft preservation and reactivation
  - restored-draft option filtering when options changed
  - active-only blockers
  - open-item omission from submit payload
  - `no_user_response` when no explicit active outcomes exist
  - cancel and submit result shapes carrying full `draftSnapshot`

#### Manual verification needed

1. Open a request with nested follow-ups, shared follow-up nodes, and dependency-gated questions.
2. Trigger the same shared follow-up through two current parents and confirm:
   - it appears only once
   - numbering updates from the active view
   - `Visible because` explains both current paths
3. Answer a parent so a child appears, type into the child, then change the parent so the branch disappears.
   - confirm the child draft is hidden, not cleared
   - re-enable the branch and confirm the draft returns
4. Mark a dependency prerequisite `open`, `skipped`, and `needs_clarification` in turn and confirm the dependent stays hidden each time.
5. Submit a partial response and confirm:
   - untouched visible questions remain `open`
   - active answered, skipped, and clarification items are included
   - open items are omitted
   - inactive branches do not block submit
   - submit returns the latest `draftSnapshot`
6. Submit a form with no explicit active outcomes and confirm the hidden result is `kind: "no_user_response"`.
7. Cancel after edits and confirm the hidden cancel result carries the full `draftSnapshot` for later restoration.
8. Reopen the same form with that `draftSnapshot` and confirm compatible drafts restore, including hidden inactive branch drafts.

#### Expected user-visible behavior

- Tabs represent only currently active questions plus Review.
- Question numbering changes as the active graph changes.
- Shared follow-up questions do not duplicate.
- Non-root questions explain visibility through current parent answers rather than raw JSON paths.
- Hidden inactive branches stop blocking submit immediately.
- The agent receives one hidden structured result message after submit or cancel.

#### Failure modes to test

- conflicting inline definitions for the same `questionId`
- invalid dependency reference or self-dependency
- activation arrays on roots
- `followUps` under `freeform`
- activation arrays referencing unsupported option IDs
- restored draft contains removed option IDs or notes for removed options
- a hidden inactive branch still produces a blocker
- a follow-up cycle causes duplicated visibility or infinite traversal
- a dependency cycle surfaces unstable ordering instead of suppression
- a `needs_clarification` outcome fails to set `requiresClarification`

#### Repo checks to run

- `bun test extensions/question-runtime/request-validator.test.ts`
- `bun test extensions/question-runtime/runtime-engine.test.ts`
- `mise run check`
- Reload the extension before interactive verification because `extensions/question-runtime/` changed.
