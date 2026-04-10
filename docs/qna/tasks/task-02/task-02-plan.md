### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-02/task-02.md`
- `Task Title:` `Task 02 — Shared question rendering, answer controls, and response-state model`
- `Task Signature:` `task-02-shared-question-rendering-answer-controls-response-state-model`
- `Primary Code Scope:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/request-validator.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/index.ts`, `extensions/question-runtime/tool.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, product-specific `/qna` and `/interview` workflow code, branch/session persistence work from tasks 03+ , and non-question-runtime repo areas unrelated to the shared form

### 2. Executive Summary

This task should turn the current read-only question-runtime shell into the full shared static-question form. The runtime must accept richer authored question data, render all three supported question kinds with recommendations and justification, let users edit answers and notes, support `answered` / `open` / `skipped` / `needs_clarification`, and block final submit when `Other` text or clarification notes are missing.

The cleanest path is to keep the existing request/watch/retry pipeline intact and add two new pure layers underneath the UI: one module that derives reusable choice-question models (`yes_no` and `multiple_choice` share most row rendering rules), and one module that owns the per-question draft/state machine plus submit validation. `form-shell.ts` should become a thin interactive renderer over those pure helpers, and it should return a structured local form result that task 03 can later consume for graph-aware submission.

### 3. Requirement Map

1. **Requirement:** `The system shall support exactly three question kinds: yes_no, multiple_choice, and freeform.`
   - **Status:** `already satisfied`
   - **Current:** `extensions/question-runtime/types.ts` defines `QuestionKind`; `extensions/question-runtime/request-validator.ts` restricts `kind` to those three values in `validateQuestionNode()`.
   - **Planned implementation move:** Preserve the existing enum and layer richer rendering/state handling on top of it rather than adding new kinds.

2. **Requirement:** `Each question shall expose a short primary prompt.`
   - **Status:** `already satisfied`
   - **Current:** `AuthorizedQuestionBase.prompt` is required; `validateRequiredString(..., "prompt", ...)` enforces it; `form-shell.ts` already renders `question.prompt`.
   - **Planned implementation move:** Keep `prompt` as the primary headline in the active question view and review tab summaries.

3. **Requirement:** `Each question may expose an optional context block.`
   - **Status:** `needs implementation`
   - **Current:** No `context` field exists in `types.ts`, validator ignores it, and `form-shell.ts` has no collapsed/expanded context UI.
   - **Planned implementation move:** Add `context?: string` to authored question types, validate it as a non-empty string when present, and add per-question collapsed UI state with an explicit reveal toggle.

4. **Requirement:** `When a question can be reduced to a true yes or no decision, the system shall prefer yes_no.`
   - **Status:** `partially satisfied`
   - **Current:** The runtime supports `yes_no`, but nothing can deterministically infer author intent from freeform prose.
   - **Planned implementation move:** Treat this as caller-authoring guidance, not a runtime rejection rule; reinforce it through the updated request template and validator hints, but do not invent heuristic enforcement.

5. **Requirement:** `When a question can be reduced to a finite set of options, the system shall prefer multiple_choice.`
   - **Status:** `partially satisfied`
   - **Current:** `multiple_choice` is supported, but the runtime cannot reliably infer reducibility.
   - **Planned implementation move:** Keep this as authoring guidance and reflect it in the richer template/examples rather than adding non-deterministic validation.

6. **Requirement:** `When a question cannot be reduced to yes_no or multiple_choice without losing essential nuance, the system shall use freeform.`
   - **Status:** `partially satisfied`
   - **Current:** `freeform` exists, but the runtime cannot prove when nuance requires it.
   - **Planned implementation move:** Preserve `freeform` support and document this as a caller-owned choice, not a validator inference.

7. **Requirement:** `Every surfaced question shall include recommendation data.`
   - **Status:** `needs implementation`
   - **Current:** No recommendation fields exist in `types.ts`; validator and UI know nothing about recommendations.
   - **Planned implementation move:** Add kind-specific recommendation fields to the request schema and render them by default in the active question UI.

8. **Requirement:** `Every surfaced question shall include a justification.`
   - **Status:** `needs implementation`
   - **Current:** No `justification` field exists in the authored schema or form UI.
   - **Planned implementation move:** Add required `justification: string` to the shared authored question base, validate it, and render it under the prompt for every question.

9. **Requirement:** `When the question kind is freeform, the system shall require a separate suggestedAnswer field in addition to the justification.`
   - **Status:** `needs implementation`
   - **Current:** `AuthorizedFreeformQuestion` contains only `kind: "freeform"`.
   - **Planned implementation move:** Extend `AuthorizedFreeformQuestion` with `suggestedAnswer: string` and enforce it in `request-validator.ts`.

10. **Requirement:** `When the question kind is freeform, the system shall render the suggested answer as a read-only block separate from user input.`
    - **Status:** `needs implementation`
    - **Current:** `form-shell.ts` has no freeform-specific renderer beyond the prompt/kind line.
    - **Planned implementation move:** Add a dedicated read-only “Suggested answer” section above a separate editable user-answer field.

11. **Requirement:** `When the question kind is multiple_choice, the system shall render recommended options inline on option rows.`
    - **Status:** `needs implementation`
    - **Current:** `renderMultipleChoiceLines()` prints only `optionId` and `label`.
    - **Planned implementation move:** Build derived choice-row view models with `recommended: boolean` and render row-level recommendation badges.

12. **Requirement:** `When the question kind is yes_no, the system shall render the recommended side inline on the yes or no choice.`
    - **Status:** `needs implementation`
    - **Current:** `yes_no` questions have no rendered option rows at all.
    - **Planned implementation move:** Synthesize shared yes/no rows using reserved IDs and render the recommended side inline exactly like a single-select choice question.

13. **Requirement:** `Every multiple_choice question shall declare selectionMode: single | multi explicitly.`
    - **Status:** `already satisfied`
    - **Current:** `AuthorizedMultipleChoiceQuestion.selectionMode` exists and `request-validator.ts` enforces it.
    - **Planned implementation move:** Preserve the field and drive both row toggling logic and recommendation cardinality rules from it.

14. **Requirement:** `The shared runtime shall reserve option IDs yes, no, and other.`
    - **Status:** `needs implementation`
    - **Current:** Reserved IDs are not declared anywhere and authored `multiple_choice` options may currently use any string.
    - **Planned implementation move:** Export shared reserved-ID constants from `types.ts`, reject those IDs in authored multiple-choice options, and use them in runtime-derived rows and answer drafts.

15. **Requirement:** `Every multiple_choice question shall append an Other option automatically using optionId: other.`
    - **Status:** `needs implementation`
    - **Current:** `form-shell.ts` renders only authored `question.options`.
    - **Planned implementation move:** Add a shared helper that derives renderable choice rows and always appends a synthetic `Other` row with `optionId: "other"`.

16. **Requirement:** `Agent-authored multiple_choice options shall not redundantly include the automatic Other option.`
    - **Status:** `needs implementation`
    - **Current:** Validator allows authored `optionId: "other"`.
    - **Planned implementation move:** Reject authored `multiple_choice` options that use reserved IDs, especially `other`, with deterministic validator issues.

17. **Requirement:** `Every yes_no question shall model yes and no using the reserved option IDs yes and no.`
    - **Status:** `partially satisfied`
    - **Current:** `yes_no` is a distinct kind, but there is no shared option-row model or answer-state shape using `yes` / `no`.
    - **Planned implementation move:** Introduce a shared derived choice model that always materializes `yes` and `no` rows and stores the selected answer as those exact IDs.

18. **Requirement:** `A multiple_choice option may include optional description or subtext.`
    - **Status:** `needs implementation`
    - **Current:** `AuthorizedMultipleChoiceOption` contains only `optionId` and `label`.
    - **Planned implementation move:** Add an optional secondary-text field on choice options and render it as muted subtext under the main label.

19. **Requirement:** `When selectionMode is multi, the system shall allow the agent to recommend more than one option.`
    - **Status:** `needs implementation`
    - **Current:** No multiple-choice recommendation field exists.
    - **Planned implementation move:** Add `recommendedOptionIds: string[]` for multiple-choice questions and validate one-or-more IDs for `multi` questions.

20. **Requirement:** `The system shall not impose an artificial cap on the number of agent-provided multiple_choice options.`
    - **Status:** `already satisfied`
    - **Current:** Validator accepts arbitrary option-array lengths and no UI code slices the array.
    - **Planned implementation move:** Preserve the unbounded array model and avoid introducing pagination or hard row limits in the derived choice helper.

21. **Requirement:** `When the user selects Other, the form shall require non-empty otherText before submit.`
    - **Status:** `needs implementation`
    - **Current:** No `Other` row, no `otherText`, and no submit validation exist.
    - **Planned implementation move:** Store `otherText` separately in the multiple-choice answer draft and add submit validation that blocks final submit when `other` is selected but `otherText.trim()` is empty.

22. **Requirement:** `When the user selects Other, the payload shall send optionId: other plus separate otherText.`
    - **Status:** `needs implementation`
    - **Current:** No form result or answer payload shape exists.
    - **Planned implementation move:** Define a structured `QuestionRuntimeFormResult`/draft shape now so selected option IDs include `other` and `otherText` remains a sibling field for later task-03 payload construction.

23. **Requirement:** `When the question is multi-select, the system shall allow Other alongside normal selected options.`
    - **Status:** `needs implementation`
    - **Current:** No interactive multiple-choice selection exists.
    - **Planned implementation move:** In the shared form-state helper, treat `other` like any other selectable option for `multi`, while still requiring separate `otherText`.

24. **Requirement:** `When the user selects Other, the system shall not allow a separate note on that option.`
    - **Status:** `needs implementation`
    - **Current:** There is no note system and no special-case handling for `other`.
    - **Planned implementation move:** Mark the synthetic `Other` row as `noteAllowed: false` and have the form-state/result builder ignore any unexpected note draft for that row.

25. **Requirement:** `The UI may allow note entry on any option row for ease of use.`
    - **Status:** `needs implementation`
    - **Current:** No option-level notes exist.
    - **Planned implementation move:** Allow note editing on every non-`other` option row regardless of selection, but store those as drafts and sanitize to selected options only when building the answered result.

26. **Requirement:** `When a multiple_choice answer is submitted, the payload shall include notes only for selected options.`
    - **Status:** `needs implementation`
    - **Current:** There is no answered result builder.
    - **Planned implementation move:** Add a pure sanitizer in `form-state.ts` that filters `optionNoteDrafts` down to selected option IDs when building the structured form result.

27. **Requirement:** `The system shall support per-question response states answered, needs_clarification, skipped, and open.`
    - **Status:** `needs implementation`
    - **Current:** `types.ts` defines no user-response state model; `form-shell.ts` is read-only.
    - **Planned implementation move:** Export `QuestionResponseState`, initialize every question as `open`, and add explicit transitions for `answered`, `needs_clarification`, `skipped`, and `reopen` in a pure form-state module.

28. **Requirement:** `The system shall use the term note for all user-authored supplemental text.`
    - **Status:** `needs implementation`
    - **Current:** The question-runtime UI has no supplemental-text labels.
    - **Planned implementation move:** Standardize all UI labels and state fields on `note`, including answer-level notes and question-level notes.

29. **Requirement:** `When a question is answered as multiple_choice, the system shall store notes per selected option.`
    - **Status:** `needs implementation`
    - **Current:** No answer-state storage exists.
    - **Planned implementation move:** Use per-option note drafts in local form state and sanitize them to selected option notes in the structured answered result.

30. **Requirement:** `When a question is answered as yes_no or freeform, the system shall store one answer-level note.`
    - **Status:** `needs implementation`
    - **Current:** No answer-level note fields exist.
    - **Planned implementation move:** Add one `note` field inside yes/no and freeform answer drafts and render/edit it separately from question-level notes.

31. **Requirement:** `When a question is marked needs_clarification, the system shall store one question-level note.`
    - **Status:** `needs implementation`
    - **Current:** No question-level note field exists.
    - **Planned implementation move:** Add `questionNote` to each question draft record and use it as the current note when `responseState === "needs_clarification"`.

32. **Requirement:** `When a question is marked skipped, the system shall store one optional question-level note.`
    - **Status:** `needs implementation`
    - **Current:** No skip note exists.
    - **Planned implementation move:** Reuse the same `questionNote` field for `skipped`, without making it a submit blocker.

33. **Requirement:** `When the user marks a question needs_clarification, the system shall require a note before allowing final submit.`
    - **Status:** `needs implementation`
    - **Current:** There is no final submit path or clarification validation.
    - **Planned implementation move:** Add form-level submit validation that blocks only when a `needs_clarification` question has an empty trimmed `questionNote`.

34. **Requirement:** `When the user marks a question needs_clarification, the system shall treat that state as mutually exclusive with any answered state.`
    - **Status:** `needs implementation`
    - **Current:** No response-state transitions exist.
    - **Planned implementation move:** Make `responseState` singular and explicit; marking `needs_clarification` changes the current state without deleting the underlying answer draft.

35. **Requirement:** `When the user marks a question needs_clarification, the system shall dim and lock answer controls while preserving prior drafts underneath.`
    - **Status:** `needs implementation`
    - **Current:** No answer controls or draft model exist.
    - **Planned implementation move:** Render choice/freeform controls in dim styling, ignore answer-edit inputs while closed, and keep the answer draft object untouched in state.

36. **Requirement:** `When the user marks a question skipped, the system shall dim and lock answer controls while preserving prior drafts underneath.`
    - **Status:** `needs implementation`
    - **Current:** Same gap as above.
    - **Planned implementation move:** Apply the same closed-state rendering/locking rule for `skipped` while preserving the answer draft object.

37. **Requirement:** `When the user skips a question, the system shall treat that question as closed until it is explicitly reopened.`
    - **Status:** `needs implementation`
    - **Current:** No reopen behavior exists.
    - **Planned implementation move:** Add an explicit `reopenQuestion()` transition and make all answer-edit actions no-op while `responseState` is `skipped` or `needs_clarification`.

38. **Requirement:** `When a user reopens a previously skipped or needs_clarification question and submits a normal answer, that latest answer shall become the question's current state.`
    - **Status:** `needs implementation`
    - **Current:** No reopen or answer-commit path exists.
    - **Planned implementation move:** Reopening returns the question to `open`; a later explicit “mark answered” action or valid final submit can promote the preserved/latest answer draft back to `answered`.

39. **Requirement:** `The system shall show prompt, recommendation, and justification by default for the active question.`
    - **Status:** `partially satisfied`
    - **Current:** `form-shell.ts` shows `prompt` only; recommendation and justification fields do not exist.
    - **Planned implementation move:** Always render prompt plus recommendation/justification panels in the active question tab, with inline recommendation markers for choice questions and a suggested-answer block for freeform.

40. **Requirement:** `When a question has context, the system shall keep that context collapsed by default and shall allow the user to reveal it on demand.`
    - **Status:** `needs implementation`
    - **Current:** No context field or toggle state exists.
    - **Planned implementation move:** Keep a per-question `contextExpanded` UI flag and render a collapsed summary row plus a toggle key/action.

41. **Requirement:** `When the user is viewing a multi-select question, the system shall allow multiple options to be selected at once.`
    - **Status:** `needs implementation`
    - **Current:** No interactive multiple-choice renderer exists.
    - **Planned implementation move:** Use the shared choice model plus `selectionMode`-aware toggling so `multi` retains multiple selected IDs while `single` replaces the prior selection.

### 4. Current Architecture Deep Dive

#### Relevant files and current roles

- `extensions/question-runtime/types.ts`
  - Holds the minimal task-01 request model.
  - Holds validation issue types and runtime request store snapshot types.
  - Today it stops at `questionId`, `prompt`, `selectionMode`, and bare option labels.

- `extensions/question-runtime/request-validator.ts`
  - Parses JSON and validates only the fields the read-only shell currently needs.
  - Enforces non-empty `questions`, required `questionId` / `kind` / `prompt`, `multiple_choice.selectionMode`, non-empty `options`, duplicate `questionId`, and duplicate `optionId`.
  - Still ignores all task-02 presentation and response-state requirements.

- `extensions/question-runtime/form-shell.ts`
  - Flattens authored inline questions in stable pre-order.
  - Renders a tab strip and a read-only body with prompt, kind, path, and multiple-choice labels.
  - Has no notion of answer drafts, row focus, notes, review/submit, or result return.

- `extensions/question-runtime/index.ts`
  - Orchestrates request watching, validation failures, retry prompts, and ready-shell launch.
  - Locks the request before opening `showQuestionRuntimeFormShell(...)`.
  - Assumes the form is modal/read-only and returns `Promise<void>`.

- `extensions/question-runtime/tool.ts`
  - Registers `question_runtime_request`.
  - Returns a minimal freeform template that is valid only under task-01 schema rules.
  - Will become invalid once task-02 required fields land.

#### Existing runtime flow

1. `question_runtime_request` issues an authorized JSON path.
2. `request-watcher.ts` notices edits on known files.
3. `request-validator.ts` parses and validates the payload.
4. `index.ts` either sends hidden repair feedback or queues the request as ready.
5. `index.ts` locks the request and opens `showQuestionRuntimeFormShell(...)`.
6. The shell is currently view-only and closes on `Enter`, `Esc`, or `Ctrl+C`.

#### Current data/model shapes

- `AuthorizedQuestionBase`
  - `questionId`
  - `prompt`
  - optional inline `followUps`

- `AuthorizedYesNoQuestion`
  - `kind: "yes_no"`

- `AuthorizedFreeformQuestion`
  - `kind: "freeform"`

- `AuthorizedMultipleChoiceQuestion`
  - `kind: "multiple_choice"`
  - `selectionMode: "single" | "multi"`
  - `options: { optionId, label }[]`

- No current model exists for:
  - `context`
  - `justification`
  - recommendation fields
  - freeform `suggestedAnswer`
  - `Other`
  - per-question answer drafts
  - response states
  - any structured form result

#### Current UI/rendering flow

- Tabs are derived from pre-order flattening of the authored question tree.
- The active tab renders:
  - title
  - request metadata
  - tab strip
  - prompt
  - kind label
  - path
  - raw multiple-choice options if applicable
- There is no submit/review surface, no validation loop inside the form, and no separation between durable runtime state and transient UI state.

#### Reusable pieces that should be preserved

- `index.ts` request lifecycle, retry queue, and lock timing.
- Stable pre-order flattening of inline authored questions.
- Existing tab-oriented shell chrome from `form-shell.ts`.
- `extensions/shared/option-picker.ts` as a read-only reference for the “custom TUI step -> open editor -> resume custom TUI” pattern.
- `extensions/qna.ts` as a read-only reference for a review/submit tab and answer-status tab markers.

#### Friction, duplication, or missing seams

- `form-shell.ts` currently mixes flattening and rendering and has no extracted state machine layer.
- `yes_no` and `multiple_choice` need nearly the same row rendering rules, but there is no shared choice abstraction.
- The request schema and validator cannot express the fields the UI now needs.
- The runtime has no structured result object for later task-03 submission work.
- The request tool template will fall out of sync as soon as new required fields land.

### 5. Target Architecture

#### Proposed modules and responsibilities

- `extensions/question-runtime/types.ts`
  - Shared authored request schema.
  - Shared reserved-ID constants.
  - Shared response-state and local form-result types.
  - Existing runtime request-store types stay here too.

- `extensions/question-runtime/question-model.ts` **(new)**
  - Pure helpers that derive renderable question models from authored request data.
  - Shared pre-order flattening.
  - Shared choice-row construction for `yes_no` and `multiple_choice`, including synthetic `Other`.

- `extensions/question-runtime/request-validator.ts`
  - Deterministic schema validation for task-02 question fields.
  - Reserved-ID enforcement and recommendation/reference validation.
  - Still no graph activation or submission-payload validation.

- `extensions/question-runtime/form-state.ts` **(new)**
  - Pure per-question draft/state machine.
  - Answer-draft editing helpers.
  - `answered` / `open` / `skipped` / `needs_clarification` transitions.
  - Submit blockers for missing clarification notes and missing `otherText`.
  - Structured result builder for submit/cancel.

- `extensions/question-runtime/form-shell.ts`
  - Interactive TUI renderer only.
  - Question tab display, row focus, review tab, key handling, and editor-modal routing.
  - No business rules beyond calling the pure helpers.

- `extensions/question-runtime/index.ts`
  - Orchestration only.
  - Keeps retry and locking behavior unchanged.
  - Accepts a structured form result from the shell and intentionally does nothing with it yet.

- `extensions/question-runtime/tool.ts`
  - Emits a schema-valid starter template under the new authored contract.

#### Data flow from command entry to final emitted result

1. Agent calls `question_runtime_request`.
2. Tool returns the authorized path plus a task-02-valid starter template.
3. Watcher and validator approve a richer `AuthorizedQuestionRequest`.
4. `index.ts` launches the interactive form.
5. `question-model.ts` flattens questions and derives renderable choice rows.
6. `form-state.ts` builds local draft state for every question.
7. `form-shell.ts` lets the user edit drafts, mark states, reopen questions, and review submit blockers.
8. On submit or cancel, `form-shell.ts` returns `QuestionRuntimeFormResult` to `index.ts`.
9. Task 02 stops there; task 03 will consume that result to build graph-aware structured agent payloads.

#### Reusable abstractions to introduce or strengthen

- `RESERVED_OPTION_IDS` and reserved-ID helpers shared by validator, render model, and form-state code.
- `buildChoiceQuestionModel(...)` so `yes_no` and `multiple_choice` share one rendering path.
- `QuestionRuntimeQuestionDraft` / `QuestionAnswerDraft` so task 03 can reuse task-02 state without reverse-engineering UI internals.
- `validateFormForSubmit(...)` and `buildQuestionRuntimeFormResult(...)` as pure functions reusable by future active-graph submission work.

#### Clear boundaries between runtime, validation, storage, UI, and orchestration

- **Validation:** `request-validator.ts`
- **Request/watch/storage lifecycle:** existing `request-store.ts`, `request-watcher.ts`, `repair-messages.ts`, `index.ts`
- **Question-model derivation:** `question-model.ts`
- **Per-question runtime state and submit rules:** `form-state.ts`
- **UI rendering and input loop:** `form-shell.ts`
- **Command/tool entry:** `tool.ts`

```text
question_runtime_request
          |
          v
  request-validator.ts
          |
          v
AuthorizedQuestionRequest
          |
          +----------------------------+
          |                            |
          v                            v
 question-model.ts              form-state.ts
 (flatten + choice rows)        (drafts + transitions + submit rules)
          |                            ^
          +------------+---------------+
                       |
                       v
                form-shell.ts
          (tabs, editors, review, submit)
                       |
                       v
          QuestionRuntimeFormResult
                       |
                       v
                  index.ts
        (no payload emission until task 03)
```

### 6. File-by-File Implementation Plan

#### 6.1 Files to modify or add

- `Path:` `extensions/question-runtime/types.ts`
  - `Action:` `modify`
  - `Why:` Task-01 types stop before recommendation, justification, reserved IDs, and user response state.
  - `Responsibilities:`
    - Expand the authored request schema for task-02 fields.
    - Export shared reserved option IDs.
    - Export shared per-question draft/result types for the interactive form.
    - Preserve existing request-store state types.
  - `Planned exports / signatures:`

    ```ts
    export const RESERVED_OPTION_IDS = ["yes", "no", "other"] as const;
    export type ReservedOptionId = (typeof RESERVED_OPTION_IDS)[number];
    export type QuestionResponseState = "answered" | "needs_clarification" | "skipped" | "open";

    export interface AuthorizedQuestionBase {
      questionId: string;
      prompt: string;
      context?: string;
      justification: string;
      followUps?: AuthorizedQuestionNode[];
    }

    export interface AuthorizedYesNoQuestion extends AuthorizedQuestionBase {
      kind: "yes_no";
      recommendedOptionId: "yes" | "no";
    }

    export interface AuthorizedFreeformQuestion extends AuthorizedQuestionBase {
      kind: "freeform";
      suggestedAnswer: string;
    }

    export interface AuthorizedMultipleChoiceOption {
      optionId: string;
      label: string;
      description?: string;
    }

    export interface AuthorizedMultipleChoiceQuestion extends AuthorizedQuestionBase {
      kind: "multiple_choice";
      selectionMode: "single" | "multi";
      options: AuthorizedMultipleChoiceOption[];
      recommendedOptionIds: string[];
    }

    export type QuestionAnswerDraft =
      | { kind: "yes_no"; selectedOptionId: "yes" | "no" | null; note: string }
      | {
          kind: "multiple_choice";
          selectedOptionIds: string[];
          otherText: string;
          optionNoteDrafts: Record<string, string>;
        }
      | { kind: "freeform"; text: string; note: string };

    export interface QuestionRuntimeQuestionDraft {
      questionId: string;
      responseState: QuestionResponseState;
      answerDraft: QuestionAnswerDraft;
      questionNote: string;
    }

    export interface QuestionRuntimeFormResult {
      action: "submit" | "cancel";
      questions: QuestionRuntimeQuestionDraft[];
    }
    ```

  - `Key logic to add or change:`
    - Extend `ValidationIssueCode` with generic value/reference issues needed for task-02 schema rules.
    - Keep request-store snapshot types unchanged and colocated so task-01 infrastructure keeps compiling.
  - `Dependencies:` none
  - `Risks / notes:` Do not let UI-only focus/scroll state leak into the shared durable draft/result types.

- `Path:` `extensions/question-runtime/question-model.ts`
  - `Action:` `add`
  - `Why:` Reserved yes/no rows, synthetic `Other`, and static pre-order flattening should not live inside the TUI renderer.
  - `Responsibilities:`
    - Flatten authored inline questions in stable pre-order.
    - Convert `yes_no` and `multiple_choice` questions into one shared renderable choice model.
    - Append the automatic `Other` row and mark recommendation/note availability per row.
  - `Planned exports / signatures:`

    ```ts
    export interface FlattenedQuestion {
      question: AuthorizedQuestionNode;
      path: string;
    }

    export interface RuntimeChoiceOption {
      optionId: string;
      label: string;
      description?: string;
      recommended: boolean;
      noteAllowed: boolean;
      automatic: boolean;
    }

    export interface RuntimeChoiceQuestionModel {
      selectionMode: "single" | "multi";
      options: RuntimeChoiceOption[];
    }

    export function flattenQuestionsPreOrder(
      questions: AuthorizedQuestionNode[],
      basePath?: string,
    ): FlattenedQuestion[];

    export function buildChoiceQuestionModel(
      question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
    ): RuntimeChoiceQuestionModel;
    ```

  - `Key logic to add or change:`
    - `yes_no` should always derive exactly two rows with `optionId: "yes"` and `optionId: "no"`.
    - `multiple_choice` should append one synthetic `Other` row with `optionId: "other"` and `noteAllowed: false`.
    - Recommendation flags should be precomputed here so the UI layer only renders them.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:` Keep this module static-question only; do not add task-03 active-graph logic here.

- `Path:` `extensions/question-runtime/request-validator.ts`
  - `Action:` `modify`
  - `Why:` The validator must grow from task-01 minimal schema checks to full task-02 authored request requirements.
  - `Responsibilities:`
    - Validate `context`, `justification`, recommendation fields, `suggestedAnswer`, and optional option descriptions.
    - Reject reserved authored option IDs.
    - Validate recommendation references against real option IDs.
    - Preserve deterministic issue ordering and unknown-field tolerance.
  - `Planned exports / signatures:`

    ```ts
    export function validateAuthorizedQuestionRequest(text: string): RequestValidationResult;
    ```

  - `Key logic to add or change:`
    - Require `justification` on every question.
    - Require `recommendedOptionId` for `yes_no` and ensure it is `yes` or `no`.
    - Require `suggestedAnswer` for `freeform`.
    - Require non-empty `recommendedOptionIds` for `multiple_choice`, validate references, and reject duplicates/reserved references as needed.
    - Reject authored `multiple_choice` options that use `yes`, `no`, or `other`.
    - Validate optional `context` and option `description` as non-empty strings when present.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:`
    - Do not reject unknown extra fields.
    - Keep parse error, top-level-object error, and duplicate-check ordering stable.

- `Path:` `extensions/question-runtime/form-state.ts`
  - `Action:` `add`
  - `Why:` The current shell has no reusable per-question draft/state engine, and task-03 will need to build on the same state model.
  - `Responsibilities:`
    - Initialize one draft record per flattened question.
    - Store answer drafts separately from current `responseState`.
    - Handle `answered`, `needs_clarification`, `skipped`, and `reopen` transitions.
    - Validate submit blockers.
    - Build a structured local form result for submit or cancel.
  - `Planned exports / signatures:`

    ```ts
    export type FormValidationIssueCode =
      | "missing_answer"
      | "missing_other_text"
      | "missing_clarification_note";

    export interface FormValidationIssue {
      questionId: string;
      code: FormValidationIssueCode;
      message: string;
    }

    export interface QuestionRuntimeFormState {
      questions: Record<string, QuestionRuntimeQuestionDraft>;
      questionOrder: string[];
      contextExpanded: Record<string, boolean>;
    }

    export function createQuestionRuntimeFormState(
      flattenedQuestions: FlattenedQuestion[],
    ): QuestionRuntimeFormState;

    export function setYesNoSelection(
      state: QuestionRuntimeFormState,
      questionId: string,
      optionId: "yes" | "no",
    ): void;

    export function toggleMultipleChoiceOption(
      state: QuestionRuntimeFormState,
      questionId: string,
      optionId: string,
      selectionMode: "single" | "multi",
    ): void;

    export function setMultipleChoiceOtherText(
      state: QuestionRuntimeFormState,
      questionId: string,
      otherText: string,
    ): void;

    export function setMultipleChoiceOptionNote(
      state: QuestionRuntimeFormState,
      questionId: string,
      optionId: string,
      note: string,
    ): void;

    export function setFreeformText(
      state: QuestionRuntimeFormState,
      questionId: string,
      text: string,
    ): void;

    export function setAnswerNote(
      state: QuestionRuntimeFormState,
      questionId: string,
      note: string,
    ): void;

    export function setQuestionNote(
      state: QuestionRuntimeFormState,
      questionId: string,
      note: string,
    ): void;

    export function markAnswered(
      state: QuestionRuntimeFormState,
      question: AuthorizedQuestionNode,
    ): FormValidationIssue | null;

    export function markNeedsClarification(
      state: QuestionRuntimeFormState,
      questionId: string,
    ): void;

    export function markSkipped(
      state: QuestionRuntimeFormState,
      questionId: string,
    ): void;

    export function reopenQuestion(
      state: QuestionRuntimeFormState,
      questionId: string,
    ): void;

    export function toggleContextExpanded(
      state: QuestionRuntimeFormState,
      questionId: string,
    ): void;

    export function validateFormForSubmit(
      flattenedQuestions: FlattenedQuestion[],
      state: QuestionRuntimeFormState,
    ): FormValidationIssue[];

    export function buildQuestionRuntimeFormResult(
      state: QuestionRuntimeFormState,
      action: "submit" | "cancel",
    ): QuestionRuntimeFormResult;
    ```

  - `Key logic to add or change:`
    - Preserve answer drafts even when current state becomes `skipped` or `needs_clarification`.
    - Make `questionNote` the closed-state note and answer-draft notes the answered-state notes.
    - Filter multiple-choice note drafts down to selected options when building the result.
    - Keep `open` valid at final submit unless some other blocker is triggered.
  - `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-model.ts`
  - `Risks / notes:` Keep this pure and framework-agnostic so task-03 can reuse it for active-graph and draft-restoration work.

- `Path:` `extensions/question-runtime/form-shell.ts`
  - `Action:` `modify`
  - `Why:` The existing file is only a shell; task 02 requires the full interactive static-question form.
  - `Responsibilities:`
    - Render question tabs plus a final review/submit tab.
    - Render prompt, recommendation, justification, optional context, and kind-specific answer controls.
    - Route multiline editing through `ctx.ui.editor(...)` for freeform text, `Other` text, and notes.
    - Respect closed-state locking/dimming.
    - Return a structured `QuestionRuntimeFormResult`.
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

  - `Key logic to add or change:`
    - Replace the inline `FlattenedQuestion`/`flattenQuestions()` implementation with helpers from `question-model.ts`.
    - Add status markers to tabs so users can see `open` / `answered` / `skipped` / `needs_clarification` at a glance.
    - Add one shared choice-question renderer for `yes_no` and `multiple_choice`.
    - Add one freeform renderer with read-only suggested answer and editable answer/note affordances.
    - Add a review tab that lists counts, blockers, and submit hints.
    - Use a step-loop pattern like `option-picker.ts`: custom TUI step returns “edit field” intents, then the shell opens `ctx.ui.editor(...)`, updates state, and resumes the form.
  - `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-model.ts`, `extensions/question-runtime/form-state.ts`, `extensions/shared/option-picker.ts` and `extensions/qna.ts` as read-only implementation references only
  - `Risks / notes:`
    - Do not rework request-launch orchestration here.
    - Keep keyboard behavior simple and discoverable; avoid building a one-off control tree that task 03 would have to replace.

- `Path:` `extensions/question-runtime/index.ts`
  - `Action:` `modify`
  - `Why:` The launcher must handle the form’s new non-void result contract without disturbing retry/lock behavior.
  - `Responsibilities:`
    - Keep request lifecycle orchestration unchanged.
    - Accept the form result and intentionally no-op until task 03 consumes it.
  - `Planned exports / signatures:`

    ```ts
    export default function questionRuntimeExtension(pi: ExtensionAPI): void;
    ```

  - `Key logic to add or change:`
    - Capture the return value from `showQuestionRuntimeFormShell(...)`.
    - Keep request locking before launch exactly where it is now.
    - Avoid adding storage or payload emission logic in this task.
  - `Dependencies:` `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/types.ts`
  - `Risks / notes:` The retry queue, abort flow, and lock timing are task-01 behavior; do not regress them while threading the new result type.

- `Path:` `extensions/question-runtime/tool.ts`
  - `Action:` `modify`
  - `Why:` The starter template must remain valid after `justification` and recommendation fields become required.
  - `Responsibilities:`
    - Keep request issuance unchanged.
    - Return a template that passes the richer validator.
  - `Planned exports / signatures:`

    ```ts
    export function registerQuestionRuntimeRequestTool(
      pi: ExtensionAPI,
      store: QuestionRuntimeRequestStore,
      onRequestCreated: () => void,
    ): void;
    ```

  - `Key logic to add or change:`
    - Update `buildTemplate()` so the returned JSON includes task-02-required fields.
    - Keep the template minimal, likely a single valid freeform question with `justification` and `suggestedAnswer`.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:` Do not change request ID sequencing, path issuance, or tool response field names.

#### 6.2 Read-only reference context

- `extensions/qna.ts`
  - Useful for tab-strip status markers and a review/submit page pattern.

- `extensions/shared/option-picker.ts`
  - Useful for the “custom TUI -> open editor -> resume custom TUI” note-edit loop.

- `extensions/question-runtime/request-watcher.ts`
  - Important flow context but no task-02 behavior change is needed.

- `extensions/question-runtime/request-store.ts`
  - Important request lifecycle context but no task-02 behavior change is needed.

- `extensions/question-runtime/repair-messages.ts`
  - Important validation-message context but the generic formatter should already handle new issue codes/messages.

### 7. File Fingerprints

- `Path:` `extensions/question-runtime/types.ts`
  - `Reason this file changes:` Add task-02 authored question fields, reserved option IDs, and shared response/result types.
  - `Existing anchors to search for:` `export type QuestionKind = "yes_no" | "multiple_choice" | "freeform";`, `export interface AuthorizedQuestionBase {`, `export interface AuthorizedMultipleChoiceOption {`, `export type ValidationIssueCode =`
  - `New anchors expected after implementation:` `export const RESERVED_OPTION_IDS =`, `export type QuestionResponseState =`, `export interface QuestionRuntimeFormResult {`
  - `Unsafe areas to avoid touching:` `QUESTION_RUNTIME_STATE_ENTRY`, `RuntimeRequestRecord`, and the request-store snapshot types unless a compile error forces a mechanical import/type update

- `Path:` `extensions/question-runtime/question-model.ts`
  - `Reason this file changes:` New pure helper layer for flattening and renderable choice rows.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function flattenQuestionsPreOrder(`, `export function buildChoiceQuestionModel(`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/question-runtime/request-validator.ts`
  - `Reason this file changes:` Enforce task-02 schema fields, reserved IDs, and recommendation references.
  - `Existing anchors to search for:` `const FORBIDDEN_PRODUCT_FIELDS = new Set([`, `function validateQuestionNode(`, `function appendDuplicateOptionIssues(`, `export function validateAuthorizedQuestionRequest(`
  - `New anchors expected after implementation:` `function validateRecommendedOptionIds(`, `reserved_option_id`, `invalid_reference`
  - `Unsafe areas to avoid touching:` parse-error handling at `$`, top-level object validation, unknown-field tolerance, and the existing forbidden product-field checks

- `Path:` `extensions/question-runtime/form-state.ts`
  - `Reason this file changes:` New pure form-state machine and submit-validation layer.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function createQuestionRuntimeFormState(`, `export function markAnswered(`, `export function validateFormForSubmit(`, `export function buildQuestionRuntimeFormResult(`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/question-runtime/form-shell.ts`
  - `Reason this file changes:` Replace the read-only shell body with the full interactive question form.
  - `Existing anchors to search for:` `interface FlattenedQuestion {`, `function flattenQuestions(`, `function renderMultipleChoiceLines(`, `export async function showQuestionRuntimeFormShell(`
  - `New anchors expected after implementation:` `function renderReviewTab(`, `function renderChoiceQuestion(`, `Promise<QuestionRuntimeFormResult>`
  - `Unsafe areas to avoid touching:` request metadata passed into the shell and the overall tab-oriented layout contract

- `Path:` `extensions/question-runtime/index.ts`
  - `Reason this file changes:` Thread the form result through the launcher without changing request orchestration behavior.
  - `Existing anchors to search for:` `async function showReadyShell(item: ReadyQueueItem): Promise<void> {`, `await showQuestionRuntimeFormShell(ctxRef, {`
  - `New anchors expected after implementation:` `const formResult = await showQuestionRuntimeFormShell(`
  - `Unsafe areas to avoid touching:` retry prompt ordering, `store.lockRequest(...)`, and hidden repair-message delivery

- `Path:` `extensions/question-runtime/tool.ts`
  - `Reason this file changes:` Keep the emitted starter template valid under the new task-02 schema.
  - `Existing anchors to search for:` `function buildTemplate(): Record<string, unknown> {`, `question_runtime_request`, `template,`
  - `New anchors expected after implementation:` `justification:`, `suggestedAnswer:`
  - `Unsafe areas to avoid touching:` request ID generation, path building, and the `details.requestId/path/projectRelativePath` response contract

### 8. Stepwise Execution Plan

1. Expand `extensions/question-runtime/types.ts` with the richer authored question schema, reserved option IDs, and shared draft/result types.
2. Add `extensions/question-runtime/question-model.ts` so flattening, yes/no rows, and automatic `Other` are not duplicated between the validator and UI.
3. Update `extensions/question-runtime/request-validator.ts` to enforce the task-02 schema and reserved-ID rules.
4. Add `extensions/question-runtime/form-state.ts` with initialization, transitions, submit validation, and result building.
5. Replace the read-only logic in `extensions/question-runtime/form-shell.ts` with the interactive tab/review/editor loop wired to `question-model.ts` and `form-state.ts`.
6. Update `extensions/question-runtime/tool.ts` so its starter template is valid again.
7. Update `extensions/question-runtime/index.ts` to accept the form result without altering the surrounding retry/lock pipeline.
8. Reload the extensions before any interactive verification because files under `extensions/question-runtime/` changed.
9. Run a manual mixed-question fixture through the authorized-path flow and verify every task-02 interaction path.
10. Run `mise run check` after all TypeScript edits.

#### Parallelization notes

- Steps 1-2 should happen first because both validator and form-state depend on the new shared schema/constants.
- Step 3 and step 4 are safe to do in parallel once step 1 is settled.
- Step 6 can happen in parallel with step 5 after the schema contract is final.
- Step 7 should happen after step 5 because the form function signature changes.
- Steps 8-10 are sequential verification work.

#### Checkpoints

- After step 3: validate that the request tool template still passes the richer validator.
- After step 5: manually verify per-question interaction and submit blockers before touching launcher code.
- After step 7: confirm a valid request still locks and opens exactly once.

### 9. Validation Plan

#### Unit-level verification for pure helpers

- `request-validator.ts`
  - valid freeform question requires `justification` and `suggestedAnswer`
  - valid yes/no question requires `recommendedOptionId: "yes" | "no"`
  - valid multiple-choice question requires `recommendedOptionIds`
  - authored multiple-choice `optionId: "other"` is rejected
  - recommended option IDs must refer to authored options
  - optional `context` and option `description` reject empty strings when present
  - unknown extra fields still pass when known fields are valid

- `form-state.ts`
  - initial state is `open` for all questions
  - `markNeedsClarification()` preserves answer drafts and changes only `responseState`
  - `markSkipped()` preserves answer drafts and locks edits until `reopenQuestion()`
  - multi-select supports multiple selected IDs including `other`
  - submit validation blocks `other` without `otherText`
  - submit validation blocks `needs_clarification` without a note
  - multiple-choice answered results include notes only for selected option IDs

#### Integration/manual verification

Use one authorized request with at least:

- one `yes_no` question with `recommendedOptionId: "yes"`
- one single-select `multiple_choice` question with option descriptions and a recommendation
- one multi-select `multiple_choice` question that uses `Other`
- one `freeform` question with `suggestedAnswer`
- at least one question with `context`

Manual checks:

1. Open the request and confirm the form still launches through the task-01 request pipeline.
2. Verify prompt, recommendation, and justification are visible by default on the active tab.
3. Toggle context open/closed and confirm it starts collapsed.
4. Verify yes/no renders only `yes` and `no` rows and the recommended side is marked inline.
5. Verify multiple-choice always shows an automatic `Other` row even when the authored JSON omits it.
6. Verify multi-select allows several normal options plus `Other` at once.
7. Verify `Other` text uses a dedicated editor path and blocks submit when empty.
8. Verify option-row notes can be edited on non-`other` rows and appear only for selected options in the built result.
9. Verify freeform shows a read-only suggested-answer block above user input.
10. Verify `needs_clarification` and `skipped` dim/lock answer controls but keep prior drafts when reopened.
11. Verify reopened questions can return to `answered` without losing the preserved draft.
12. Verify open questions do not block submit.

#### Expected user-visible behavior

- Users can move across tabs, edit answers/notes, mark a question skipped or needing clarification, reopen it, and see their prior draft restored.
- Choice recommendations appear inline on rows; freeform recommendation appears as a separate read-only suggestion block.
- The review/submit tab clearly shows blocking problems before submit.

#### Failure modes to test

- authored `multiple_choice` options include `other`
- `recommendedOptionIds` reference a missing option
- `recommendedOptionId` for `yes_no` is not `yes`/`no`
- selecting `Other` and leaving `otherText` blank
- marking `needs_clarification` without a note
- attempting to edit answer controls while a question is `skipped` or `needs_clarification`
- form submit after reopening a closed question with preserved drafts

#### Repo checks

- Reload the extension before interactive testing because files in `extensions/question-runtime/` changed.
- Run `mise run check` after the TypeScript work is complete.

### 10. Open Questions / Assumptions

- **Assumption:** Use `context?: string` and one optional multiple-choice secondary text field named `description?: string`; task-02 does not need a richer structured context/subtext object.
- **Assumption:** `recommendedOptionIds` is a non-empty array for `multiple_choice`; enforce exactly one recommended ID for `selectionMode: "single"` and one-or-more for `selectionMode: "multi"`.
- **Assumption:** Task 02 returns a structured `QuestionRuntimeFormResult` to `index.ts` and closes the modal, but does not yet emit an agent-facing submission payload; task 03 owns that next step.
