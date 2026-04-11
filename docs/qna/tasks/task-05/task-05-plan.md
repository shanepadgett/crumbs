### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-05/task-05.md`
- `Task Title:` `Task 05 — /qna loop control, scoped tool activation, and no-results behavior`
- `Task Signature:` `task-05-qna-loop-control-scoped-tool-activation-no-results-behavior`
- `Primary Code Scope:` `extensions/qna.ts`, `extensions/qna/command.ts`, `extensions/qna/types.ts`, `extensions/qna/branch-state.ts`, `extensions/qna/reconcile.ts`, `extensions/qna/transcript-scan.ts`, `extensions/qna/model-reconcile.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/loop-control-message.ts`, `extensions/qna/runtime-submit.ts`, `extensions/qna/tool.ts`, `extensions/qna/interview-attachment.ts`, `extensions/qna/*.test.ts`, `extensions/question-runtime/types.ts`, `extensions/question-runtime/form-state.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/request-validator.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, `README.md`, `/qna-ledger` overlay and send/export work from task-06+, and net-new interview persistence/chooser/active-runtime implementation beyond reading the shared chat-attachment marker contract`

### 2. Executive Summary

This task turns `/qna` from a discovery-only command into the full manual ordinary-QnA loop. The command should still run the task-04 transcript reconciliation pass first, but it must then merge that refreshed ledger with any older still-open backlog, decide whether there is anything unresolved to review, and either start a scoped agent loop or exit cleanly with a no-results notification.

The clean architecture is to keep task-04’s branch-local ledger pipeline intact, then layer four narrow seams on top of it: an ephemeral loop controller for scoped tool activation and cleanup, a typed hidden loop-control message protocol for kickoff/filtering, an agent-facing `qna` tool that accepts product-level `questionIds` and compiles runtime requests internally, and a pure submit-result applier that translates `question_outcomes` or `no_user_response` into authoritative ledger transitions plus draft persistence. That keeps runtime rendering shared, storage product-owned, and loop orchestration reusable for task-06 reactivation without pulling `/qna` back into one monolithic file.

### 3. Requirement Map

1. **Requirement:** `/qna` shall be user initiated.
   - `Status:` `already satisfied`
   - `Current files/functions/types that relate:` `extensions/qna/command.ts:registerQnaCommand`, `extensions/qna.ts`
   - `Planned implementation move:` Preserve the command entrypoint as the only public trigger for the manual ordinary-QnA loop; do not auto-start `/qna` loops from session lifecycle hooks.

2. **Requirement:** `/qna` shall run in smart merged mode without a mode picker.
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/qna/command.ts:runQnaCommand` already has no picker, but it exits after the discovery pass and does not merge that pass with older open backlog for review.
   - `Planned implementation move:` Change command orchestration so one `/qna` run always does both phases in one flow: reconcile new transcript if needed, then evaluate the full current open ledger set and either start the loop or no-op with a notification.

3. **Requirement:** When the user starts `/qna`, the system shall activate the agent-facing `qna` tool only for the current QnA loop.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` registers no tool; current `/qna` never changes active tools.
   - `Planned implementation move:` Add an in-memory `QnaLoopController` that temporarily adds `qna` to the active tool set, hides the low-level runtime tool for the loop, and restores tool visibility when the loop settles or the session context resets. The controller must also enforce the baseline invariant that `qna` is removed whenever no loop is active (startup/reload/tree/switch/shutdown).

4. **Requirement:** The agent-facing `qna` tool shall remain distinct from the low-level shared question-runtime request tool and shall use that runtime only when structured forms are needed.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/question-runtime/tool.ts:registerQuestionRuntimeRequestTool`, `extensions/question-runtime/form-shell.ts:showQuestionRuntimeFormShell`, `extensions/question-runtime/request-validator.ts:validateAuthorizedQuestionRequest`
   - `Planned implementation move:` Add a product-owned `extensions/qna/tool.ts` that accepts only product-level batch input (`questionIds` + completion action), validates IDs against currently open ledger records, then compiles an internal `AuthorizedQuestionRequest` and launches the shared form shell without exposing low-level request-ticket workflow or runtime authoring schema to the model.

5. **Requirement:** While the agent-facing `qna` tool is active for `/qna`, the system shall still allow the agent to ask ordinary clarifying questions in chat when structured capture is unnecessary.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no existing `/qna` loop or per-turn prompt injection exists.
   - `Planned implementation move:` Use `before_agent_start` loop-context instructions that explicitly allow normal chat turns and only reserve the `qna` tool for structured review or explicit loop completion. Chat-only turns must keep the loop active until an explicit settle condition is reached.

6. **Requirement:** When the current `/qna` loop settles, the system shall deactivate the agent-facing `qna` tool.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no loop state or cleanup hooks exist in `extensions/qna.ts`.
   - `Planned implementation move:` Have the loop controller mark the loop inactive immediately when settled, then restore the pre-loop tool visibility diff on `agent_end` plus `session_start`, `session_tree`, and `session_shutdown` cleanup paths.

7. **Requirement:** When the current chat is attached to an interview session, the system shall block `/qna` and direct the user back to the interview instead of mixing the two systems in one chat.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` there is no interview command/runtime under `extensions/` on this branch, but task-07/08 specs define chat-attachment ownership.
   - `Planned implementation move:` Implement a concrete read-only attachment adapter in `extensions/qna/interview-attachment.ts` that reads the latest hidden branch marker entry `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`. `runQnaCommand()` must block and notify when this adapter returns a non-null session id.

8. **Requirement:** `/qna` shall consume the shared runtime’s structured submit result (`question_outcomes` or `no_user_response`) rather than parsing freeform text.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/question-runtime/types.ts:QuestionRuntimeStructuredSubmitResult`, `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult`, `extensions/qna/branch-state.ts` only hydrates `draftSnapshot` side data today.
   - `Planned implementation move:` Add a pure QnA submit-result applier that takes `QuestionRuntimeStructuredSubmitResult` plus `draftSnapshot` and updates the authoritative branch-local ledger directly.

9. **Requirement:** When `/qna` applies structured submit results, the affected ordinary QnA records shall adopt authoritative ledger states `answered`, `skipped`, or `needs_clarification` without reparsing freeform text.
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/types.ts:QnaLedgerQuestionRecord`, `extensions/qna/reconcile.ts` only handles transcript-model actions like `answered_in_chat` or `replace`.
   - `Planned implementation move:` Introduce `applyQnaStructuredSubmitResult(...)` to transition matching open records into `answered`, `skipped`, or `needs_clarification`, store the exact submitted outcome payload, and bump `sendState.localRevision` only for records whose authoritative state changed.

10. **Requirement:** When a shared runtime form closes or cancels during `/qna`, the system shall preserve the returned `draftSnapshot` in branch-local state without treating it as a send.
    - `Status:` `partially satisfied`
    - `Current files/functions/types that relate:` `extensions/qna/branch-state.ts:hydrateFromBranch` can already merge later `question-runtime.control` `draftSnapshot` updates, but `/qna` itself never launches the form shell or persists cancel results directly.
    - `Planned implementation move:` Reuse the shared runtime form shell from the `qna` tool, persist returned `draftSnapshot` immediately into `runtimeDraftsByQuestionId`, and leave send metadata untouched on cancel-only or draft-only paths.

11. **Requirement:** When a visible ordinary QnA question is left untouched on submit, the system shall keep that question `open` in the branch-local ledger.
    - `Status:` `needs implementation`
    - `Current files/functions/types that relate:` `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult` intentionally omits `open` outcomes; `/qna` has no applier for those omitted questions today.
    - `Planned implementation move:` The submit applier should only close records mentioned in `submitResult.outcomes`; scoped form questions that are absent from the outcomes array remain `state: "open"` with updated drafts preserved.

12. **Requirement:** When the form is submitted with no explicit outcomes in manual `/qna`, the system shall persist ledger state and notify the user without fabricating an agent response.
    - `Status:` `needs implementation`
    - `Current files/functions/types that relate:` `extensions/question-runtime/form-state.ts:buildStructuredSubmitResult` already produces `kind: "no_user_response"`; `/qna` never consumes that result.
    - `Planned implementation move:` Treat `no_user_response` as a product-owned terminal path in the `qna` tool: persist the latest drafts, show a user notification, mark the current loop settled, and return a fixed structured tool result (`kind: "no_user_response_settled"`) with no synthesized answer narrative.

13. **Requirement:** When the agent signals completion for the current `/qna` loop, the system shall be allowed to end that loop even if older open ordinary QnA items remain in the ledger.
    - `Status:` `needs implementation`
    - `Current files/functions/types that relate:` no loop-completion tool action exists.
    - `Planned implementation move:` Add a `qna` tool completion action that only settles the ephemeral loop controller and never mutates authoritative ledger records, so older open backlog remains durable for later work.

14. **Requirement:** When a `/qna` loop ends while older open ordinary QnA items remain, the system shall leave those items for future `/qna` or `/qna-ledger` work.
    - `Status:` `needs implementation`
    - `Current files/functions/types that relate:` `extensions/qna/types.ts` already supports durable `state: "open"` records, but the command has no loop lifecycle yet.
    - `Planned implementation move:` Keep loop completion purely ephemeral: no pruning, no auto-close, and no scan-boundary rollback. The authoritative state simply stays persisted with those older records still open.

15. **Requirement:** When `/qna` finds no unresolved ordinary QnA questions, the system shall not open an empty review popup.
    - `Status:` `partially satisfied`
    - `Current files/functions/types that relate:` current `/qna` never opens any review popup, but once task-05 adds the loop and form-launch path this gate must become explicit.
    - `Planned implementation move:` After every successful discovery pass or no-op boundary update, compute `getUnresolvedQnaQuestions(nextState)` before loop activation; if the set is empty, stop there and notify instead of starting the agent loop or allowing the tool to render an empty shared-runtime form.

16. **Requirement:** When `/qna` finds no unresolved ordinary QnA questions, the system shall record the successful scan boundary update and show a notification.
    - `Status:` `partially satisfied`
    - `Current files/functions/types that relate:` `extensions/qna/command.ts` already advances the boundary and notifies on transcript no-op success, but it does not yet handle the broader “reconciled to zero open questions” case.
    - `Planned implementation move:` Preserve task-04 boundary semantics, then add a dedicated no-unresolved notification path that runs after both incremental reconciliation and pure no-op runs.

### 4. Current Architecture Deep Dive

#### Relevant files and roles

- `extensions/qna.ts`
  - Thin extension entrypoint.
  - Currently registers only `/qna`; there is no tool, no event hook, and no loop state.

- `extensions/qna/command.ts`
  - Current task-04 orchestrator.
  - Hydrates branch state, scans transcript since the durable boundary, runs the model reconciliation loader, applies transcript reconciliation, persists `qna.state`, and shows a summary notification.
  - It stops after discovery. It never starts an agent turn.

- `extensions/qna/branch-state.ts`
  - Product-owned hidden storage layer for `qna.state` snapshots.
  - Rehydrates the latest valid snapshot from the current branch and overlays later `question-runtime.control` `draftSnapshot` messages onto `runtimeDraftsByQuestionId`.

- `extensions/qna/reconcile.ts`
  - Pure transcript-reconciliation state transition layer for task-04.
  - Owns stable question fingerprints, new-question ID allocation, `answered_in_chat`, replacement/supersede transitions, and recovery-scan dedupe.

- `extensions/qna/transcript-scan.ts`
  - Boundary-aware transcript collector.
  - Only includes user messages and completed assistant messages.

- `extensions/qna/model-reconcile.ts`
  - LLM-facing transcript reconciliation prompt and response normalization.
  - Produces only transcript-owned actions (`answered_in_chat`, `replace`, new questions).

- `extensions/question-runtime/types.ts`
  - Shared runtime request, draft, outcome, and structured submit-result contracts.
  - Defines the exact machine-readable payloads task-05 must consume.

- `extensions/question-runtime/form-state.ts`
  - Shared runtime submit-result constructor.
  - Important because it guarantees `no_user_response` when the user leaves every visible question `open`.

- `extensions/question-runtime/form-shell.ts`
  - Shared tabbed TUI form shell.
  - Already exported and directly reusable from product-owned tools.

- `extensions/question-runtime/request-validator.ts`
  - Shared validation for `AuthorizedQuestionRequest` payloads.
  - Useful as a read-only validation seam so `/qna` does not fork runtime request rules.

- `extensions/question-runtime/index.ts`
  - Low-level file-backed runtime request orchestration.
  - Important as read-only contrast: the current shared runtime tool is file-request based and separate from the product-level `qna` tool that task-05 needs.

#### Existing runtime flow

##### Current `/qna` flow

1. User runs `/qna`.
2. `QnaBranchStateStore` hydrates the latest `qna.state` snapshot and overlays later shared-runtime draft updates.
3. `collectQnaTranscriptSinceBoundary()` collects user/assistant transcript entries after the durable boundary.
4. If new transcript exists, `reconcileQnaTranscript()` asks the model for transcript-owned changes.
5. `applyQnaReconciliation()` updates branch-local ledger records and allocates new question IDs.
6. The command persists the updated `qna.state`, advances the durable boundary, and shows a notification.
7. Execution stops. There is no agent loop, no form shell, no `qna` tool, and no product-owned submit-result path.

##### Current shared question-runtime flow

1. An agent calls the low-level `question_runtime_request` tool.
2. The shared runtime issues a JSON ticket path.
3. The agent authors a request file; the watcher validates it and opens `showQuestionRuntimeFormShell()`.
4. The shell returns `QuestionRuntimeFormResult` with `draftSnapshot` and either `question_outcomes` or `no_user_response`.
5. The shared runtime emits hidden `question-runtime.control` messages for submit/cancel so product code can persist drafts or outcomes.

#### Current data/model shapes

- `QnaBranchStateSnapshot`

  ```ts
  interface QnaBranchStateSnapshot {
    schemaVersion: 1;
    durableBoundaryEntryId?: string;
    nextQuestionSequence: number;
    questions: QnaLedgerQuestionRecord[];
    runtimeDraftsByQuestionId: Record<string, QuestionRuntimeQuestionDraft>;
  }
  ```

- `QnaLedgerQuestionRecord`
  - Product-owned authoritative states: `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, `superseded`.
  - Shared runtime outcomes already fit inside the `answered` / `skipped` / `needs_clarification` variants via `submittedOutcome`.

- `QuestionRuntimeStructuredSubmitResult`

  ```ts
  type QuestionRuntimeStructuredSubmitResult =
    | { kind: "question_outcomes"; requiresClarification: boolean; outcomes: SubmittedQuestionRuntimeQuestionOutcome[] }
    | { kind: "no_user_response"; requiresClarification: false; outcomes: [] };
  ```

- `QuestionRuntimeFormResult`

  ```ts
  type QuestionRuntimeFormResult =
    | { action: "cancel"; draftSnapshot: QuestionRuntimeQuestionDraft[] }
    | {
        action: "submit";
        draftSnapshot: QuestionRuntimeQuestionDraft[];
        submitResult: QuestionRuntimeStructuredSubmitResult;
      };
  ```

#### Current UI/rendering flow

- `/qna` uses only one visible UI phase today:
  - a `BorderedLoader` while transcript reconciliation runs.
  - then a `ctx.ui.notify(...)` summary.

- The shared runtime already has the right structured review UI:
  - tabbed question editor
  - review tab with counts for `answered`, `open`, `skipped`, and `needs_clarification`
  - submit validation and `no_user_response` semantics
  - cancel/submit always returning the latest `draftSnapshot`

#### Reusable pieces that should be preserved

- `QnaBranchStateStore` as the only product-owned persistence seam for ordinary QnA branch state.
- `collectQnaTranscriptSinceBoundary()` and task-04 durable-boundary behavior.
- `reconcileQnaTranscript()` plus `applyQnaReconciliation()` for transcript discovery only.
- Shared runtime request/outcome/draft types from `extensions/question-runtime/types.ts`.
- Shared runtime submit semantics from `form-state.ts`.
- Shared runtime tabbed shell from `showQuestionRuntimeFormShell()`.
- Shared runtime request validation rules from `validateAuthorizedQuestionRequest()`.

#### Friction, duplication, or missing seams

- `/qna` exits too early. It never evaluates whether open backlog remains after the discovery pass.
- The command’s current no-op path is transcript-only. It treats “no new transcript” as full completion even when older open questions still exist.
- There is no product-owned bridge from open ledger records to the shared runtime form shell.
- There is no pure QnA submit-result applier.
- There is no ephemeral loop state, no scoped tool activation, and no cleanup path.
- There is no direct way for the agent to say “this loop is done, leave the rest for later.”
- There is no implemented reader for a shared interview chat-attachment marker yet, so `/qna` cannot currently enforce the interview guard.

### 5. Target Architecture

#### Proposed modules and responsibilities

- `command.ts` stays the user-initiated orchestrator.
  - Owns the task-04 discovery pass.
  - Enforces the interview-attachment guard before any discovery work.
  - Decides whether the successful result is:
    - no unresolved questions → notify and stop
    - unresolved questions exist → start or refresh the `/qna` loop

- `interview-attachment.ts` owns read-only interview-guard detection.
  - Reads current-branch hidden entries for `interview.chat_attachment`.
  - Returns the currently attached `interviewSessionId` or `null`.

- `loop-controller.ts` owns ephemeral loop scope.
  - Tracks whether a `/qna` loop is active.
  - Applies the active-tool diff (`+qna`, `-question_runtime_request` if it was previously active).
  - Enforces baseline non-loop cleanup (`qna` removed when inactive).
  - Injects per-turn loop guidance via `before_agent_start`.
  - Emits and filters hidden `qna.loop.control` kickoff messages through a shared protocol.
  - Restores tools when the loop settles or the session context changes.

- `loop-control-message.ts` owns hidden kickoff protocol contracts.
  - Defines `QNA_LOOP_CONTROL_CUSTOM_TYPE = "qna.loop.control"`.
  - Defines kickoff details shape with `loopId`, `openQuestionIds`, and optional discovery summary.
  - Exposes parser/type-guard helpers so context filtering is deterministic.

- `tool.ts` owns the agent-facing `qna` tool.
  - Validates that the agent only asks about currently open ordinary-QnA records.
  - Accepts product-owned `questionIds` and compiles an internal shared-runtime request shape.
  - Launches the shared runtime form shell only when structured capture is needed.
  - Persists `draftSnapshot` on cancel or submit.
  - Applies structured outcomes to the authoritative ledger or settles the loop on `no_user_response` / explicit completion.

- `runtime-submit.ts` owns pure state transitions from shared runtime results.
  - No UI.
  - No active-tool logic.
  - No command orchestration.

- `branch-state.ts` remains the storage boundary.
  - The command and the tool both hydrate current state through it and persist complete snapshots back through it.

#### Data flow from command entry to final persisted or emitted result

1. User runs `/qna`.
2. Command checks interview attachment via `getAttachedInterviewSessionIdFromBranch(branch)`.
   - if attached, notify and stop before any discovery or loop activation.
3. Command hydrates branch-local state and runs the existing transcript discovery pass.
4. Command persists the successful post-discovery snapshot, including durable boundary updates.
5. Command computes `open` ledger items from the resulting state.
6. If zero open items remain:
   - show a no-results notification
   - do not start the loop
   - do not render the shared runtime form
7. If open items remain:
   - require an interactive model-backed loop
   - call `loopController.startLoop(...)`
   - if this starts a new loop, activate scoped tools and send one hidden kickoff message
   - if a loop is already active, refresh open-question context only (no duplicate kickoff)
8. On each later user prompt while the loop is active:
   - `before_agent_start` adds current `/qna` loop guidance and the current open-question summary
   - the agent can either ask normal clarifying chat questions or call `qna`
9. If the agent calls `qna` with `action: "question_batch"`:
   - validate requested `questionIds` against the current open ledger
   - compile a shared runtime request
   - launch `showQuestionRuntimeFormShell()`
   - on cancel: persist `draftSnapshot` only
   - on submit with `question_outcomes`: apply authoritative ledger transitions and persist drafts
   - on submit with `no_user_response`: persist drafts, notify, settle the current loop, and return fixed result kind `no_user_response_settled`
10. If the agent calls `qna` with `action: "complete"`:
    - settle the current loop without mutating the ledger

11. On `agent_end`, if the loop is settled:
    - remove the `qna` tool from the active set
    - restore the low-level runtime tool if it was active before the loop

#### Reusable abstractions to introduce or strengthen

- **Ephemeral loop controller** instead of burying tool activation inside command code.
  - Reusable for task-06 “reactivate the loop-scoped `qna` tool”.

- **Pure submit-result applier** instead of mixing runtime outcome logic into the tool implementation.
  - Reusable from future `/qna-ledger` edit paths if they later choose to reuse shared runtime forms.

- **Product-owned batch compiler** that reuses the shared validator and form shell instead of copying runtime rules.
  - Keeps `/qna` distinct from the low-level request-ticket tool.

#### Clear boundaries between runtime, validation, storage, UI, and command orchestration

- **Runtime UI:** `extensions/question-runtime/form-shell.ts`, `form-state.ts` (read-only shared infrastructure)
- **Validation:** shared request validator reused from `extensions/question-runtime/request-validator.ts`
- **Storage:** `extensions/qna/branch-state.ts`
- **Authoritative state transitions:** new `extensions/qna/runtime-submit.ts`
- **Interview-attachment guard read seam:** new `extensions/qna/interview-attachment.ts`
- **Hidden kickoff message protocol:** new `extensions/qna/loop-control-message.ts`
- **Loop scope and prompt shaping:** new `extensions/qna/loop-controller.ts`
- **Command orchestration:** `extensions/qna/command.ts`
- **Agent-facing structured entrypoint:** new `extensions/qna/tool.ts`

```text
user runs /qna
      |
      v
check interview.chat_attachment marker ------ attached? ----+--> notify + stop
      |
      v
run task-04 discovery pass -------------------------------+
      |                                                   |
      +--> failure/cancel --> persist hydrated drafts? --> notify + stop
      |
      v
persist qna.state + durable boundary
      |
      v
compute current open ledger items
      |
      +--> none --> notify "no unresolved questions" --> stop
      |
      v
start/refresh QnaLoopController
  tools: +qna, -question_runtime_request (if previously active)
      |
      v
new loop only: hidden qna.loop.control kickoff (trigger turn)
every loop turn: before_agent_start loop prompt
      |
      v
agent turn --------------------------------------------------------------+
  |                                                                       |
  +--> ordinary chat question --------------------------------------------+
  |
  +--> qna(action:"question_batch", questionIds:[...])
  |       --> validate open ids --> compile runtime request --> show shared form --> form result
  |                                                |                     |
  |                                                |                     +--> cancel --> persist draftSnapshot only
  |                                                |                     |
  |                                                |                     +--> submit(question_outcomes)
  |                                                |                     |       -> apply authoritative states
  |                                                |                     |
  |                                                |                     +--> submit(no_user_response)
  |                                                |                             -> persist drafts + fixed notify + settle loop
  |
  +--> qna(action:"complete") --> settle loop
      |
      v
agent_end --> settled? --> restore tool scope --> future backlog stays in qna.state
```

### 6. File-by-File Implementation Plan

#### File Plan — `Path:` `extensions/qna.ts`

- `Action:` `modify`
- `Why:` Root extension wiring must now register both the command and the loop-scoped agent tool, plus loop lifecycle hooks.
- `Responsibilities:`
  - Construct one shared `QnaLoopController` instance.
  - Register `/qna` with that controller plus the concrete interview-attachment resolver.
  - Register the agent-facing `qna` tool.
  - Register lifecycle hooks that clean up stale loop state.
  - Ensure `qna` is not active outside an active loop right after extension init.
- `Planned exports / signatures:`

  ```ts
  export default function qnaExtension(pi: ExtensionAPI): void;
  ```

- `Key logic to add or change:`
  - Replace single `registerQnaCommand(pi)` call with controller-backed wiring.
  - Pass `getAttachedInterviewSessionIdFromBranch` from `interview-attachment.ts` into command registration.
  - Update extension header comments to reflect merged discovery+loop behavior.
  - Keep the root file thin; do not move orchestration logic here.
- `Dependencies:` `extensions/qna/command.ts`, `extensions/qna/tool.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/interview-attachment.ts`
- `Risks / notes:` Tool registration order is low risk, but the root file must stay declarative so task-06 can extend the same controller without re-splitting the extension.

#### File Plan — `Path:` `extensions/qna/types.ts`

- `Action:` `modify`
- `Why:` Task-05 needs explicit contracts for loop-scoped tool input/output and loop lifecycle state without changing the task-04 authoritative ledger model.
- `Responsibilities:`
  - Preserve the existing ledger snapshot and record unions.
  - Add shared named shapes for open-question references.
  - Add product-level `qna` tool payload/result contracts.
  - Add loop-finish reason types.
- `Planned exports / signatures:`

  ```ts
  export interface QnaOpenQuestionReference {
    questionId: string;
    questionText: string;
  }

  export type QnaToolInput =
    | { action: "question_batch"; questionIds: string[] }
    | { action: "complete"; reason?: string };

  export type QnaLoopFinishReason =
    | "agent_complete"
    | "no_user_response"
    | "all_questions_resolved"
    | "session_reset";

  export type QnaToolResultDetails =
    | {
        kind: "question_batch_submitted";
        submitResult: QuestionRuntimeStructuredSubmitResult;
        remainingOpenQuestionIds: string[];
        loopSettled: boolean;
      }
    | {
        kind: "question_batch_cancelled";
        remainingOpenQuestionIds: string[];
        loopSettled: false;
      }
    | {
        kind: "no_user_response_settled";
        remainingOpenQuestionIds: string[];
        loopSettled: true;
      }
    | {
        kind: "loop_completed";
        remainingOpenQuestionIds: string[];
        loopSettled: true;
      };
  ```

- `Key logic to add or change:`
  - Keep `qna` tool payload product-owned (`questionIds`) and leave runtime authoring types internal to `tool.ts`.
  - Keep task-04 record-state tags unchanged.
- `Dependencies:` `extensions/question-runtime/types.ts`
- `Risks / notes:` Do not widen the ordinary-QnA authoritative state union beyond the task-04 model.

#### File Plan — `Path:` `extensions/qna/loop-control-message.ts`

- `Action:` `add`
- `Why:` The hidden kickoff/control protocol must be explicit and reusable so kickoff emission and stale-context filtering do not depend on ad-hoc string matching.
- `Responsibilities:`
  - Define the hidden custom message type for `/qna` loop control.
  - Define kickoff payload shape and parser/type-guard helpers.
  - Keep loop-control messages non-display and deterministic.
- `Planned exports / signatures:`

  ```ts
  export const QNA_LOOP_CONTROL_CUSTOM_TYPE = "qna.loop.control";

  export interface QnaLoopKickoffDetails {
    type: "kickoff";
    loopId: string;
    openQuestionIds: string[];
    discoverySummary?: string;
  }

  export function buildQnaLoopKickoffMessage(details: QnaLoopKickoffDetails): {
    customType: string;
    content: string;
    display: false;
    details: QnaLoopKickoffDetails;
  };

  export function isQnaLoopKickoffMessage(message: AgentMessage): boolean;
  ```

- `Key logic to add or change:`
  - Keep message parsing strict (`custom` role, expected `customType`, valid details schema).
  - Do not put user-facing text in the kickoff `content`; it is control-only context.
- `Dependencies:` `extensions/qna/types.ts`
- `Risks / notes:` Keep this protocol small; task-06 can add new detail variants only if needed.

#### File Plan — `Path:` `extensions/qna/interview-attachment.ts`

- `Action:` `add`
- `Why:` Requirement 7 needs a concrete, testable source-of-truth reader now, without pulling interview persistence into task-05.
- `Responsibilities:`
  - Read the latest hidden branch entry for `customType: "interview.chat_attachment"`.
  - Parse `{ schemaVersion: 1, interviewSessionId: string | null }`.
  - Return attached `interviewSessionId` or `null`.
- `Planned exports / signatures:`

  ```ts
  export const INTERVIEW_CHAT_ATTACHMENT_ENTRY = "interview.chat_attachment";

  export function getAttachedInterviewSessionIdFromBranch(
    branch: SessionEntry[],
  ): string | null;
  ```

- `Key logic to add or change:`
  - Use “latest valid entry wins” semantics.
  - Ignore malformed payloads rather than throwing.
- `Dependencies:` `extensions/qna/types.ts`
- `Risks / notes:` This is read-only; writing this marker remains interview-track work in task-08.

#### File Plan — `Path:` `extensions/qna/loop-controller.ts`

- `Action:` `add`
- `Why:` Scoped tool activation, loop prompt injection, and cleanup are all ephemeral session concerns that do not belong in `command.ts` or `tool.ts`.
- `Responsibilities:`
  - Track whether a `/qna` loop is active.
  - Apply and restore the active-tool diff.
  - Emit a hidden kickoff message for the first loop turn.
  - Refresh open-question context without duplicate kickoff when `/qna` is rerun during an active loop.
  - Inject per-turn loop instructions while active.
  - Enforce that `qna` is removed whenever no loop is active.
  - Restore tool scope on settle or session reset.
- `Planned exports / signatures:`

  ```ts
  export class QnaLoopController {
    constructor(private readonly pi: ExtensionAPI);

    isActive(): boolean;
    startLoop(input: {
      openQuestions: QnaOpenQuestionReference[];
      discoverySummary?: string;
    }): { startedNewLoop: boolean; loopId: string };
    markSettled(reason: QnaLoopFinishReason): void;
    handleBeforeAgentStart(
      event: { systemPrompt: string },
      ctx: ExtensionContext,
    ): { systemPrompt: string } | undefined;
    handleContext(event: { messages: AgentMessage[] }): { messages: AgentMessage[] } | undefined;
    handleAgentEnd(ctx: ExtensionContext): void;
    handleSessionReset(): void;
  }

  export function registerQnaLoopLifecycle(
    pi: ExtensionAPI,
    loopController: QnaLoopController,
  ): void;
  ```

- `Key logic to add or change:`
  - Store only ephemeral data: active flag, current `loopId`, open-question summary cache, whether `question_runtime_request` was active before the loop, and settle-after-turn state.
  - On activation, add `qna` to `pi.getActiveTools()`, remove `question_runtime_request` only if it was active, and send one hidden kickoff message via `pi.sendMessage(..., { deliverAs: "steer", triggerTurn: true })`.
  - On rerun while active, refresh cached open questions but do not enqueue another kickoff message.
  - On settle, mark the loop inactive immediately; on lifecycle cleanup restore `question_runtime_request` only when the pre-loop tool diff says it was active.
  - On startup/reload/tree/switch/shutdown, enforce non-loop baseline by removing any stray `qna` activation.
  - Build a system-prompt delta listing current open ordinary-QnA records and the rules: normal chat is allowed, `qna` is for structured capture, `complete` ends only the current loop.
  - Filter stale hidden `qna.loop.control` messages from non-loop context so old kickoff messages do not leak into unrelated prompts.
- `Dependencies:` `extensions/qna/branch-state.ts`, `extensions/qna/reconcile.ts`, `extensions/qna/types.ts`, `extensions/qna/loop-control-message.ts`
- `Risks / notes:` Tool restoration should preserve unrelated tool toggles done during the loop; restore only the `qna` / `question_runtime_request` diff rather than clobbering the whole active-tool set.

#### File Plan — `Path:` `extensions/qna/runtime-submit.ts`

- `Action:` `add`
- `Why:` Shared runtime submit or cancel results need a pure product-owned translation layer into the authoritative task-04 ledger state model.
- `Responsibilities:`
  - Merge returned `draftSnapshot` data into `runtimeDraftsByQuestionId`.
  - Apply `question_outcomes` directly to open QnA records.
  - Leave untouched visible questions `open`.
  - Keep durable boundary and send markers unchanged except for semantic record revisions.
- `Planned exports / signatures:`

  ```ts
  export function applyQnaDraftSnapshot(
    state: QnaBranchStateSnapshot,
    draftSnapshot: QuestionRuntimeQuestionDraft[],
  ): QnaBranchStateSnapshot;

  export function applyQnaStructuredSubmitResult(input: {
    state: QnaBranchStateSnapshot;
    batchQuestionIds: string[];
    draftSnapshot: QuestionRuntimeQuestionDraft[];
    submitResult: QuestionRuntimeStructuredSubmitResult;
  }): {
    nextState: QnaBranchStateSnapshot;
    stats: {
      answered: number;
      skipped: number;
      needsClarification: number;
      untouched: number;
    };
    changedQuestionIds: string[];
    remainingOpenQuestionIds: string[];
  };
  ```

- `Key logic to add or change:`
  - Clone the incoming snapshot before mutation.
  - Upsert each returned draft by `questionId` without deleting unrelated entries.
  - Reject duplicate or out-of-scope outcome question IDs.
  - Transition only referenced open records into `answered`, `skipped`, or `needs_clarification` and store the exact `submittedOutcome` payload.
  - Bump `sendState.localRevision` only for changed records.
  - For `submitResult.kind === "no_user_response"`, return an unchanged ledger with updated drafts and a non-zero `remainingOpenQuestionIds` list.
- `Dependencies:` `extensions/qna/types.ts`, `extensions/question-runtime/types.ts`
- `Risks / notes:` This helper must stay deterministic and side-effect free so command and tool tests can trust it without mocking UI.

#### File Plan — `Path:` `extensions/qna/tool.ts`

- `Action:` `add`
- `Why:` Task-05 requires a dedicated agent-facing `qna` tool that sits above the shared runtime and owns product-specific loop semantics.
- `Responsibilities:`
  - Register the `qna` tool.
  - Validate `question_batch` vs `complete` actions.
  - Build a shared runtime request from selected ledger `questionIds` plus saved drafts.
  - Launch the shared form shell only for `question_batch`.
  - Persist draft-only or submitted results.
  - Settle the loop on explicit completion, `no_user_response`, or zero remaining open items.
- `Planned exports / signatures:`

  ```ts
  export interface RegisterQnaToolOptions {
    loopController: QnaLoopController;
    showForm?: typeof showQuestionRuntimeFormShell;
  }

  export function registerQnaTool(pi: ExtensionAPI, options: RegisterQnaToolOptions): void;

  function buildQuestionRuntimeRequest(input: {
    state: QnaBranchStateSnapshot;
    batchQuestionIds: string[];
  }): AuthorizedQuestionRequest;
  ```

- `Key logic to add or change:`
  - Throw if the tool is called when the `/qna` loop is not active.
  - Throw if the tool is called without interactive UI (`ctx.hasUI === false`).
  - Rehydrate the latest branch-local state on every tool call so stale loop context cannot mutate closed or superseded records.
  - Reject empty `questionIds` batches and any IDs that are not currently `open` ordinary-QnA records.
  - Compile each selected ordinary-QnA record into a deterministic runtime `freeform` question node (product-owned mapping) so runtime authoring schema never appears in tool input.
  - Validate the compiled request against `validateAuthorizedQuestionRequest(JSON.stringify(request))` before opening the form shell.
  - Use a synthetic request label like `qna/manual` so the shared runtime header remains readable without the low-level file-ticket workflow.
  - On cancel: `applyQnaDraftSnapshot()` and persist.
  - On submit with `question_outcomes`: `applyQnaStructuredSubmitResult()` and persist.
  - On submit with `no_user_response`: persist, notify with fixed copy, mark the loop settled, and return `details.kind = "no_user_response_settled"` with no freeform answer summary text.
  - On `action: "complete"`: settle the loop without touching the ledger.
- `Dependencies:` `extensions/qna/branch-state.ts`, `extensions/qna/runtime-submit.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/types.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/request-validator.ts`, `extensions/question-runtime/types.ts`
- `Risks / notes:` Keep tool result text minimal and structured so the agent does not invent freeform “answer summaries” after `no_user_response`.

#### File Plan — `Path:` `extensions/qna/command.ts`

- `Action:` `modify`
- `Why:` The command must keep task-04 discovery behavior but now decide between loop start and no-results exit instead of always stopping after discovery.
- `Responsibilities:`
  - Preserve task-04 transcript reconciliation and boundary persistence behavior.
  - Add a concrete interview-attachment guard seam.
  - Compute unresolved open questions after the discovery pass.
  - Start or refresh the loop, or show a no-results notification.
- `Planned exports / signatures:`

  ```ts
  export interface QnaCommandOptions {
    loopController: QnaLoopController;
    getAttachedInterviewSessionId: (branch: SessionEntry[]) => string | null;
  }

  export function registerQnaCommand(pi: ExtensionAPI, options: QnaCommandOptions): void;

  export async function runQnaCommand(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    options: QnaCommandOptions,
  ): Promise<void>;
  ```

- `Key logic to add or change:`
  - Resolve interview attachment before discovery; when attached, notify and stop with no boundary mutation.
  - Keep `persistHydratedStateIfNeeded()` for failure paths.
  - Preserve the current model-reconciliation loader and task-04 error handling.
  - Change the current transcript no-op branch so it still advances the boundary but no longer exits early if open backlog exists.
  - After any successful discovery/no-op persistence, compute `getUnresolvedQnaQuestions(nextState)`.
  - If unresolved is empty, notify and stop.
  - If unresolved is non-empty, require a model-backed loop and call `loopController.startLoop(...)`.
  - On `/qna` rerun while loop is already active, refresh open-question context without emitting a duplicate kickoff.
  - If the model is missing in the “open backlog but no new transcript” path, keep the successful boundary persistence but notify that the interactive loop cannot start.
- `Dependencies:` `extensions/qna/branch-state.ts`, `extensions/qna/transcript-scan.ts`, `extensions/qna/model-reconcile.ts`, `extensions/qna/reconcile.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/interview-attachment.ts`
- `Risks / notes:` Do not regress task-04’s “do not advance the boundary on discovery failure” rule while restructuring the success path.

#### File Plan — `Path:` `extensions/qna/command.test.ts`

- `Action:` `modify`
- `Why:` The command’s observable behavior changes substantially once open backlog can start a loop and zero-open runs become first-class exits.
- `Responsibilities:`
  - Keep existing boundary/failure coverage from task-04.
  - Add task-05 loop-start and no-results assertions.
  - Cover the “open backlog but no new transcript” model requirement.
  - Cover the injected interview guard seam.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Replace direct `runQnaCommand(pi, ctx)` calls with the new options object.
  - Add fake loop-controller spies to assert start vs no-start behavior.
  - Assert no hidden start message or tool activation occurs when unresolved questions are zero.
  - Add coverage for “reconciliation succeeds to zero unresolved” (not only transcript no-op).
  - Add coverage for rerunning `/qna` while a loop is already active (refresh without duplicate kickoff).
- `Dependencies:` `extensions/qna/command.ts`, `extensions/qna/loop-controller.ts`
- `Risks / notes:` Keep tests focused on command orchestration, not on the internal form-shell path that belongs in `tool.test.ts`.

#### File Plan — `Path:` `extensions/qna/runtime-submit.test.ts`

- `Action:` `add`
- `Why:` The shared-runtime outcome-to-ledger translation is the highest-risk new pure logic in task-05 and should be locked down independently.
- `Responsibilities:`
  - Cover state transitions for `answered`, `skipped`, and `needs_clarification`.
  - Prove untouched visible questions remain `open`.
  - Prove `no_user_response` keeps records open while persisting drafts.
  - Prove cancel-only draft persistence does not mutate authoritative states.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Build small snapshot fixtures around existing task-04 record shapes.
  - Assert `sendState.localRevision` increments only for changed records.
  - Assert `durableBoundaryEntryId` is preserved unchanged.
- `Dependencies:` `extensions/qna/runtime-submit.ts`
- `Risks / notes:` Keep fixtures small and explicit so it is obvious which records were visible in the structured batch.

#### File Plan — `Path:` `extensions/qna/tool.test.ts`

- `Action:` `add`
- `Why:` The new agent-facing `qna` tool owns the product/runtime bridge and should be covered without relying on live TUI interaction.
- `Responsibilities:`
  - Prove stale or non-open question IDs are rejected.
  - Prove cancel persists drafts only.
  - Prove `no_user_response` persists state, notifies, and settles the loop.
  - Prove explicit `complete` settles the loop while leaving older open items unchanged.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Inject a fake `showForm` implementation returning deterministic `QuestionRuntimeFormResult` fixtures.
  - Use a fake loop controller to verify `markSettled(...)` calls.
  - Assert persisted snapshots contain the expected `submittedOutcome` payloads.
  - Assert non-UI calls are rejected before form launch.
  - Assert `no_user_response` returns fixed structured result details and no fabricated answer summary text.
- `Dependencies:` `extensions/qna/tool.ts`, `extensions/qna/runtime-submit.ts`
- `Risks / notes:` Keep the tool tests at the product boundary; do not duplicate shared runtime shell tests.

#### File Plan — `Path:` `extensions/qna/loop-controller.test.ts`

- `Action:` `add`
- `Why:` Scoped tool activation and cleanup are central task-05 behavior and should not be tested only through the command.
- `Responsibilities:`
  - Prove activation adds `qna` and hides `question_runtime_request` only for the active loop.
  - Prove startup/session-reset cleanup removes stray `qna` activation when loop is inactive.
  - Prove settle restores that diff.
  - Prove session-reset cleanup clears stale loop scope.
  - Prove stale hidden loop control messages are removed from non-loop context.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Use a fake `pi` implementation with `getActiveTools()`, `setActiveTools()`, and `sendMessage(...)` spies.
  - Assert restoration does not wipe unrelated active tools.
- `Dependencies:` `extensions/qna/loop-controller.ts`
- `Risks / notes:` Keep this file focused on loop scope semantics, not ledger persistence.

#### File Plan — `Path:` `extensions/qna/interview-attachment.test.ts`

- `Action:` `add`
- `Why:` Requirement-7 guard reliability depends on deterministic attachment parsing.
- `Responsibilities:`
  - Prove latest-valid attachment marker wins.
  - Prove malformed entries are ignored safely.
  - Prove `null` attachment clears prior attached state.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Build small branch fixtures with mixed valid/invalid custom entries.
  - Assert parser returns exact `interviewSessionId` or `null`.
- `Dependencies:` `extensions/qna/interview-attachment.ts`
- `Risks / notes:` Keep it parser-only; do not test `/interview` workflows here.

#### File Plan — `Path:` `extensions/qna/loop-control-message.test.ts`

- `Action:` `add`
- `Why:` Kickoff/custom-message protocol must stay stable so filtering and kickoff triggering stay deterministic.
- `Responsibilities:`
  - Prove kickoff builder emits non-display hidden messages with expected details shape.
  - Prove parser/type-guard rejects malformed payloads.
- `Planned exports / signatures:` none
- `Key logic to add or change:`
  - Assert `customType` and detail schema fields are strict.
- `Dependencies:` `extensions/qna/loop-control-message.ts`
- `Risks / notes:` Keep tests protocol-focused; no loop-controller behavior assertions here.

### 7. File Fingerprints

#### Fingerprint — `Path:` `extensions/qna.ts`

- `Reason this file changes:` Root extension wiring must register the new loop controller, tool, and lifecycle hooks.
- `Existing anchors to search for:` `import { registerQnaCommand } from "./qna/command.js";`, `export default function qnaExtension(pi: ExtensionAPI): void {`
- `New anchors expected after implementation:` `import { QnaLoopController, registerQnaLoopLifecycle } from "./qna/loop-controller.js";`, `import { registerQnaTool } from "./qna/tool.js";`, `import { getAttachedInterviewSessionIdFromBranch } from "./qna/interview-attachment.js";`, `const loopController = new QnaLoopController(pi);`, `registerQnaCommand(pi, { loopController, getAttachedInterviewSessionId: getAttachedInterviewSessionIdFromBranch });`
- `Unsafe areas to avoid touching:` The extension header comment and root-file thin-entrypoint pattern; do not move command or tool logic back into this file.

#### Fingerprint — `Path:` `extensions/qna/types.ts`

- `Reason this file changes:` Task-05 needs shared contracts for the loop-scoped tool and loop state while preserving the task-04 ledger model.
- `Existing anchors to search for:` `export const QNA_STATE_ENTRY = "qna.state";`, `export interface QnaTranscriptMessage {`, `export interface QnaReconcileModelResponse {`
- `New anchors expected after implementation:` `export interface QnaOpenQuestionReference {`, `export type QnaToolInput =`, `questionIds: string[]`, `export type QnaLoopFinishReason =`, `kind: "no_user_response_settled"`
- `Unsafe areas to avoid touching:` Existing `QnaLedgerQuestionRecord` state tags and the `QnaBranchStateSnapshot` schema-version contract.

#### Fingerprint — `Path:` `extensions/qna/loop-control-message.ts`

- `Reason this file changes:` New file for hidden kickoff/control message protocol.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export const QNA_LOOP_CONTROL_CUSTOM_TYPE = "qna.loop.control";`, `export interface QnaLoopKickoffDetails {`, `buildQnaLoopKickoffMessage(`, `isQnaLoopKickoffMessage(`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/interview-attachment.ts`

- `Reason this file changes:` New read-only parser for interview chat-attachment marker.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export const INTERVIEW_CHAT_ATTACHMENT_ENTRY = "interview.chat_attachment";`, `getAttachedInterviewSessionIdFromBranch(`, `schemaVersion: 1`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/loop-controller.ts`

- `Reason this file changes:` New file for ephemeral `/qna` loop scope management.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export class QnaLoopController {`, `startLoop(input: {`, `startedNewLoop`, `QNA_LOOP_CONTROL_CUSTOM_TYPE`, `handleBeforeAgentStart(`, `handleContext(`, `registerQnaLoopLifecycle(`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/runtime-submit.ts`

- `Reason this file changes:` New pure state-transition layer for shared runtime cancel/submit results.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export function applyQnaDraftSnapshot(`, `export function applyQnaStructuredSubmitResult(`, `remainingOpenQuestionIds`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/tool.ts`

- `Reason this file changes:` New product-owned agent tool sitting above the shared runtime.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `export function registerQnaTool(`, `action: "question_batch"`, `questionIds`, `action: "complete"`, `function buildQuestionRuntimeRequest(`, `kind: "no_user_response_settled"`, `validateAuthorizedQuestionRequest(JSON.stringify(request))`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/command.ts`

- `Reason this file changes:` The command must become discovery-plus-loop orchestration instead of discovery-only reconciliation.
- `Existing anchors to search for:` `function formatSummary(`, `export function registerQnaCommand(pi: ExtensionAPI): void {`, `export async function runQnaCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {`
- `New anchors expected after implementation:` `export interface QnaCommandOptions {`, `getAttachedInterviewSessionId:`, `const attachedInterviewSessionId = options.getAttachedInterviewSessionId(branch);`, `const unresolvedQuestions = getUnresolvedQnaQuestions(nextState);`, `options.loopController.startLoop({`, `No unresolved QnA questions`
- `Unsafe areas to avoid touching:` `runModelReconciliation()` loader behavior and task-04 failure semantics around `persistHydratedStateIfNeeded()`.

#### Fingerprint — `Path:` `extensions/qna/command.test.ts`

- `Reason this file changes:` Command orchestration expectations change once `/qna` can start a loop or exit cleanly with zero unresolved questions.
- `Existing anchors to search for:` `describe("runQnaCommand", () => {`, `advances boundary on no-op success`, `missing model only errors when reconciliation is needed`
- `New anchors expected after implementation:` `starts the loop when open backlog exists after a no-op scan`, `does not start the loop when no unresolved questions remain`, `refreshes active loop without duplicate kickoff`, `blocks attached interview chats`
- `Unsafe areas to avoid touching:` Existing branch-state fixture helpers unrelated to task-05 behavior.

#### Fingerprint — `Path:` `extensions/qna/runtime-submit.test.ts`

- `Reason this file changes:` New tests for submit-result state application.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `describe("applyQnaStructuredSubmitResult", () => {`, `keeps untouched visible questions open`, `persists drafts on no_user_response`, `persists drafts on cancel`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/tool.test.ts`

- `Reason this file changes:` New tests for the agent-facing `qna` tool and its runtime bridge.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `describe("qna tool", () => {`, `rejects stale question ids`, `rejects non-interactive usage`, `returns no_user_response_settled without fabricated summary`, `complete leaves older open items untouched`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/loop-controller.test.ts`

- `Reason this file changes:` New tests for scoped tool activation and lifecycle cleanup.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `describe("QnaLoopController", () => {`, `activates qna only for the loop`, `removes stray qna when inactive`, `restores the low-level runtime tool`, `filters stale qna loop control messages`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/interview-attachment.test.ts`

- `Reason this file changes:` New parser tests for interview-attachment marker detection.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `describe("getAttachedInterviewSessionIdFromBranch", () => {`, `latest valid marker wins`, `ignores malformed markers`
- `Unsafe areas to avoid touching:` n/a

#### Fingerprint — `Path:` `extensions/qna/loop-control-message.test.ts`

- `Reason this file changes:` New protocol tests for hidden qna loop-control messages.
- `Existing anchors to search for:` none (new file)
- `New anchors expected after implementation:` `describe("qna loop control message protocol", () => {`, `buildQnaLoopKickoffMessage`, `isQnaLoopKickoffMessage`
- `Unsafe areas to avoid touching:` n/a

### 8. Stepwise Execution Plan

1. **Lock shared task-05 contracts first.**
   - Update `extensions/qna/types.ts` with named open-question references, product-level `qna` tool payloads/results, and loop finish enums.
   - Add `extensions/qna/loop-control-message.ts` contracts and tests.
   - Checkpoint: existing qna task-04 tests should still compile after import updates.

2. **Add interview-attachment guard reader.**
   - Create `extensions/qna/interview-attachment.ts` and `extensions/qna/interview-attachment.test.ts`.
   - Lock marker parsing (`interview.chat_attachment`, latest-valid-wins).

3. **Add the pure shared-runtime-result applier.**
   - Create `extensions/qna/runtime-submit.ts` and `extensions/qna/runtime-submit.test.ts`.
   - Cover cancel, `question_outcomes`, `no_user_response`, untouched visible questions, and `sendState.localRevision` bumps.
   - Safe to do in parallel with step 4 after steps 1-2.

4. **Add loop-scope infrastructure.**
   - Create `extensions/qna/loop-controller.ts` and `extensions/qna/loop-controller.test.ts`.
   - Implement tool diff activation/restoration, hidden kickoff message emission/filtering, per-turn loop instructions, idempotent refresh on rerun, and session-reset cleanup.
   - Safe to do in parallel with step 3 after steps 1-2.

5. **Add the agent-facing `qna` tool.**
   - Create `extensions/qna/tool.ts` and `extensions/qna/tool.test.ts`.
   - Wire it to the shared runtime form shell plus the pure submit/draft appliers.
   - Keep tool input as `questionIds` and runtime request compilation internal.
   - Depends on steps 1, 3, and 4.

6. **Refactor `/qna` command orchestration onto the new loop decision tree.**
   - Update `extensions/qna/command.ts` and `extensions/qna/command.test.ts`.
   - Preserve task-04 discovery semantics, enforce interview guard, then branch into `no unresolved` vs `start/refresh loop` behavior.
   - Depends on steps 2 and 4; uses the submit layer only indirectly.

7. **Wire the root extension entrypoint.**
   - Update `extensions/qna.ts` to construct the controller once and register command/tool/lifecycle hooks.
   - Pass concrete interview-attachment resolver into command wiring and keep baseline `qna` inactive outside loop.
   - Depends on steps 2, 4, 5, and 6.

8. **Run focused tests and reload for manual verification.**
   - Run targeted qna tests.
   - Reload the extension because files under `extensions/` changed.
   - Manual verification after reload is sequential and should happen only after the automated tests pass.

#### Parallel notes

- **Parallel-safe after steps 1-2:** steps 3 and 4.
- **Not parallel-safe:** step 5 depends on loop + submit contracts; step 6 depends on interview guard + loop controller; step 7 is last because it wires the new pieces together.

#### Checkpoints

- After step 2: run interview-attachment parser tests before command wiring.
- After step 3: run pure submit helper tests before touching command/tool orchestration.
- After step 4: verify loop activation/restoration + kickoff protocol tests before introducing the tool.
- After step 6: rerun the full qna test set because command behavior changes overlap existing task-04 coverage.
- After step 7: reload the extension and manually verify `/qna` loop behavior in the interactive UI.

### 9. Validation Plan

#### Unit / integration / manual verification needed

- **Focused automated tests**
  - `bun test extensions/qna/*.test.ts`
  - This should cover:
    - interview attachment marker parsing
    - command no-results behavior
    - command loop-start behavior with old open backlog
    - command guard for attached interview chats
    - command rerun refresh behavior without duplicate kickoff
    - loop controller scoped tool activation/restoration
    - loop-control hidden message protocol
    - pure submit-result application
    - tool cancel / submit / complete behavior

- **Manual interactive verification after reload**
  1. Start `/qna` on a branch with existing open ordinary-QnA items and confirm the `qna` tool becomes active while `question_runtime_request` is hidden for that loop.
  2. Let the agent ask a normal chat clarification without opening the form and confirm the loop stays active for the next user reply.
  3. Have the agent open a structured batch, leave one visible question untouched, submit, and inspect the latest hidden `qna.state` entry to confirm that question remains `open`.
  4. Submit a structured batch with no explicit outcomes and confirm only fixed notification/result text appears, drafts persist, and the loop settles.
  5. Run `/qna` again while the loop is active and confirm open-question context refreshes without duplicate kickoff spam.
  6. Run `/qna` when the ledger has zero unresolved ordinary-QnA items and confirm there is no empty form shell or empty review popup.
  7. Add a hidden `interview.chat_attachment` marker entry with non-null `interviewSessionId` and confirm `/qna` refuses to start and points the user back to `/interview`.

#### Expected user-visible behavior

- `/qna` starts as one merged flow: discovery first, then either an interactive loop or a no-results notification.
- The `qna` tool is visible only while the current `/qna` loop is active.
- The agent may still ask normal chat clarifying questions during the loop.
- Structured form submits update authoritative ledger states from machine-readable outcomes, not from freeform transcript parsing.
- Cancel and `no_user_response` preserve `draftSnapshot` without fabricating answered/skipped/clarification records.
- `no_user_response` emits fixed structured tool-result details instead of a generated answer narrative.
- Older open backlog remains durable when the current loop ends.

#### Failure modes to test

- Model reconciliation cancellation or failure should still preserve hydrated drafts and keep the old durable boundary.
- Running `/qna` with open backlog but no selected model should fail to start the interactive loop cleanly after any safe no-op boundary persistence.
- The `qna` tool should reject stale, duplicate, or non-open question IDs.
- Running the `qna` tool without UI should fail before opening the shared form shell.
- Cancelling a structured form should not mutate authoritative ledger states.
- `no_user_response` should not close questions or bump `sendState.localRevision` for untouched records.
- Session switch / session reload while a loop is active should remove the scoped `qna` tool.
- `/qna` reruns while already active should not enqueue duplicate kickoff control messages.

#### Any `mise run check` or other repo checks to run after TypeScript edits

- Do **not** run `mise run check`; repo guidance explicitly says not to do that after edits.
- Run focused `bun test extensions/qna/*.test.ts` and rely on the local quiet-build harness for broader TypeScript validation.
- Reload the extension before manual verification because files under `extensions/` changed.

### 10. Open Questions / Assumptions

- The shared marker contract is fixed in this plan as `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.
- Task-05 only reads this marker. Interview-track tasks remain responsible for writing and clearing it.

### 11. Downstream Alignment (Task-06+ and interview track)

- **Task-06 (`/qna-ledger` reactivation):** task-05 keeps `QnaLoopController.startLoop(...)` source-agnostic at runtime while type contracts stay minimal (`manual_qna` only in task-05). Task-06 can extend activation metadata without refactoring loop/tool seams.
- **Task-07 (interview persistence):** local runtime state remains source-of-truth for interview chat attachment; no committed interview file schema changes are required by task-05.
- **Task-08 (interview command attach/resume):** attach/detach flows must mirror current chat attachment into the hidden branch marker defined above so `/qna` guard behavior is deterministic from task-05 onward.
- **Specs coherence:** `/qna` stays branch-local and interview-agnostic; interview remains repo-scoped and owns attachment lifecycle. The marker contract is the only cross-track seam introduced here.
