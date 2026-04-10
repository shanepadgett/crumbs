### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-02/task-02.md`
- `Task Title:` `Task 02 — Shared question rendering, answer controls, and response-state model`
- `Task Signature:` `task-02-shared-question-rendering-answer-controls-response-state-model`
- `Primary Code Scope:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/request-validator.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/tool.ts`, `extensions/question-runtime/question-model.ts`, `extensions/question-runtime/form-state.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, product-specific `/qna` and `/interview` workflow code, request lifecycle files from task 01 (`extensions/question-runtime/index.ts`, `request-store.ts`, `request-watcher.ts`, `repair-messages.ts`, `request-paths.ts`), and all task-03+ graph/persistence/submission work

### 2. Executive Summary

This task should upgrade the current read-only question-runtime shell into the full shared static-question form for a single authored payload. The form must render all three question kinds, show justification and recommendation data in the right places, support reserved option behavior for `yes` / `no` / `other`, allow notes and `Other` text editing, and expose the user-facing response-state model `open` / `answered` / `skipped` / `needs_clarification` without introducing product-specific workflow or graph logic.

The cleanest architecture is to keep the task-01 request pipeline unchanged and add two pure reusable layers under the TUI: one layer to derive renderable question/choice models from the authored schema, and one layer to manage editable drafts, computed response states, submit blockers, and sanitized per-question outcomes. `form-shell.ts` should keep only shell-local UI state such as active tab, row focus, and context expansion, then call the pure helpers to avoid duplicating logic that task 03 will need again.

### 3. Requirement Map

1. **Requirement:** `The system shall support exactly three question kinds: yes_no, multiple_choice, and freeform.`
   - **Status:** `already satisfied`
   - **Current:** `extensions/question-runtime/types.ts` defines `QuestionKind`; `extensions/question-runtime/request-validator.ts` restricts `kind` to those three values in `validateQuestionNode()`.
   - **Planned implementation move:** Preserve the existing enum and extend schema/rendering/state around it.

2. **Requirement:** `Each question shall expose a short primary prompt.`
   - **Status:** `already satisfied`
   - **Current:** `AuthorizedQuestionBase.prompt` is required and rendered in `form-shell.ts`.
   - **Planned implementation move:** Keep `prompt` as the primary headline in every active question tab and in review-tab summaries.

3. **Requirement:** `Each question may expose an optional context block.`
   - **Status:** `needs implementation`
   - **Current:** No `context` field exists in the schema or UI.
   - **Planned implementation move:** Add `context?: string`, validate it as a non-empty string when present, and keep expansion state shell-local in `form-shell.ts` so reusable draft state stays UI-agnostic.

4. **Requirement:** `When authoring a question payload, the agent shall prefer yes_no for decisions that are truly binary.`
   - **Status:** `implemented`
   - **Current:** Kind selection remains agent-authored, and the validator now emits best-effort authoring guidance for obvious yes/no mismatches.
   - **Planned implementation move:** Keep enforcement at the authoring-guidance level rather than trying to make the runtime infer intent semantically.

5. **Requirement:** `When authoring a question payload, the agent shall prefer multiple_choice when the decision can be reduced to a finite authored option set.`
   - **Status:** `implemented`
   - **Current:** The validator emits best-effort authoring guidance when a freeform suggested answer already enumerates a finite option set.
   - **Planned implementation move:** Keep this as authoring guidance backed by validator hints rather than hard semantic rejection.

6. **Requirement:** `When authoring a question payload, the agent shall use freeform only when reducing the question to yes_no or multiple_choice would lose essential nuance.`
   - **Status:** `implemented`
   - **Current:** Freeform remains agent-authored, and the validator now requires justification plus emits authoring guidance when a freeform choice looks reducible.
   - **Planned implementation move:** Keep nuance judgment author-owned while using validator guidance to catch obvious misclassification.

7. **Requirement:** `Every surfaced question shall include recommendation data.`
   - **Status:** `needs implementation`
   - **Current:** No recommendation fields exist in `types.ts` or `request-validator.ts`.
   - **Planned implementation move:** Lock the authored schema per kind:
     - `yes_no` -> `recommendedOptionId: "yes" | "no"`
     - `multiple_choice` -> `recommendedOptionIds: string[]`
     - `freeform` -> `suggestedAnswer: string` satisfies the recommendation requirement for this kind.

8. **Requirement:** `Every surfaced question shall include a justification.`
   - **Status:** `needs implementation`
   - **Current:** No `justification` field exists.
   - **Planned implementation move:** Add required `justification: string` to the shared authored base and render it by default on every question tab.

9. **Requirement:** `When the question kind is freeform, the system shall require a separate suggestedAnswer field in addition to the justification.`
   - **Status:** `needs implementation`
   - **Current:** `AuthorizedFreeformQuestion` contains only `kind: "freeform"`.
   - **Planned implementation move:** Add `suggestedAnswer: string` to `AuthorizedFreeformQuestion` and require it in the validator.

10. **Requirement:** `When the question kind is freeform, the system shall render the suggested answer as a read-only block separate from user input.`
    - **Status:** `needs implementation`
    - **Current:** `form-shell.ts` has no freeform-specific body.
    - **Planned implementation move:** Render a read-only `Suggested answer` section above a separate editable `Answer` field and optional answer-level `note` field.

11. **Requirement:** `When the question kind is multiple_choice, the system shall render recommended options inline on option rows.`
    - **Status:** `needs implementation`
    - **Current:** `renderMultipleChoiceLines()` renders only raw labels.
    - **Planned implementation move:** Derive shared choice rows with `recommended: boolean` and render recommendation badges inline on those rows only.

12. **Requirement:** `When the question kind is yes_no, the system shall render the recommended side inline on the yes or no choice.`
    - **Status:** `needs implementation`
    - **Current:** `yes_no` questions render no option rows.
    - **Planned implementation move:** Materialize `yes` and `no` as synthetic choice rows and mark the recommended side inline.

13. **Requirement:** `Every multiple_choice question shall declare selectionMode: single | multi explicitly.`
    - **Status:** `already satisfied`
    - **Current:** `AuthorizedMultipleChoiceQuestion.selectionMode` exists and is validated.
    - **Planned implementation move:** Preserve it and drive selection toggling plus recommendation cardinality from it.

14. **Requirement:** `The shared runtime shall reserve option IDs yes, no, and other.`
    - **Status:** `needs implementation`
    - **Current:** Reserved IDs are not declared or enforced.
    - **Planned implementation move:** Export reserved-ID constants from `types.ts` and use them in validator, choice-model derivation, and answer drafts.

15. **Requirement:** `Every multiple_choice question shall append an Other option automatically using optionId: other.`
    - **Status:** `needs implementation`
    - **Current:** `form-shell.ts` renders authored options only.
    - **Planned implementation move:** `question-model.ts` will append one synthetic `Other` row last for every multiple-choice question.

16. **Requirement:** `Agent-authored multiple_choice options shall not redundantly include the automatic Other option.`
    - **Status:** `needs implementation`
    - **Current:** Validator allows authored `optionId: "other"` today.
    - **Planned implementation move:** Reject authored multiple-choice options that use any reserved option ID: `yes`, `no`, or `other`.

17. **Requirement:** `Every yes_no question shall model yes and no using the reserved option IDs yes and no.`
    - **Status:** `needs implementation`
    - **Current:** `yes_no` is a distinct kind but has no explicit row model or answer shape using those IDs.
    - **Planned implementation move:** Store yes/no selection drafts and answered outcomes using exact option IDs `yes` and `no`.

18. **Requirement:** `A multiple_choice option may include optional description or subtext.`
    - **Status:** `needs implementation`
    - **Current:** `AuthorizedMultipleChoiceOption` contains only `optionId` and `label`.
    - **Planned implementation move:** Standardize on one optional field `description?: string` for task 02, validate it when present, and render it as muted subtext under the main option label.

19. **Requirement:** `When selectionMode is multi, the system shall allow the agent to recommend more than one option.`
    - **Status:** `needs implementation`
    - **Current:** No multiple-choice recommendation field exists.
    - **Planned implementation move:** Add `recommendedOptionIds: string[]` with validator rules:
      - `single` => exactly one recommended authored option ID
      - `multi` => one or more recommended authored option IDs.

20. **Requirement:** `The system shall not impose an artificial cap on the number of agent-provided multiple_choice options.`
    - **Status:** `already satisfied`
    - **Current:** No option-count cap exists in validator or UI.
    - **Planned implementation move:** Preserve unbounded authored options and do not introduce row count limits or pagination.

21. **Requirement:** `When the user selects Other, the form shall require non-empty otherText before submit.`
    - **Status:** `needs implementation`
    - **Current:** No `Other` row or `otherText` draft exists.
    - **Planned implementation move:** Add `otherText` to the editable multiple-choice draft and block final submit when `other` is selected but `otherText.trim()` is empty.

22. **Requirement:** `When the user selects Other, the payload shall send optionId: other plus separate otherText.`
    - **Status:** `needs implementation`
    - **Current:** No sanitized result type exists.
    - **Planned implementation move:** Split editable drafts from sanitized per-question outcomes so answered multiple-choice outcomes can include a selected `optionId: "other"` plus sibling `otherText`.

23. **Requirement:** `When the question is multi-select, the system shall allow Other alongside normal selected options.`
    - **Status:** `needs implementation`
    - **Current:** No interactive multi-select renderer exists.
    - **Planned implementation move:** Treat `other` like any other selectable row in `multi` mode while preserving separate `otherText` validation.

24. **Requirement:** `When the user selects Other, the system shall not allow a separate note on that option.`
    - **Status:** `needs implementation`
    - **Current:** No option-note system exists.
    - **Planned implementation move:** Mark the synthetic `Other` row as `noteAllowed: false` and ignore any accidental note draft for that row in outcome building.

25. **Requirement:** `The UI may allow note entry on any option row for ease of use.`
    - **Status:** `needs implementation`
    - **Current:** No option-note UI exists.
    - **Planned implementation move:** Allow note drafts on every non-`other` option row even when not currently selected.

26. **Requirement:** `When a multiple_choice answer is submitted, the payload shall include notes only for selected options.`
    - **Status:** `needs implementation`
    - **Current:** No sanitized outcome builder exists.
    - **Planned implementation move:** Sanitize option-note drafts into answered outcomes by filtering to selected option IDs only.

27. **Requirement:** `The system shall support per-question response states answered, needs_clarification, skipped, and open.`
    - **Status:** `needs implementation`
    - **Current:** No response-state model exists.
    - **Planned implementation move:** Use a split model:
      - editable draft stores `closureState: "open" | "skipped" | "needs_clarification"`
      - pure helper computes current public response state as:
        - `skipped` if `closureState === "skipped"`
        - `needs_clarification` if `closureState === "needs_clarification"`
        - `answered` if `closureState === "open"` and the answer draft is complete
        - otherwise `open`.

28. **Requirement:** `The system shall use the term note for all user-authored supplemental text.`
    - **Status:** `needs implementation`
    - **Current:** The shell has no supplemental-text terminology.
    - **Planned implementation move:** Use `note` consistently in field names, labels, and sanitized outcome types.

29. **Requirement:** `When a question is answered as multiple_choice, the system shall store notes per selected option.`
    - **Status:** `needs implementation`
    - **Current:** No note storage exists.
    - **Planned implementation move:** Keep per-option note drafts in editable state and emit only selected-option notes in answered outcomes.

30. **Requirement:** `When a question is answered as yes_no or freeform, the system shall store one answer-level note.`
    - **Status:** `needs implementation`
    - **Current:** No answer-level note fields exist.
    - **Planned implementation move:** Add a single answer-level `note` field to yes/no and freeform editable drafts and answered outcomes.

31. **Requirement:** `When a question is marked needs_clarification, the system shall store one question-level note.`
    - **Status:** `needs implementation`
    - **Current:** No question-level note field exists.
    - **Planned implementation move:** Add `questionNote` to editable drafts and use it as the required note for `needs_clarification` outcomes.

32. **Requirement:** `When a question is marked skipped, the system shall store one optional question-level note.`
    - **Status:** `needs implementation`
    - **Current:** No skipped-note field exists.
    - **Planned implementation move:** Reuse `questionNote` for `skipped` with no submit requirement.

33. **Requirement:** `When the user marks a question needs_clarification, the system shall require a note before allowing final submit.`
    - **Status:** `needs implementation`
    - **Current:** No final-submit validation exists.
    - **Planned implementation move:** Add pure submit validation that blocks only when a `needs_clarification` question has an empty trimmed `questionNote`.

34. **Requirement:** `When the user marks a question needs_clarification, the system shall treat that state as mutually exclusive with any answered state.`
    - **Status:** `needs implementation`
    - **Current:** No state-transition semantics exist.
    - **Planned implementation move:** Use singular `closureState`; when it becomes `needs_clarification`, the computed public state becomes `needs_clarification` even if the preserved answer draft is complete.

35. **Requirement:** `When the user marks a question needs_clarification, the system shall dim and lock answer controls while preserving prior drafts underneath.`
    - **Status:** `needs implementation`
    - **Current:** No answer controls or closure behavior exist.
    - **Planned implementation move:** While `closureState === "needs_clarification"`, lock all answer controls, keep the question-level `note` editor and `Reopen` action enabled, and preserve answer drafts unchanged.

36. **Requirement:** `When the user marks a question skipped, the system shall dim and lock answer controls while preserving prior drafts underneath.`
    - **Status:** `needs implementation`
    - **Current:** Same gap as above.
    - **Planned implementation move:** Apply the same closed-state rendering/locking behavior for `skipped`, with optional question note and enabled `Reopen`.

37. **Requirement:** `When the user skips a question, the system shall treat that question as closed until it is explicitly reopened.`
    - **Status:** `needs implementation`
    - **Current:** No reopen flow exists.
    - **Planned implementation move:** Closed-state controls expose `Reopen`; all answer-edit actions are no-ops until that action returns `closureState` to `open`.

38. **Requirement:** `When a user reopens a previously skipped or needs_clarification question and submits a normal answer, that latest answer shall become the question's current state.`
    - **Status:** `needs implementation`
    - **Current:** No reopen semantics exist.
    - **Planned implementation move:** `Reopen` changes only `closureState` back to `open`; if the preserved or newly edited answer draft is complete, the computed public state becomes `answered` again on the next render and in the built outcomes.

39. **Requirement:** `The system shall show prompt, recommendation, and justification by default for the active question.`
    - **Status:** `needs implementation`
    - **Current:** The current shell shows only `prompt`.
    - **Planned implementation move:** Render contract by kind:
      - `yes_no` / `multiple_choice`: recommendation appears inline on visible option rows; justification appears as its own visible block.
      - `freeform`: recommendation appears as the `Suggested answer` block; justification appears as its own visible block.

40. **Requirement:** `When a question has context, the system shall keep that context collapsed by default and shall allow the user to reveal it on demand.`
    - **Status:** `needs implementation`
    - **Current:** No context UI exists.
    - **Planned implementation move:** Default each tab’s context to collapsed shell-local UI state and expose a visible toggle row/action.

41. **Requirement:** `When the user is viewing a multi-select question, the system shall allow multiple options to be selected at once.`
    - **Status:** `needs implementation`
    - **Current:** No interactive choice renderer exists.
    - **Planned implementation move:** `form-state.ts` will keep a selected-option set for `multi` and replace-selection behavior for `single`.

### 4. Current Architecture Deep Dive

#### Relevant files and what role each one plays

- `extensions/question-runtime/types.ts`
  - Defines the minimal task-01 authored request schema.
  - Defines validation issue types and request-lifecycle store types.
  - Stops at `prompt`, `selectionMode`, and bare multiple-choice labels.

- `extensions/question-runtime/request-validator.ts`
  - Validates only the fields the current read-only shell needs.
  - Enforces required `questionId` / `kind` / `prompt`, `multiple_choice.selectionMode`, non-empty `options`, and duplicate IDs.
  - Ignores all task-02 presentation and answer-entry requirements.

- `extensions/question-runtime/form-shell.ts`
  - Flattens authored inline questions in pre-order.
  - Renders a tab strip and a read-only question body.
  - Has no reusable state model, no focus model, no editor flow, and no result type.

- `extensions/question-runtime/tool.ts`
  - Registers `question_runtime_request` and returns a minimal freeform template.
  - That template becomes invalid as soon as task-02 required fields land.

- `extensions/question-runtime/index.ts`
  - Orchestrates task-01 request lifecycle and already calls `await showQuestionRuntimeFormShell(...)`.
  - It does not need behavioral changes for task 02 if the shell starts returning a value that the caller ignores.

#### Existing runtime flow

1. `question_runtime_request` issues an authorized path.
2. `request-watcher.ts` notices edits on known request files.
3. `request-validator.ts` validates the current JSON.
4. `index.ts` either sends hidden repair feedback or queues the request as ready.
5. `index.ts` locks the request and opens `showQuestionRuntimeFormShell(...)`.
6. The shell currently closes on `Enter`, `Esc`, or `Ctrl+C` with no form result.

#### Current data/model shapes

- Authored request model today:
  - `questionId`
  - `kind`
  - `prompt`
  - `selectionMode`
  - `options[{ optionId, label }]`
  - optional inline `followUps`

- Missing model seams task 02 needs:
  - `context`
  - `justification`
  - recommendation data by kind
  - freeform `suggestedAnswer`
  - reserved IDs and synthetic `Other`
  - editable answer drafts
  - computed response states
  - sanitized per-question outcomes

#### Current UI/rendering flow

- Tabs are derived from pre-order flattening of the authored tree.
- The active tab renders title, request metadata, tab strip, prompt, kind label, path, and raw multiple-choice options.
- There is no row focus, no per-question state, no submit/review tab, and no shell-local UI state beyond the active tab index.

#### Reusable pieces that should be preserved

- Task-01 request lifecycle in `extensions/question-runtime/index.ts`.
- Stable pre-order flattening behavior, but moved into a reusable pure helper.
- Existing tab-oriented shell chrome in `form-shell.ts`.
- `extensions/shared/option-picker.ts` as a reference for the “custom TUI step -> open editor -> resume TUI” pattern.
- `extensions/qna.ts` as a reference for a review/submit tab and answer-status tab markers.

#### Friction, duplication, or missing seams

- `form-shell.ts` currently mixes flattening and rendering and provides no reusable helper layer.
- `yes_no` and `multiple_choice` need nearly the same row model, but no shared abstraction exists.
- The current planless path would encourage a bad `draft === outcome` shortcut; task 02 needs those separated.
- Context expansion is UI-only state and should not be mixed into reusable form-state.
- The repo has no dedicated automated test harness for this area, so validation must be explicit about manual coverage and `mise run check`.

### 5. Target Architecture

#### Proposed modules and responsibilities

- `extensions/question-runtime/types.ts`
  - Shared authored request schema.
  - Reserved option IDs.
  - Editable draft types.
  - Sanitized per-question outcome/result types.
  - Existing task-01 request-lifecycle types remain here.

- `extensions/question-runtime/question-model.ts` **(new)**
  - Pure helpers that flatten authored questions and derive renderable choice rows.
  - Owns synthetic yes/no rows and the automatic `Other` row.

- `extensions/question-runtime/request-validator.ts`
  - Deterministic validation for the task-02 authored schema only.
  - No draft validation, no active-graph validation, and no submission-payload validation.

- `extensions/question-runtime/form-state.ts` **(new)**
  - Pure editable-draft state helpers.
  - Computed response-state helpers.
  - Submit blockers.
  - Sanitized outcome builder.

- `extensions/question-runtime/form-shell.ts`
  - TUI renderer and shell-local UI state only.
  - Active tab, row focus, context expansion, editor routing, and review tab.
  - Calls pure helpers for all business rules.

- `extensions/question-runtime/tool.ts`
  - Returns a schema-valid starter template under the richer authored contract.

#### Authored schema contract to lock for task 02

```ts
type QuestionKind = "yes_no" | "multiple_choice" | "freeform";

interface AuthorizedQuestionBase {
  questionId: string;
  prompt: string;
  context?: string;
  justification: string;
  followUps?: AuthorizedQuestionNode[];
}

interface AuthorizedYesNoQuestion extends AuthorizedQuestionBase {
  kind: "yes_no";
  recommendedOptionId: "yes" | "no";
}

interface AuthorizedFreeformQuestion extends AuthorizedQuestionBase {
  kind: "freeform";
  suggestedAnswer: string;
}

interface AuthorizedMultipleChoiceOption {
  optionId: string;
  label: string;
  description?: string;
}

interface AuthorizedMultipleChoiceQuestion extends AuthorizedQuestionBase {
  kind: "multiple_choice";
  selectionMode: "single" | "multi";
  options: AuthorizedMultipleChoiceOption[];
  recommendedOptionIds: string[];
}
```

Rules locked by this plan:

- `description` is the one secondary-text field name for task 02.
- `freeform` recommendation data is exactly `suggestedAnswer`; no additional generic recommendation field.
- `recommendedOptionIds` may reference authored options only and may not include synthetic `other`.
- `single` multiple-choice requires exactly one recommended authored option ID.
- `multi` multiple-choice requires one or more recommended authored option IDs.

#### Editable draft model vs sanitized outcome model

```ts
type QuestionClosureState = "open" | "skipped" | "needs_clarification";
type QuestionResponseState = "answered" | "needs_clarification" | "skipped" | "open";

interface YesNoAnswerDraft {
  kind: "yes_no";
  selectedOptionId: "yes" | "no" | null;
  note: string;
}

interface MultipleChoiceAnswerDraft {
  kind: "multiple_choice";
  selectedOptionIds: string[];
  otherText: string;
  optionNoteDrafts: Record<string, string>;
}

interface FreeformAnswerDraft {
  kind: "freeform";
  text: string;
  note: string;
}

type QuestionAnswerDraft = YesNoAnswerDraft | MultipleChoiceAnswerDraft | FreeformAnswerDraft;

interface QuestionRuntimeQuestionDraft {
  questionId: string;
  closureState: QuestionClosureState;
  answerDraft: QuestionAnswerDraft;
  questionNote: string;
}

type QuestionRuntimeQuestionOutcome =
  | { questionId: string; state: "open" }
  | { questionId: string; state: "skipped"; note?: string }
  | { questionId: string; state: "needs_clarification"; note: string }
  | {
      questionId: string;
      state: "answered";
      answer:
        | { kind: "yes_no"; optionId: "yes" | "no"; note?: string }
        | {
            kind: "multiple_choice";
            selections: Array<{ optionId: string; note?: string }>;
            otherText?: string;
          }
        | { kind: "freeform"; text: string; note?: string };
    };

interface QuestionRuntimeFormResult {
  action: "submit" | "cancel";
  draftSnapshot: QuestionRuntimeQuestionDraft[];
  outcomes: QuestionRuntimeQuestionOutcome[];
}
```

#### Response-state semantics and transition table

Computed public state:

```ts
if (draft.closureState === "skipped") return "skipped";
if (draft.closureState === "needs_clarification") return "needs_clarification";
if (isAnswerDraftComplete(question, draft.answerDraft)) return "answered";
return "open";
```

Transition rules:

| User action | Editable draft change | Computed state after change |
| --- | --- | --- |
| Initial render | `closureState = "open"`, empty answer draft | `open` |
| Edit answer while open | mutate `answerDraft` only | `open` until complete, then `answered` |
| Edit answer note while open | mutate answer-level note only | unchanged computed state |
| Select/deselect `Other` | mutate `selectedOptionIds` only, preserve `otherText` draft | `answered` only when all required answer parts are complete |
| Mark `skipped` | `closureState = "skipped"`, preserve answer draft | `skipped` |
| Mark `needs_clarification` | `closureState = "needs_clarification"`, preserve answer draft | `needs_clarification` |
| Edit question note while closed | mutate `questionNote` only | remains closed |
| Reopen | `closureState = "open"`, preserve `answerDraft` and `questionNote` | `answered` if preserved answer draft is complete, else `open` |

Closed-state control rules:

- `open`: answer controls, answer-note controls, `Skip`, and `Needs clarification` are enabled.
- `skipped` / `needs_clarification`: answer controls are dimmed and disabled; question-level `note` editor and `Reopen` remain enabled.
- Deselecting an option or `Other` does not clear its note/text draft; those drafts are preserved and sanitized only when outcomes are built.

#### TUI interaction contract

Question tabs:

- `Tab` / `Shift+Tab` and `←` / `→` switch between question tabs and the final review tab.
- `↑` / `↓` move focus within the active tab.
- `Space` toggles the focused choice row for `yes_no` and `multiple_choice`.
- `Enter` activates the focused row:
  - choice row -> same behavior as `Space`
  - `Context` row -> toggle collapsed/expanded
  - `Answer`, `Other text`, or `note` row -> open `ctx.ui.editor(...)`
  - `Skip`, `Needs clarification`, or `Reopen` row -> apply that state change
  - review-tab blocker row -> jump to that question tab
  - review-tab submit row -> attempt final submit
- `Esc` / `Ctrl+C` close the form with `action: "cancel"` and return the current `draftSnapshot` plus computed outcomes.

Review tab:

- Shows counts by computed state.
- Shows submit blockers from pure validation.
- Exposes one focusable `Submit form` row.
- Exposes one focusable row per blocker/question summary to jump back for repair.

Rendering contract:

- `yes_no` / `multiple_choice`: recommendation is shown inline on option rows only; do not duplicate it in a separate recommendation panel.
- `freeform`: recommendation is shown as the `Suggested answer` block.
- `justification` is always shown as its own visible block.
- `context`, when present, is shown collapsed by default behind a visible toggle row.

#### Data flow from command entry to final result

```text
question_runtime_request
          |
          v
  request-validator.ts
          |
          v
AuthorizedQuestionRequest
      /           \
     v             v
question-model   form-state
 (rows/order)   (drafts/outcomes)
      \           /
       v         v
        form-shell.ts
           |
           v
QuestionRuntimeFormResult
           |
           v
  returned to existing launcher
  with no task-02 persistence/emission
```

### 6. File-by-File Implementation Plan

#### 6.1 Files to modify or add

- `Path:` `extensions/question-runtime/types.ts`
  - `Action:` `modify`
  - `Why:` Task-01 types stop before recommendation, justification, reserved IDs, editable drafts, and sanitized outcomes.
  - `Responsibilities:`
    - Expand the authored request schema.
    - Export reserved option IDs.
    - Export editable draft types and sanitized outcome/result types.
    - Preserve task-01 request-lifecycle types.
  - `Planned exports / signatures:`

    ```ts
    export const RESERVED_OPTION_IDS = ["yes", "no", "other"] as const;
    export type ReservedOptionId = (typeof RESERVED_OPTION_IDS)[number];
    export type QuestionClosureState = "open" | "skipped" | "needs_clarification";
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

    export interface QuestionRuntimeQuestionDraft {
      questionId: string;
      closureState: QuestionClosureState;
      answerDraft: QuestionAnswerDraft;
      questionNote: string;
    }

    export type QuestionRuntimeQuestionOutcome = ...;

    export interface QuestionRuntimeFormResult {
      action: "submit" | "cancel";
      draftSnapshot: QuestionRuntimeQuestionDraft[];
      outcomes: QuestionRuntimeQuestionOutcome[];
    }
    ```

  - `Key logic to add or change:`
    - Extend `ValidationIssueCode` with only the extra deterministic codes task 02 needs, such as `invalid_reference`, `reserved_identifier`, and `duplicate_array_value`.
    - Keep request-store snapshot types untouched.
  - `Dependencies:` none
  - `Risks / notes:` Do not let shell-only view state leak into these shared types.

- `Path:` `extensions/question-runtime/question-model.ts`
  - `Action:` `add`
  - `Why:` Choice-row derivation and question flattening should not stay buried in the TUI renderer.
  - `Responsibilities:`
    - Flatten authored inline questions in stable pre-order.
    - Build shared renderable choice rows for `yes_no` and `multiple_choice`.
    - Append the automatic `Other` row last.
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
    - `yes_no` always returns exactly two rows with `optionId: "yes"` and `optionId: "no"`.
    - `multiple_choice` returns authored rows plus one synthetic `Other` row with `noteAllowed: false`.
    - Recommendation flags are precomputed here so the shell only renders them.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:` Keep this strictly static-question oriented; no task-03 graph activation logic.

- `Path:` `extensions/question-runtime/request-validator.ts`
  - `Action:` `modify`
  - `Why:` The validator must enforce the richer authored schema before the UI opens.
  - `Responsibilities:`
    - Validate `context`, `justification`, recommendation fields, `suggestedAnswer`, and `description`.
    - Reject reserved authored option IDs.
    - Validate recommendation references and cardinality.
    - Keep unknown-field tolerance and deterministic issue ordering.
  - `Planned exports / signatures:`

    ```ts
    export function validateAuthorizedQuestionRequest(text: string): RequestValidationResult;
    ```

  - `Key logic to add or change:`
    - Require `justification` for every question.
    - Validate `context` and `description` as non-empty strings when present.
    - `yes_no` requires `recommendedOptionId` and only accepts `yes` or `no`.
    - `freeform` requires `suggestedAnswer`.
    - `multiple_choice` requires `recommendedOptionIds` with exact cardinality rules from section 5.
    - Reject authored `optionId` values `yes`, `no`, and `other`.
    - Reject recommendation references to missing or synthetic options.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:`
    - Do not reject unknown extra fields.
    - Do not change task-01 parse/top-level-object error behavior.

- `Path:` `extensions/question-runtime/form-state.ts`
  - `Action:` `add`
  - `Why:` The shell needs a pure draft/state/outcome layer that task 03 can later reuse.
  - `Responsibilities:`
    - Create initial editable drafts.
    - Update answer drafts.
    - Compute public response state.
    - Validate final-submit blockers.
    - Build sanitized per-question outcomes and the overall form result.
  - `Planned exports / signatures:`

    ```ts
    export type FormValidationIssueCode =
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
    }

    export function createQuestionRuntimeFormState(
      flattenedQuestions: FlattenedQuestion[],
    ): QuestionRuntimeFormState;

    export function getQuestionDraft(
      state: QuestionRuntimeFormState,
      questionId: string,
    ): QuestionRuntimeQuestionDraft;

    export function isAnswerDraftComplete(
      question: AuthorizedQuestionNode,
      draft: QuestionRuntimeQuestionDraft,
    ): boolean;

    export function getQuestionResponseState(
      question: AuthorizedQuestionNode,
      draft: QuestionRuntimeQuestionDraft,
    ): QuestionResponseState;

    export function setClosureState(
      state: QuestionRuntimeFormState,
      questionId: string,
      closureState: QuestionClosureState,
    ): void;

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

    export function buildQuestionOutcome(
      question: AuthorizedQuestionNode,
      draft: QuestionRuntimeQuestionDraft,
    ): QuestionRuntimeQuestionOutcome;

    export function validateFormForSubmit(
      flattenedQuestions: FlattenedQuestion[],
      state: QuestionRuntimeFormState,
    ): FormValidationIssue[];

    export function buildQuestionRuntimeFormResult(
      flattenedQuestions: FlattenedQuestion[],
      state: QuestionRuntimeFormState,
      action: "submit" | "cancel",
    ): QuestionRuntimeFormResult;
    ```

  - `Key logic to add or change:`
    - Preserve `otherText`, deselected option notes, and closed-state `questionNote` drafts until sanitization time.
    - `validateFormForSubmit()` blocks only on missing `otherText` for selected `other` and missing note for `needs_clarification`.
    - `buildQuestionOutcome()` filters multiple-choice option notes down to selected options only.
  - `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-model.ts`
  - `Risks / notes:` Keep this module pure; no UI focus, no tab state, no editor state.

- `Path:` `extensions/question-runtime/form-shell.ts`
  - `Action:` `modify`
  - `Why:` Task 02 lives here: the current file is only a read-only shell.
  - `Responsibilities:`
    - Render question tabs plus one final review tab.
    - Maintain shell-local UI state: active tab, focused row, and context expansion.
    - Render kind-specific bodies using pure helpers.
    - Route text/note editing through `ctx.ui.editor(...)`.
    - Return a full `QuestionRuntimeFormResult` on submit or cancel.
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
    - Replace inline flattening with `question-model.ts`.
    - Add shell-local focus state keyed by question ID, not shared form-state.
    - Add tab markers based on computed response state.
    - Use one shared choice renderer for `yes_no` and `multiple_choice`.
    - Use one freeform renderer with read-only `Suggested answer`, editable `Answer`, and answer-level `note`.
    - In closed states, dim answer rows and leave only question-level `note` plus `Reopen` active.
    - Add review-tab counts, blockers, jump-back rows, and a submit action.
  - `Dependencies:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/question-model.ts`, `extensions/question-runtime/form-state.ts`
  - `Risks / notes:`
    - Keep recommendation rendering non-duplicated.
    - Keep the keyboard model exactly as described in section 5.

- `Path:` `extensions/question-runtime/tool.ts`
  - `Action:` `modify`
  - `Why:` The starter template must remain valid after the schema gets richer.
  - `Responsibilities:`
    - Keep request issuance unchanged.
    - Return a minimal valid task-02 template.
  - `Planned exports / signatures:`

    ```ts
    export function registerQuestionRuntimeRequestTool(
      pi: ExtensionAPI,
      store: QuestionRuntimeRequestStore,
      onRequestCreated: () => void,
    ): void;
    ```

  - `Key logic to add or change:`
    - Update `buildTemplate()` to include `justification` and `suggestedAnswer` for a minimal valid freeform example.
  - `Dependencies:` `extensions/question-runtime/types.ts`
  - `Risks / notes:` Do not change request ID sequencing, path issuance, or tool response field names.

#### 6.2 Read-only reference context

- `extensions/question-runtime/index.ts`
  - Launch orchestration reference only; no task-02 behavior change planned.

- `extensions/shared/option-picker.ts`
  - Reference for the editor-resume loop pattern.

- `extensions/qna.ts`
  - Reference for a review/submit tab and tab status markers.

- `extensions/question-runtime/request-store.ts`, `request-watcher.ts`, `repair-messages.ts`
  - Request-lifecycle context only.

- `No automated test file additions planned in this task.`
  - The repo has no dedicated runtime test harness for this area today.
  - Validation is manual plus `mise run check` after the TypeScript edits.

### 7. File Fingerprints

- `Path:` `extensions/question-runtime/types.ts`
  - `Reason this file changes:` Add task-02 authored fields, reserved IDs, editable draft types, and sanitized outcome/result types.
  - `Existing anchors to search for:` `export type QuestionKind = "yes_no" | "multiple_choice" | "freeform";`, `export interface AuthorizedQuestionBase {`, `export interface AuthorizedMultipleChoiceOption {`, `export type ValidationIssueCode =`
  - `New anchors expected after implementation:` `export const RESERVED_OPTION_IDS =`, `export type QuestionClosureState =`, `export type QuestionRuntimeQuestionOutcome =`, `export interface QuestionRuntimeFormResult {`
  - `Unsafe areas to avoid touching:` `QUESTION_RUNTIME_STATE_ENTRY`, `RuntimeRequestRecord`, and request-store snapshot types

- `Path:` `extensions/question-runtime/question-model.ts`
  - `Reason this file changes:` New pure helper layer for flattening and renderable choice rows.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function flattenQuestionsPreOrder(`, `export function buildChoiceQuestionModel(`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/question-runtime/request-validator.ts`
  - `Reason this file changes:` Enforce task-02 authored schema, reserved-ID rules, and recommendation references.
  - `Existing anchors to search for:` `const FORBIDDEN_PRODUCT_FIELDS = new Set([`, `function validateQuestionNode(`, `function appendDuplicateOptionIssues(`, `export function validateAuthorizedQuestionRequest(`
  - `New anchors expected after implementation:` `function validateRecommendedOptionId(`, `function validateRecommendedOptionIds(`, `invalid_reference`, `reserved_identifier`
  - `Unsafe areas to avoid touching:` parse-error handling at `$`, top-level object validation, unknown-field tolerance, and existing forbidden product-field checks

- `Path:` `extensions/question-runtime/form-state.ts`
  - `Reason this file changes:` New pure draft/state/outcome layer for the interactive form.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function isAnswerDraftComplete(`, `export function getQuestionResponseState(`, `export function buildQuestionOutcome(`, `export function buildQuestionRuntimeFormResult(`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/question-runtime/form-shell.ts`
  - `Reason this file changes:` Replace the read-only shell body with the full interactive static-question form.
  - `Existing anchors to search for:` `interface FlattenedQuestion {`, `function flattenQuestions(`, `function renderMultipleChoiceLines(`, `export async function showQuestionRuntimeFormShell(`
  - `New anchors expected after implementation:` `function renderReviewTab(`, `function renderChoiceQuestion(`, `function buildFocusableRows(`, `Promise<QuestionRuntimeFormResult>`
  - `Unsafe areas to avoid touching:` request metadata display and the tab-oriented layout contract

- `Path:` `extensions/question-runtime/tool.ts`
  - `Reason this file changes:` Keep the emitted starter template valid under the richer task-02 schema.
  - `Existing anchors to search for:` `function buildTemplate(): Record<string, unknown> {`, `question_runtime_request`, `template,`
  - `New anchors expected after implementation:` `justification:`, `suggestedAnswer:`
  - `Unsafe areas to avoid touching:` request ID generation, path building, and the `details.requestId/path/projectRelativePath` response contract

### 8. Stepwise Execution Plan

1. Expand `extensions/question-runtime/types.ts` with the locked task-02 authored schema, reserved IDs, draft types, and sanitized outcome/result types.
2. Add `extensions/question-runtime/question-model.ts` for flattening and shared choice-row derivation.
3. Update `extensions/question-runtime/request-validator.ts` to enforce the richer authored schema using the deterministic order in section 9.
4. Add `extensions/question-runtime/form-state.ts` with draft initialization, computed-state helpers, submit blockers, and sanitized outcome building.
5. Rewrite `extensions/question-runtime/form-shell.ts` to use `question-model.ts` and `form-state.ts`, following the exact keyboard/control model in section 5.
6. Update `extensions/question-runtime/tool.ts` so the starter template stays valid.
7. Reload the extension because files under `extensions/question-runtime/` changed.
8. Run the mixed-question manual fixture from section 9 through the authorized-path flow.
9. Run `mise run check` after all TypeScript edits.

Parallel notes:

- Steps 1-2 should land first because validator and form-state depend on them.
- Steps 3 and 4 can proceed in parallel once step 1 is fixed.
- Step 6 can proceed in parallel with step 5 after the schema contract is fixed.
- Steps 7-9 are sequential verification work.

Checkpoints:

- After step 3: confirm the richer validator still accepts the updated starter template.
- After step 5: confirm the shell can drive all question kinds and closed-state transitions before doing end-to-end request verification.
- After step 8: confirm the task-01 launch/lock behavior still works without changing lifecycle files.

### 9. Validation Plan

#### Deterministic validator walk order

Task-02 validator checks must run in this fixed order:

1. Parse JSON text.
2. Validate top-level object.
3. Validate `questions` presence, type, and non-empty array.
4. Walk questions in stable pre-order and validate fields in this order:
   - forbidden product fields
   - `questionId`
   - `kind`
   - `prompt`
   - `context`
   - `justification`
   - kind-specific fields:
     - `yes_no`: `recommendedOptionId`
     - `freeform`: `suggestedAnswer`
     - `multiple_choice`:
       - `selectionMode`
       - `options`
       - each option `optionId`
       - each option `label`
       - each option `description`
       - `recommendedOptionIds`
   - `followUps`
5. After the structural walk, run duplicate checks in discovery order:
   - duplicate `questionId`
   - duplicate authored `optionId` within each multiple-choice question
   - duplicate values inside `recommendedOptionIds`
6. After duplicate checks, run recommendation reference validation in question discovery order.

#### Pure-helper verification

- `request-validator.ts`
  - valid freeform question requires `justification` and `suggestedAnswer`
  - valid yes/no question requires `recommendedOptionId: "yes" | "no"`
  - valid single-select multiple-choice requires exactly one `recommendedOptionIds` entry
  - valid multi-select multiple-choice allows more than one `recommendedOptionIds` entry
  - authored multiple-choice `optionId: "yes" | "no" | "other"` is rejected
  - `recommendedOptionIds` cannot reference missing options or synthetic `other`
  - optional `context` and `description` reject empty strings when present
  - unknown extra fields still pass when known fields are valid

- `form-state.ts`
  - initial computed state is `open` for all questions
  - a complete open answer draft computes to `answered`
  - `setClosureState(..., "skipped")` preserves answer drafts and computes `skipped`
  - `setClosureState(..., "needs_clarification")` preserves answer drafts and computes `needs_clarification`
  - reopening computes back to `answered` if the preserved draft is complete, else `open`
  - `otherText` and deselected option-note drafts are preserved until sanitization
  - submit validation blocks missing `otherText` for selected `other`
  - submit validation blocks missing note for `needs_clarification`
  - sanitized multiple-choice outcomes include notes only for selected options

#### Mixed-question manual fixture

Use one authorized request with at least this shape:

```json
{
  "questions": [
    {
      "questionId": "q_confirm_repo",
      "kind": "yes_no",
      "prompt": "Should the runtime preserve answer drafts when a question is skipped?",
      "justification": "Later reopening must restore earlier work.",
      "recommendedOptionId": "yes",
      "context": "Task 02 requires closed questions to preserve prior drafts underneath."
    },
    {
      "questionId": "q_single_pick",
      "kind": "multiple_choice",
      "prompt": "Which note-editing interaction should the static form use?",
      "justification": "The shell needs one consistent editor path for answer and note fields.",
      "selectionMode": "single",
      "recommendedOptionIds": ["editor_modal"],
      "options": [
        {
          "optionId": "inline_input",
          "label": "Inline input row",
          "description": "Fast to type, but adds more in-shell cursor complexity."
        },
        {
          "optionId": "editor_modal",
          "label": "Open the editor modal",
          "description": "Matches existing extension patterns for longer text."
        }
      ]
    },
    {
      "questionId": "q_multi_pick",
      "kind": "multiple_choice",
      "prompt": "Which behaviors should the multi-select implementation preserve?",
      "justification": "The form should preserve drafts and allow richer notes without forcing product-specific paths.",
      "selectionMode": "multi",
      "recommendedOptionIds": ["preserve_other_text", "preserve_option_notes"],
      "options": [
        {
          "optionId": "preserve_other_text",
          "label": "Preserve Other text after deselect",
          "description": "Re-selecting Other should restore the prior draft."
        },
        {
          "optionId": "preserve_option_notes",
          "label": "Preserve deselected option notes",
          "description": "Sanitize them out only when building outcomes."
        }
      ]
    },
    {
      "questionId": "q_freeform",
      "kind": "freeform",
      "prompt": "Describe the cleanest split between draft state and submitted outcomes.",
      "justification": "Task 03 will need reusable draft state without re-deriving payload semantics from UI internals.",
      "suggestedAnswer": "Keep editable drafts separate from sanitized per-question outcomes and compute public response state from draft completeness plus explicit closed-state flags."
    }
  ]
}
```

#### Manual verification checklist

1. Open the valid request and confirm the form still launches through the unchanged task-01 request pipeline.
2. Confirm prompt, recommendation, and justification render by default for the active question, with no duplicated recommendation panel on choice questions.
3. Confirm context starts collapsed and can be toggled open and closed.
4. Confirm yes/no renders only `yes` and `no`, with the recommended side marked inline.
5. Confirm multiple-choice appends `Other` automatically and always renders it last.
6. Confirm single-select replaces the prior selection.
7. Confirm multi-select allows several authored options plus `Other` together.
8. Confirm `Other` opens its own editor path, preserves typed text after deselect/reselect, and blocks submit when selected but empty.
9. Confirm non-`other` option notes can be edited regardless of current selection and are preserved across deselect/reselect.
10. Confirm freeform shows a read-only `Suggested answer` block above editable user input.
11. Confirm marking `skipped` or `needs_clarification` dims and locks answer controls while leaving question-level note and `Reopen` active.
12. Confirm reopening restores the preserved answer draft and recomputes to `answered` when the preserved draft is already complete.
13. Confirm open but untouched questions do not block submit.
14. Confirm `needs_clarification` blocks submit until a note is entered.
15. Confirm the returned result on cancel includes preserved drafts and computed outcomes, even though task 02 does not yet persist or emit them.

#### Expected user-visible behavior

- Users can switch tabs, select answers, edit answer text and notes, mark questions skipped or needing clarification, reopen them, and see prior drafts restored.
- Choice recommendations appear inline on rows; freeform recommendation appears as `Suggested answer`; justification is always visible.
- The review tab shows what is answered vs still open and only blocks submit for `Other` text or missing clarification notes.

#### Failure modes to test

- authored multiple-choice option uses a reserved ID
- single-select has zero or multiple recommended IDs
- multi-select recommendation references a missing option
- `recommendedOptionIds` includes synthetic `other`
- selected `Other` has blank `otherText`
- `needs_clarification` has blank note
- answer controls remain editable while closed
- reopening does not restore preserved drafts

#### Repo checks

- Reload the extension before interactive verification because files under `extensions/question-runtime/` changed.
- Run `mise run check` after the TypeScript work is complete.

### 10. Open Questions / Assumptions

- `None.`
