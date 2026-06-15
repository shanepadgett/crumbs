## 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-06/task-06.md`
- `Task Title:` `Task 06 — /qna-ledger overlay, batched sends, and Markdown export`
- `Task Signature:` `task-06-qna-ledger-overlay-batched-sends-markdown-export`
- `Primary Code Scope:` `docs/qna/qna-inbox-spec.md`, `docs/qna/tasks/task-04/task-04.md`, `docs/qna/tasks/task-05/task-05.md`, `docs/qna/tasks/task-06/task-06.md`, `extensions/qna.ts`, `extensions/qna/types.ts`, `extensions/qna/command.ts`, `extensions/qna/tool.ts`, `extensions/qna/runtime-submit.ts`, `extensions/qna/reconcile.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/loop-control-message.ts`, `extensions/qna/interview-attachment.ts`, `extensions/question-runtime/types.ts`, `extensions/question-runtime/form-state.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/request-paths.ts`, `extensions/shared/option-picker.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, interview session UI or persistence beyond reusing the existing read-only attachment guard, unrelated repo extensions, `README.md`, shared question-runtime watcher/store plumbing, and broad transcript-reconciliation/model changes beyond the ledger integration seams required for `/qna-ledger`

## 2. Executive Summary

Task 06 adds a second ordinary-QnA surface: `/qna-ledger` becomes the branch-local maintenance overlay for already-discovered ledger records. The user should be able to browse all ordinary records for the current branch, filter by authoritative state, edit a selected record directly against branch-local state, manually send only unsent deltas in one structured batch, and export a timestamped Markdown snapshot under `docs/qna/`.

The clean implementation is to keep task-04/task-05 storage and loop seams intact, then add four narrow layers on top: a dedicated `/qna-ledger` command + overlay, a reusable single-record runtime-request builder for editing any ledger record, a pure send-delta module that owns payload construction plus send-revision advancement, and a Markdown exporter that resolves repo root and writes deterministic snapshots. Clarification-triggered send reactivation should reuse the existing loop controller without widening the `qna` tool contract beyond structured review of currently `open` questions; `needs_clarification` follow-up can continue in ordinary chat and later `/qna-ledger` edits. That avoids forking the shared runtime shell, avoids duplicate send-revision logic, and keeps `/qna`, `/qna-ledger`, storage, send batching, export, and loop reactivation as separate seams.

## 3. Requirement Map

1. **Requirement:** `The system shall provide /qna-ledger as the browsing and editing view for ordinary QnA items.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` registers only `/qna`; `extensions/qna/command.ts` owns only discovery/loop start; there is no ledger-browser command.
   - `Planned implementation move:` Add a dedicated `/qna-ledger` command and overlay command loop, registered from `extensions/qna.ts`, that operates only on the branch-local ordinary ledger.

1. **Requirement:** `/qna` and `/qna-ledger` shall not display or manage interview sessions.\`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/qna/command.ts` already blocks `/qna` in attached interview chats via `getAttachedInterviewSessionId`; no `/qna-ledger` path exists yet.
   - `Planned implementation move:` Keep `/qna-ledger` scoped strictly to `qna.state` records and avoid any interview reads or UI beyond the existing chat-attachment guard. No interview selector, session list, or attachment mutation should be introduced.

2a. **Requirement:** `When the current chat is attached to an interview session, the system shall block /qna-ledger and direct the user back to the interview instead of mixing the two systems in one chat.`

- `Status:` `needs implementation`
- `Current files/functions/types that relate:` `extensions/qna/interview-attachment.ts` already exposes the read-only attachment lookup used by `/qna`; `/qna-ledger` does not exist yet.
- `Planned implementation move:` Reuse the existing attachment guard seam in `extensions/qna/interview-attachment.ts` from the new `/qna-ledger` command, matching `/qna` warning behavior and avoiding any interview-specific branch mutations.

1. **Requirement:** `When the user runs /qna-ledger, the system shall open a simple ordinary-QnA ledger overlay for the current branch.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/shared/option-picker.ts` and `extensions/question-runtime/form-shell.ts` show current TUI modal patterns; there is no ledger overlay.
   - `Planned implementation move:` Add a `ctx.ui.custom(...)`-driven overlay file that renders a filterable list, record details, and action hints, then have the command loop reopen it after edit/send/export actions.

1. **Requirement:** `The /qna-ledger overlay shall prioritize browsing and filtering ordinary QnA questions rather than cross-session planning.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/types.ts` already exposes per-record authoritative state and send metadata; no browsing view exists.
   - `Planned implementation move:` Keep the overlay list-centric and branch-local: records, state, pending-send markers, and per-record details only. Do not introduce repo-wide or planning-oriented views.

1. **Requirement:** `The /qna-ledger overlay shall expose the authoritative ordinary-QnA record state for filtering and editing, including transcript-closed states such as answered_in_chat and superseded.`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/qna/types.ts:QnaLedgerQuestionRecord` already models `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, and `superseded`; `extensions/qna/branch-state.ts` persists them.
   - `Planned implementation move:` Add ledger filter/view types plus render helpers that treat the tagged union as the source of truth and surface transcript-closed records in the overlay and editor entrypoints.

1. **Requirement:** `The /qna-ledger overlay shall allow filtering by question state.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no existing filter type or view helper.
   - `Planned implementation move:` Add a `QnaLedgerFilter` union (`all` + each authoritative state), filtered list selectors, and overlay controls to cycle/select filters without touching storage.

1. **Requirement:** `The /qna-ledger overlay shall allow answering, skipping, marking needs_clarification, reopening, and editing previously closed ordinary QnA questions.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/tool.ts` and `extensions/qna/runtime-submit.ts` can submit structured outcomes only for currently open loop questions; closed records cannot be edited; reopen has no ledger-level mutation helper.
   - `Planned implementation move:` Reuse the shared runtime form shell for single-record edit/answer/skip/needs-clarification actions, add a pure ledger-record mutation layer for direct reopen, and synthesize draft snapshots from existing ledger state so closed records are editable without broad runtime changes.

1. **Requirement:** `When the user edits an ordinary QnA question from /qna-ledger, the system shall update the branch-local ledger immediately.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/branch-state.ts:replaceSnapshot` persists snapshots immediately; `extensions/qna/runtime-submit.ts` can mutate open records but not arbitrary ledger records.
   - `Planned implementation move:` After every ledger edit action, persist the mutated snapshot through `QnaBranchStateStore.replaceSnapshot()` before returning to the overlay. Single-record edit helpers should bump `sendState.localRevision` only when the authoritative record changed.

1. **Requirement:** `The /qna-ledger overlay shall provide a manual Send updates action.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/types.ts` already stores send revisions; no send action or message schema exists.
   - `Planned implementation move:` Add overlay action wiring plus a pure send module that collects unsent records, builds one structured payload, emits it as a hidden steer message, and then marks those revisions as sent.

1. **Requirement:** `When /qna-ledger sends updates, the system shall batch all unsent changed ordinary QnA items into one structured payload.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna/reconcile.ts` and `extensions/qna/runtime-submit.ts` bump `sendState.localRevision`; no batching helper exists.
   - `Planned implementation move:` Introduce a dedicated batch payload type and builder that serializes every record with `localRevision > lastSentRevision` into one `ordinary_qna_ledger_updates` message.

1. **Requirement:** `When /qna-ledger sends updates, the system shall send only items changed since the last send.`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/qna/types.ts:QnaLedgerSendState` tracks `localRevision` and `lastSentRevision`, but nothing consumes them.
   - `Planned implementation move:` Centralize delta detection in a pure send helper, then update `lastSentRevision` and `lastSentAt` only for sent records after the batch message is successfully emitted.

1. **Requirement:** `When /qna-ledger sends updates and any item is needs_clarification, the system shall reactivate the loop-scoped qna tool.`

- `Status:` `needs implementation`
- `Current files/functions/types that relate:` `extensions/qna/loop-controller.ts:startLoop` can activate the scoped tool, but only `/qna` calls it and the controller currently assumes the loop is a manual `/qna` run.
- `Planned implementation move:` Extend loop-controller metadata so `/qna-ledger` send can start or refresh a loop scope with a ledger-send source and a reviewable-question list of currently `open` questions only, then emit the ledger batch plus kickoff steer messages with `qna` reactivated when clarification follow-up is present. Clarification follow-up itself continues in ordinary chat and later `/qna-ledger` edits rather than widening `qna` submit semantics to non-`open` records.

12a. **Requirement:** `When /qna-ledger reactivates the loop-scoped qna tool after a needs_clarification send, the system shall preserve the existing structured-review semantics of qna for currently open ordinary QnA items while allowing clarification follow-up to continue in ordinary chat and later ledger edits.`

- `Status:` `needs implementation`
- `Current files/functions/types that relate:` `extensions/qna/tool.ts` and `extensions/qna/runtime-submit.ts` currently accept only `open` questions; `extensions/qna/loop-controller.ts` assumes all review questions are structured-review candidates.
- `Planned implementation move:` Keep `tool.ts` and `runtime-submit.ts` open-only, have ledger-send loop metadata carry `source` plus `open` reviewable ids only, and use source-specific prompt copy to tell the agent that clarification follow-up may happen in chat while later authoritative edits return through `/qna-ledger`.

1. **Requirement:** `The /qna-ledger overlay shall provide an export action.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no exporter or file-writing path exists in the QnA extension.
   - `Planned implementation move:` Add overlay action wiring plus a Markdown export module that formats the full ordinary ledger and writes it to a timestamped file under repo-root `docs/qna/`.

1. **Requirement:** `When the user exports ordinary QnA state, the system shall write a timestamped Markdown snapshot under docs/qna/.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/question-runtime/request-paths.ts:resolveProjectRoot` already provides a reusable repo-root resolver; no QnA export writer exists.
   - `Planned implementation move:` Reuse repo-root resolution, ensure `docs/qna/` exists, generate a sortable UTC timestamped filename, and write deterministic Markdown content for all ordinary ledger records.

## 4. Current Architecture Deep Dive

## Relevant files and current roles

- `extensions/qna.ts`
  - Extension entrypoint.
  - Constructs one `QnaLoopController`.
  - Registers only `/qna`, the loop-scoped `qna` tool, and loop lifecycle hooks.

- `extensions/qna/command.ts`
  - Owns `/qna` command orchestration.
  - Hydrates branch-local ledger state, scans transcript delta, runs reconciliation, persists the next snapshot, and starts a loop only when unresolved open questions remain.

- `extensions/qna/types.ts`
  - Defines the authoritative branch snapshot, per-record authoritative states, send metadata, transcript reconciliation contracts, and current `qna` tool types.

- `extensions/qna/branch-state.ts`
  - Hydrates the latest valid `qna.state` snapshot from the current branch.
  - Overlays later `question-runtime.control` draft snapshots into `runtimeDraftsByQuestionId`.
  - Persists replacement snapshots with `pi.appendEntry(...)`.

- `extensions/qna/reconcile.ts`
  - Owns transcript-owned state transitions.
  - Creates new open records, silently closes open records as `answered_in_chat`, supersedes old records, and bumps `localRevision` when authoritative record state changes.

- `extensions/qna/runtime-submit.ts`
  - Owns submit-result application for `/qna` loop batches.
  - Persists draft snapshots and maps structured outcomes into authoritative `answered` / `skipped` / `needs_clarification` states.
  - Assumes records are open and batched from an active `/qna` loop.

- `extensions/qna/tool.ts`
  - Registers the loop-scoped agent-facing `qna` tool.
  - Builds a shared runtime request for open questions only.
  - Rehydrates latest branch state on each call, launches the shared form shell, and applies submit or cancel results.

- `extensions/qna/loop-controller.ts`
  - Activates and deactivates the `qna` tool around an ephemeral loop.
  - Sends a hidden kickoff steer message and injects loop guidance into the system prompt.
  - Current loop metadata is shaped around manual `/qna` runs and a list of open questions.

- `extensions/qna/loop-control-message.ts`
  - Defines the hidden kickoff custom message used to tag the current loop.

- `extensions/question-runtime/form-shell.ts`
  - Already provides the interactive structured form modal.
  - Supports answer editing, skip, needs clarification, question notes, and reopen inside the form.

- `extensions/question-runtime/form-state.ts`
  - Explains how draft snapshots become `question_outcomes` or `no_user_response`.
  - Important current limitation for ledger editing: there is no explicit `open` submit outcome, so a pure “reopen with no answer” authoritative mutation cannot be inferred from submit result alone.

- `extensions/question-runtime/request-paths.ts`
  - Already exports `resolveProjectRoot(...)`, which can be reused for repo-root-relative Markdown export.

## Existing runtime flow

### `/qna`

1. User runs `/qna`.
1. `runQnaCommand()` hydrates `qna.state` from current branch entries.
1. Transcript scan reads only assistant/user messages since `durableBoundaryEntryId`.
1. Model reconciliation returns `updates` + `newQuestions`.
1. `applyQnaReconciliation()` mutates authoritative records and bumps `localRevision` for changed records.
1. Updated snapshot is persisted.
1. If any open questions remain, `QnaLoopController.startLoop()` activates `qna` and sends a kickoff steer message.

### `qna` tool batch

1. Tool call rehydrates latest `qna.state`.
1. Tool validates that requested question ids are currently open.
1. Tool compiles one `AuthorizedQuestionRequest` using freeform questions and any stored draft snapshots.
1. Shared runtime shell returns cancel or structured submit.
1. `applyQnaDraftSnapshot()` or `applyQnaStructuredSubmitResult()` mutates branch-local state.
1. Tool settles the loop only for `no_user_response`, explicit `complete`, or when no open records remain.

## Current data/model shapes

- `QnaBranchStateSnapshot`
  - `durableBoundaryEntryId?: string`
  - `nextQuestionSequence: number`
  - `questions: QnaLedgerQuestionRecord[]`
  - `runtimeDraftsByQuestionId: Record<string, QuestionRuntimeQuestionDraft>`

- `QnaLedgerQuestionRecord`
  - Shared base: `questionId`, `questionText`, `questionFingerprint`, `sendState`
  - Authoritative states:
    - `open`
    - `answered { submittedOutcome }`
    - `skipped { submittedOutcome }`
    - `needs_clarification { submittedOutcome }`
    - `answered_in_chat`
    - `superseded { supersededByQuestionId }`

- `QnaLedgerSendState`
  - `localRevision`
  - `lastSentRevision`
  - optional `lastSentAt`

## Current UI/rendering flow

- Visible QnA UI today is split across:
  - `/qna` command notifications
  - shared runtime form shell launched from the `qna` tool
- There is no browsing surface for already persisted records.
- There is no user-facing state filter, send action, or export action.

## Reusable pieces that should be preserved

- `QnaBranchStateStore` as the only persistence seam for branch-local ordinary QnA state.
- Existing authoritative record union and send metadata.
- Shared runtime form shell for answer capture and note editing.
- Loop controller as the only place that activates/deactivates the `qna` tool.
- Current revision bump behavior in transcript reconciliation and structured submit paths.

## Friction, duplication, or missing seams

- There is no command or overlay for browsing historical records.
- `tool.ts` hardcodes “open-only” request compilation, which blocks reuse for editing closed ledger records.
- `runtime-submit.ts` has no single-record mutation path and no direct reopen helper.
- Send metadata exists but has no reader, payload schema, or persistence update path.
- Export-to-disk does not exist.
- Current loop metadata is branded as a manual `/qna` loop, which is too narrow for ledger-triggered clarification follow-up.
- Shared runtime submit results do not emit an explicit “reopened to open” outcome, so direct reopen should be a first-class ledger mutation rather than inferred only from form submit.
- `tool.ts` and `runtime-submit.ts` are intentionally open-only today; task-06 should preserve that submit contract and use ledger-send loop reactivation for chat follow-up context rather than widening structured submit semantics to `needs_clarification`, `answered_in_chat`, or `superseded` records.

## 5. Target Architecture

## Proposed modules and responsibilities

- `extensions/qna/ledger-command.ts`
  - Registers `/qna-ledger`.
  - Owns the command loop that repeatedly shows the overlay, dispatches edit/send/export actions, persists results, and notifies the user.

- `extensions/qna/ledger-overlay.ts`
  - Pure TUI interaction surface for list browsing, filter selection, record selection, and action dispatch.
  - No persistence or file I/O.

- `extensions/qna/runtime-request.ts`
  - Shared builder for converting ledger records plus stored drafts into `AuthorizedQuestionRequest` payloads.
  - Used by both `tool.ts` and `/qna-ledger` single-record editing.

- `extensions/qna/ledger-records.ts`
  - Pure single-record ledger mutations for overlay editing and reopen.
  - Owns “edit current record immediately” semantics and revision bumps for non-transcript edits.

- `extensions/qna/send.ts`
  - Pure delta detection, batch payload construction, `needs_clarification` detection, and send-state advancement.

- `extensions/qna/markdown-export.ts`
  - Deterministic Markdown formatter and repo-root file writer.

- `extensions/qna/loop-controller.ts` + `extensions/qna/loop-control-message.ts`
  - Slightly generalized to support a ledger-send loop source and reviewable-question list, without breaking current `/qna` behavior.

- `extensions/qna/tool.ts`
  - Reuses the shared runtime-request builder and loop-controller eligibility metadata instead of reimplementing open-only request assembly.

## Data flow from command entry to final persisted or emitted result

1. User runs `/qna-ledger`.
1. Command hydrates `qna.state` from current branch.
1. Overlay renders filtered records using authoritative states.
1. User picks an action:
   - `edit` → command builds one shared runtime request for the selected record, opens form shell, applies the resulting single-record mutation, persists immediately, then reopens overlay.
   - `reopen` → command applies a direct ledger mutation to `state: "open"`, persists immediately, then reopens overlay.
   - `send_updates` → command builds one structured delta payload from records where `localRevision > lastSentRevision`; when no item needs clarification, it sends only the hidden ledger-batch steer message. When any item needs clarification, it first emits the hidden ledger-batch steer message with `triggerTurn: false`, then starts or refreshes the ledger-send loop so the kickoff steer message is the single turn-triggering event. After successful emission, it advances send metadata, persists, then reopens overlay.
   - `export_markdown` → command formats and writes the snapshot under `docs/qna/`, notifies, then reopens overlay.
1. User exits overlay.

## Reusable abstractions to introduce or strengthen

- Shared ledger-to-runtime request builder so `/qna` tool and `/qna-ledger` do not fork request construction or draft restoration.
- Pure single-record mutation helpers instead of embedding edit semantics in command/UI code.
- Pure send-delta builder/marker so batching logic is not duplicated between UI, tests, and future automation.
- Source-aware loop metadata so clarification-triggered reactivation uses the same controller instead of special-casing active tools in command code.

## Clear boundaries between runtime, validation, storage, UI, and command orchestration

- **Runtime shell:** `extensions/question-runtime/form-shell.ts`
- **Runtime request compilation:** `extensions/qna/runtime-request.ts`
- **Ledger mutation rules:** `extensions/qna/ledger-records.ts`, `extensions/qna/runtime-submit.ts`, `extensions/qna/reconcile.ts`
- **Persistence:** `extensions/qna/branch-state.ts`
- **Loop lifecycle:** `extensions/qna/loop-controller.ts`, `extensions/qna/loop-control-message.ts`
- **UI overlay:** `extensions/qna/ledger-overlay.ts`
- **Send batching:** `extensions/qna/send.ts`
- **Export I/O:** `extensions/qna/markdown-export.ts`
- **Command orchestration:** `extensions/qna/command.ts`, `extensions/qna/ledger-command.ts`

```text
user runs /qna-ledger
        |
        v
hydrate QnaBranchStateStore
        |
        v
showQnaLedgerOverlay()
        |
        +--> edit record --------> buildQnaRuntimeRequest()
        |                          |
        |                          v
        |                   showQuestionRuntimeFormShell()
        |                          |
        |                          v
        |                 applyQnaLedgerRecordEdit()
        |                          |
        |                          v
        |                 store.replaceSnapshot()
        |
        +--> reopen record -------> reopenQnaLedgerQuestion()
        |                          |
        |                          v
        |                 store.replaceSnapshot()
        |
        +--> send updates --------> buildQnaLedgerSendBatch()
        |                          |
        |        if needs_clarification -> loopController.startLoop(...)
        |                          |
        |                          v
        |                  pi.sendMessage(...steer...)
        |                          |
        |                          v
        |                  markQnaLedgerItemsSent()
        |                          |
        |                          v
        |                  store.replaceSnapshot()
        |
        +--> export markdown -----> writeQnaLedgerMarkdownSnapshot()
        |
        v
      close
```

## 6. File-by-File Implementation Plan

### File Plan — `extensions/qna.ts`

- `Action:` `modify`

- `Why:` The extension entrypoint must register the new `/qna-ledger` command alongside existing `/qna` and `qna` loop wiring.

- `Responsibilities:`
  - Keep one shared `QnaLoopController` instance.
  - Register both `/qna` and `/qna-ledger` with that controller.

- `Planned exports / signatures:`

  ```ts
  export default function qnaExtension(pi: ExtensionAPI): void;
  ```

- `Key logic to add or change:` Import and call `registerQnaLedgerCommand(pi, { loopController, getAttachedInterviewSessionId: getAttachedInterviewSessionIdFromBranch })`.

- `Dependencies:` `extensions/qna/command.ts`, `extensions/qna/ledger-command.ts`, `extensions/qna/interview-attachment.ts`, `extensions/qna/tool.ts`, `extensions/qna/loop-controller.ts`

- `Risks / notes:` Keep the top-level documentation header accurate; do not disturb existing `/qna` registration order or lifecycle hookup.

### File Plan — `extensions/qna/types.ts`

- `Action:` `modify`

- `Why:` Shared ledger browser, send batching, and loop-source metadata need explicit product-owned types.

- `Responsibilities:`
  - Preserve the authoritative ledger union.
  - Add shared filter, loop-source, reviewable-question, and send-batch contracts.

- `Planned exports / signatures:`

  ```ts
  export type QnaLedgerRecordState = QnaLedgerQuestionRecord["state"];
  export type QnaLedgerFilter = "all" | QnaLedgerRecordState;

  export type QnaLoopSource = "manual_qna" | "qna_ledger_send";

  export interface QnaLoopQuestionReference {
    questionId: string;
    questionText: string;
    state: "open";
  }

  export interface QnaLedgerSendItem {
    questionId: string;
    questionText: string;
    state: QnaLedgerRecordState;
    localRevision: number;
    lastSentRevision: number;
    submittedOutcome?: SubmittedQuestionRuntimeQuestionOutcome;
    supersededByQuestionId?: string;
  }

  export interface QnaLedgerSendBatch {
    schemaVersion: 1;
    type: "ordinary_qna_ledger_updates";
    sentAt: string;
    requiresClarification: boolean;
    items: QnaLedgerSendItem[];
  }
  ```

- `Key logic to add or change:` Prefer additive type changes. Keep current `QnaToolInput`/`QnaToolResultDetails` stable unless loop-controller generalization requires the question-reference type to widen.

- `Dependencies:` `extensions/qna/loop-controller.ts`, `extensions/qna/tool.ts`, `extensions/qna/send.ts`, `extensions/qna/ledger-overlay.ts`

- `Risks / notes:` Avoid renaming existing record-state fields unless every current test and serializer path is updated together.

### File Plan — `extensions/qna/loop-control-message.ts`

- `Action:` `modify`

- `Why:` Ledger-triggered reactivation needs source-aware kickoff details so prompt shaping and loop filtering stay explicit.

- `Responsibilities:`
  - Parse and build hidden loop kickoff messages.
  - Carry loop source and question ids safely.

- `Planned exports / signatures:`

  ```ts
  export interface QnaLoopKickoffDetails {
    type: "kickoff";
    loopId: string;
    source: QnaLoopSource;
    reviewQuestionIds: string[];
    discoverySummary?: string;
  }
  ```

- `Key logic to add or change:` Replace `openQuestionIds` with a more general review-question list and validate the new `source` field.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/qna/loop-controller.ts`

- `Risks / notes:` Keep backward-compatible parsing unnecessary; this is hidden ephemeral control data for the current branch/runtime only.

### File Plan — `extensions/qna/loop-controller.ts`

- `Action:` `modify`

- `Why:` Send-from-ledger clarification follow-up must reactivate the existing scoped `qna` tool without inventing a second activation path.

- `Responsibilities:`
  - Track active loop source and reviewable question ids.
  - Start loops for both `/qna` and `/qna-ledger` send reactivation.
  - Keep tool activation/deactivation centralized.

- `Planned exports / signatures:`

  ```ts
  export class QnaLoopController {
    isActive(): boolean;
    getAllowedQuestionIds(): string[];
    startLoop(input: {
      source: QnaLoopSource;
      reviewQuestions: QnaLoopQuestionReference[];
      discoverySummary?: string;
    }): { startedNewLoop: boolean; loopId: string };
    markSettled(reason: QnaLoopFinishReason): void;
  }
  ```

- `Key logic to add or change:`
  - Store `source` and `reviewQuestions` instead of an open-only list.
  - Adjust prompt copy so manual `/qna` still says manual loop while ledger-send copy explains that clarification follow-up may continue in ordinary chat and the structured `qna` tool still applies only to currently `open` review questions.
  - Expose current allowed ids so `tool.ts` can validate against the active loop scope.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/qna/loop-control-message.ts`

- `Risks / notes:` Do not weaken current “qna only while active loop exists” behavior. Session reset and restore behavior must remain intact.

### File Plan — `extensions/qna/runtime-request.ts`

- `Action:` `add`

- `Why:` Both the current `qna` tool and the new ledger editor need the same ledger-to-runtime request compilation and draft restoration logic.

- `Responsibilities:`
  - Convert ledger records into one or more `AuthorizedQuestionRequest` questions.
  - Reconstruct the best editable `QuestionRuntimeQuestionDraft` from branch-local runtime drafts and authoritative record state.

- `Planned exports / signatures:`

  ```ts
  export function buildQnaLedgerDraft(input: {
    record: QnaLedgerQuestionRecord;
    runtimeDraft?: QuestionRuntimeQuestionDraft;
  }): QuestionRuntimeQuestionDraft;

  export function buildQnaRuntimeRequest(input: {
    state: QnaBranchStateSnapshot;
    questionIds: string[];
    allowedStates: QnaLedgerRecordState[];
  }): AuthorizedQuestionRequest;
  ```

- `Key logic to add or change:`
  - Prefer `runtimeDraftsByQuestionId[questionId]` when present.
  - Otherwise synthesize a draft from `submittedOutcome` for `answered` / `skipped` / `needs_clarification`.
  - Fall back to an empty open freeform draft for `open`, `answered_in_chat`, and `superseded`.
  - Make the per-state synthesis explicit so a cold agent does not guess:
    - `answered` → `closureState: "open"` with a reconstructed answer draft and preserved note.
    - `skipped` → `closureState: "skipped"` with an empty answer draft and `questionNote` from `submittedOutcome.note ?? ""`.
    - `needs_clarification` → `closureState: "needs_clarification"` with preserved hidden answer draft when available, otherwise an empty answer draft, and `questionNote` from `submittedOutcome.note`.
    - `answered_in_chat` / `superseded` → empty open draft so the user can author a replacement authoritative outcome from scratch.
  - Reuse the same freeform prompt/justification text shape currently embedded in `tool.ts`.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/question-runtime/types.ts`

- `Risks / notes:` Current ordinary-QnA records are freeform in practice; if future records are not freeform, synthesis should degrade safely rather than invent invalid answer drafts.

### File Plan — `extensions/qna/tool.ts`

- `Action:` `modify`

- `Why:` The loop-scoped tool should stop owning bespoke request-building logic and should respect loop-controller eligibility metadata.

- `Responsibilities:`
  - Preserve the current `qna` tool contract.
  - Reuse shared runtime-request building.
  - Validate requested question ids against the active loop scope instead of a locally recomputed open-only set.
  - Preserve the existing open-only structured-submit semantics even during ledger-send follow-up loops.

- `Planned exports / signatures:`

  ```ts
  export interface RegisterQnaToolOptions {
    loopController: QnaLoopController;
    showForm?: typeof showQuestionRuntimeFormShell;
  }

  export function registerQnaTool(pi: ExtensionAPI, options: RegisterQnaToolOptions): void;
  ```

- `Key logic to add or change:`
  - Replace local `buildQuestionRuntimeRequest()` with the new shared builder.
  - Ensure `question_batch` accepts only ids allowed by the active loop controller.
  - Keep current `/qna` semantics by having `/qna` start loops with open-only review questions.
  - For `source: "qna_ledger_send"`, continue rejecting any non-`open` id; clarification follow-up is handled in chat and later `/qna-ledger` edits, not through widened `qna` submit behavior.

- `Dependencies:` `extensions/qna/runtime-request.ts`, `extensions/qna/loop-controller.ts`, `extensions/qna/runtime-submit.ts`

- `Risks / notes:` Do not accidentally make `qna` available outside an active loop or allow stale ids after branch state changed.

### File Plan — `extensions/qna/ledger-records.ts`

- `Action:` `add`

- `Why:` Ledger-overlay editing needs pure single-record mutation rules distinct from transcript reconciliation and loop batch submit.

- `Responsibilities:`
  - Reopen a closed record to `open`.
  - Apply a single-record shared-runtime submit result to any editable ledger record.
  - Keep draft persistence and revision bumps consistent.

- `Planned exports / signatures:`

  ```ts
  export function reopenQnaLedgerQuestion(input: {
    state: QnaBranchStateSnapshot;
    questionId: string;
  }): QnaBranchStateSnapshot;

  export function applyQnaLedgerQuestionEdit(input: {
    state: QnaBranchStateSnapshot;
    questionId: string;
    draftSnapshot: QuestionRuntimeQuestionDraft[];
    submitResult: QuestionRuntimeStructuredSubmitResult;
  }): {
    nextState: QnaBranchStateSnapshot;
    changed: boolean;
    nextQuestionState: QnaLedgerRecordState;
  };
  ```

- `Key logic to add or change:`
  - Persist returned draft snapshots for the selected question on both cancel and submit paths; reject snapshots that contain ids other than the selected question.
  - Accept at most one submitted outcome for the selected question and map it into authoritative state regardless of prior ledger state.
  - Make the transition rules explicit: any submit may land in `answered`, `skipped`, or `needs_clarification`; direct overlay `reopen` is the only path that lands in authoritative `open`.
  - Bump `sendState.localRevision` only when the authoritative state or stored submitted outcome actually changed; draft-only persistence on cancel must not mark the record as sent or changed.
  - Treat explicit overlay `reopen` as the authoritative path for moving closed records back to `open`.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/question-runtime/types.ts`

- `Risks / notes:` Avoid duplicating batch semantics already covered by `runtime-submit.ts`; this file should stay focused on one-record ledger edits.

### File Plan — `extensions/qna/send.ts`

- `Action:` `add`

- `Why:` Send batching and revision advancement should be pure, testable, and reusable instead of embedded in the command/UI layer.

- `Responsibilities:`
  - Detect unsent changed records.
  - Build the single structured batch payload.
  - Mark records as sent after emission.
  - Identify clarification-triggered follow-up.

- `Planned exports / signatures:`

  ```ts
  export const QNA_LEDGER_SEND_CUSTOM_TYPE = "qna.ledger.send";

  export function getPendingQnaLedgerSendItems(state: QnaBranchStateSnapshot): QnaLedgerSendItem[];

  export function buildQnaLedgerSendBatch(input: {
    state: QnaBranchStateSnapshot;
    sentAt: string;
  }): QnaLedgerSendBatch;

  export function markQnaLedgerItemsSent(input: {
    state: QnaBranchStateSnapshot;
    sentAt: string;
    questionIds: string[];
  }): QnaBranchStateSnapshot;

  export function buildQnaLedgerSendMessage(batch: QnaLedgerSendBatch): {
    customType: string;
    content: string;
    display: false;
    details: QnaLedgerSendBatch;
  };
  ```

- `Key logic to add or change:`
  - Select only `localRevision > lastSentRevision` records.
  - Serialize authoritative record fields needed by the agent: question id/text, state, submitted outcome when present, and `supersededByQuestionId` when present.
  - Keep message transport deterministic: the send helper returns only the hidden message payload; `ledger-command.ts` owns whether it is emitted with `triggerTurn: false` or paired with a loop kickoff message.
  - Advance `lastSentRevision` to `localRevision` and stamp `lastSentAt` for sent records.

- `Dependencies:` `extensions/qna/types.ts`

- `Risks / notes:` If `pi.sendMessage(...)` throws, the caller must not persist marked-as-sent state.

### File Plan — `extensions/qna/markdown-export.ts`

- `Action:` `add`

- `Why:` Export formatting and file-system writing should stay isolated from overlay/command logic.

- `Responsibilities:`
  - Produce deterministic Markdown for the full ordinary ledger.
  - Resolve repo root, ensure `docs/qna/` exists, and write the snapshot file.

- `Planned exports / signatures:`

  ```ts
  export interface QnaLedgerMarkdownExportResult {
    absolutePath: string;
    projectRelativePath: string;
  }

  export function formatQnaLedgerMarkdownSnapshot(input: {
    state: QnaBranchStateSnapshot;
    exportedAt: string;
  }): string;

  export async function writeQnaLedgerMarkdownSnapshot(input: {
    exec: Parameters<typeof resolveProjectRoot>[0];
    cwd: string;
    state: QnaBranchStateSnapshot;
    now?: Date;
  }): Promise<QnaLedgerMarkdownExportResult>;
  ```

- `Key logic to add or change:`
  - Resolve git top-level with `resolveProjectRoot(...)`.
  - Create `docs/qna/` if missing.
  - Generate a sortable UTC timestamped filename such as `qna-ledger-2026-04-11T15-02-09Z.md`.
  - Render deterministic Markdown in this fixed order: document title, exported-at metadata, one summary table of counts by state, then grouped sections for `open`, `needs_clarification`, `answered`, `skipped`, `answered_in_chat`, and `superseded`, with each record showing `questionId`, `questionText`, send revision info, and any `submittedOutcome` / `supersededByQuestionId` details.

- `Dependencies:` `node:fs/promises`, `node:path`, `extensions/qna/types.ts`, `extensions/question-runtime/request-paths.ts`

- `Risks / notes:` Keep output deterministic for tests by allowing injected `now`.

### File Plan — `extensions/qna/ledger-overlay.ts`

- `Action:` `add`

- `Why:` The task needs a dedicated branch-local overlay for browsing/filtering and dispatching actions.

- `Responsibilities:`
  - Render the filterable ledger list and selected-record detail panel.
  - Return high-level actions to the command loop.
  - Preserve view-only state such as current filter and selected record between iterations.

- `Planned exports / signatures:`

  ```ts
  export interface QnaLedgerOverlayViewState {
    filter: QnaLedgerFilter;
    selectedQuestionId?: string;
  }

  export type QnaLedgerOverlayAction =
    | { kind: "close" }
    | { kind: "edit"; questionId: string }
    | { kind: "reopen"; questionId: string }
    | { kind: "send_updates" }
    | { kind: "export_markdown" };

  export async function showQnaLedgerOverlay(
    ctx: ExtensionContext,
    input: {
      state: QnaBranchStateSnapshot;
      viewState: QnaLedgerOverlayViewState;
    },
  ): Promise<{ action: QnaLedgerOverlayAction; viewState: QnaLedgerOverlayViewState }>;
  ```

- `Key logic to add or change:`
  - Render state filter options (`all`, `open`, `answered`, `skipped`, `needs_clarification`, `answered_in_chat`, `superseded`).
  - Show pending-send marker when `localRevision > lastSentRevision`.
  - Expose keyboard actions for edit, reopen, send, export, and close.
  - Disable `reopen` when the selected record is already `open`.
  - When the current selection disappears because of a filter change or edit, fall back to the next visible record or clear selection deterministically.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/shared/option-picker.ts` as a style reference only

- `Risks / notes:` Keep this file UI-only. No `pi.appendEntry`, no file writes, no direct loop activation.

### File Plan — `extensions/qna/ledger-command.ts`

- `Action:` `add`

- `Why:` `/qna-ledger` needs a command orchestrator separate from transcript reconciliation.

- `Responsibilities:`
  - Register the command.
  - Hydrate latest branch-local ledger state.
  - Run the overlay/edit/send/export command loop.
  - Persist every mutation immediately.
  - Reuse the existing interview chat-attachment guard.

- `Planned exports / signatures:`

  ```ts
  export interface QnaLedgerCommandOptions {
    loopController: QnaLoopController;
    getAttachedInterviewSessionId: (branch: SessionEntry[]) => string | null;
    showForm?: typeof showQuestionRuntimeFormShell;
    now?: () => Date;
  }

  export function registerQnaLedgerCommand(
    pi: ExtensionAPI,
    options: QnaLedgerCommandOptions,
  ): void;

  export async function runQnaLedgerCommand(
    pi: ExtensionAPI,
    ctx: ExtensionCommandContext,
    options: QnaLedgerCommandOptions,
  ): Promise<void>;
  ```

- `Key logic to add or change:`
  - Require interactive UI mode.
  - Reuse `getAttachedInterviewSessionIdFromBranch(...)` and block `/qna-ledger` in interview-attached chats with the same warning pattern as `/qna`.
  - Rehydrate store before each action dispatch so overlay operations cannot act on stale branch state.
  - On `edit`, build a one-question request with `buildQnaRuntimeRequest(...)`, launch the shared form shell, persist cancel drafts or applied submit result immediately.
  - On `reopen`, call `reopenQnaLedgerQuestion(...)`, persist, notify, and reopen overlay.
  - On `send_updates`, no-op with notification when there is no delta; otherwise build the batch, emit the hidden ledger-send message first, and when clarification is present follow it by `loopController.startLoop({ source: "qna_ledger_send", ... })` so the kickoff message is the only turn-triggering event. Persist `markQnaLedgerItemsSent(...)` only after both emissions succeed, then notify and reopen overlay.
  - On `export_markdown`, call `writeQnaLedgerMarkdownSnapshot(...)`, notify path, and reopen overlay.

- `Dependencies:` `extensions/qna/branch-state.ts`, `extensions/qna/interview-attachment.ts`, `extensions/qna/ledger-overlay.ts`, `extensions/qna/runtime-request.ts`, `extensions/qna/ledger-records.ts`, `extensions/qna/send.ts`, `extensions/qna/markdown-export.ts`, `extensions/qna/loop-controller.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/request-validator.ts`

- `Risks / notes:` Remember the repo rule: extension changes require a reload before manual testing.

### File Plan — `extensions/qna/command.ts`

- `Action:` `modify`

- `Why:` `/qna` should continue to use the generalized loop-controller API after task-06 broadens loop metadata.

- `Responsibilities:`
  - Preserve current `/qna` transcript-reconciliation behavior.
  - Start loops through the widened controller contract.

- `Planned exports / signatures:`

  ```ts
  export interface QnaCommandOptions {
    loopController: QnaLoopController;
    getAttachedInterviewSessionId: (branch: SessionEntry[]) => string | null;
  }
  ```

- `Key logic to add or change:` Replace open-question `startLoop(...)` calls with `source: "manual_qna"` and review-question references shaped for the widened controller type.

- `Dependencies:` `extensions/qna/loop-controller.ts`, `extensions/qna/reconcile.ts`

- `Risks / notes:` Do not change transcript scanning, model reconciliation, or interview guard semantics.

### File Plan — `extensions/qna/runtime-submit.ts`

- `Action:` `modify`

- `Why:` Task-06 adds another product-owned edit path, so shared mutation helpers should be extracted rather than duplicated.

- `Responsibilities:`
  - Keep current batch submit behavior intact.
  - Share any record-transition helpers needed by `ledger-records.ts`.

- `Planned exports / signatures:`

  ```ts
  export function applyQnaDraftSnapshot(
    state: QnaBranchStateSnapshot,
    draftSnapshot: QuestionRuntimeQuestionDraft[],
  ): QnaBranchStateSnapshot;

  export function applyQnaStructuredSubmitResult(input: { ... }): { ... };
  ```

- `Key logic to add or change:` Extract any reusable revision-bump or outcome-to-record mapping helpers that would otherwise be copied into `ledger-records.ts`.

- `Key logic to add or change:` Extract named helpers such as `applySubmittedOutcomeToLedgerRecord(...)` and `didLedgerRecordAuthoritativeStateChange(...)` so both batch `/qna` submit and single-record ledger edit reuse the same outcome-mapping rules.

- `Dependencies:` `extensions/qna/types.ts`, `extensions/question-runtime/types.ts`

- `Risks / notes:` Keep task-05 behavior unchanged for untouched open questions and `no_user_response` handling.

### File Plan — `extensions/qna/branch-state.ts`

- `Action:` `do not modify unless implementation proves a concrete parser or clone gap`

- `Why:` The existing store already persists authoritative records plus runtime drafts. Task-06 should preserve it as the sole persistence seam rather than churn it speculatively.

- `Responsibilities:`
  - Remain the only durable branch-state persistence seam.
  - Continue safe parse/clone behavior for all ledger states.

- `Planned exports / signatures:`

  ```ts
  export class QnaBranchStateStore {
    hydrateFromBranch(entries: SessionEntry[]): void;
    getSnapshot(): QnaBranchStateSnapshot;
    needsPersistedHydration(): boolean;
    replaceSnapshot(snapshot: QnaBranchStateSnapshot): void;
  }
  ```

- `Key logic to add or change:` None planned. Only touch this file if additive type changes truly require parse/clone alignment during implementation.

- `Dependencies:` `extensions/qna/types.ts`

- `Risks / notes:` Do not weaken snapshot validation or branch-hydration behavior. If no concrete need appears, leave this file untouched.

### File Plan — `extensions/qna/loop-control-message.test.ts`

- `Action:` `modify`
- `Why:` The kickoff payload gains `source` and `reviewQuestionIds`, so the hidden-message contract needs direct coverage.
- `Responsibilities:`
  - Verify valid kickoff messages parse with `source` and reviewable ids.
  - Verify stale or malformed kickoff payloads are rejected.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Update fixtures to include `source: "manual_qna" | "qna_ledger_send"` and `reviewQuestionIds` instead of `openQuestionIds`.
- `Dependencies:` `extensions/qna/loop-control-message.ts`
- `Risks / notes:` Keep the contract strict because loop context filtering depends on it.

### File Plan — `extensions/qna/loop-controller.test.ts`

- `Action:` `modify`
- `Why:` Controller behavior now needs coverage for ledger-send source and reviewable-question tracking.
- `Responsibilities:`
  - Verify tool activation still scopes correctly.
  - Verify the kickoff message and prompt copy reflect the new source-aware contract.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Add coverage for `source: "qna_ledger_send"`, `getAllowedQuestionIds()`, and source-specific prompt copy.
- `Dependencies:` `extensions/qna/loop-controller.ts`
- `Risks / notes:` Preserve existing task-05 assertions around activation/deactivation and restore behavior.

### File Plan — `extensions/qna/tool.test.ts`

- `Action:` `modify`
- `Why:` Tool request-building and eligibility validation move to shared seams.
- `Responsibilities:`
  - Keep current loop tool behavior covered.
  - Add assertions that stale or disallowed ids are rejected through the generalized controller path.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Update tests to expect shared request builder usage and loop-controller-based eligibility.
- `Dependencies:` `extensions/qna/tool.ts`, `extensions/qna/runtime-request.ts`
- `Risks / notes:` Avoid rewriting unrelated task-05 coverage.

### File Plan — `extensions/qna/ledger-records.test.ts`

- `Action:` `add`
- `Why:` Single-record edit/reopen rules are new pure behavior and should be unit-tested directly.
- `Responsibilities:`
  - Cover reopen from each closed state.
  - Cover answered/skipped/needs-clarification edit submits.
  - Cover no-op draft-only submit and revision bump behavior.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Include cases for `answered_in_chat` and `superseded` becoming editable via a new submitted outcome.
- `Dependencies:` `extensions/qna/ledger-records.ts`
- `Risks / notes:` Verify only changed authoritative state bumps `localRevision`.

### File Plan — `extensions/qna/runtime-request.test.ts`

- `Action:` `add`
- `Why:` Draft synthesis for closed records is easy to regress and should stay independent from command/UI tests.
- `Responsibilities:`
  - Cover runtime-draft precedence.
  - Cover reconstruction from `submittedOutcome`.
  - Cover empty fallback for transcript-closed records.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Assert request validation passes for requests built from both open and previously closed records.
- `Dependencies:` `extensions/qna/runtime-request.ts`
- `Risks / notes:` Keep fixtures small and freeform-oriented.

### File Plan — `extensions/qna/send.test.ts`

- `Action:` `add`
- `Why:` Send batching and send-revision advancement are pure business rules with no existing coverage.
- `Responsibilities:`
  - Cover delta selection.
  - Cover payload shape.
  - Cover `needs_clarification` detection.
  - Cover `lastSentRevision` / `lastSentAt` advancement.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Include mixed-state fixtures so transcript-closed items and structured-outcome items both serialize correctly.
- `Dependencies:` `extensions/qna/send.ts`
- `Risks / notes:` Make the expected payload explicit enough that later agents do not silently drift the schema.

### File Plan — `extensions/qna/markdown-export.test.ts`

- `Action:` `add`
- `Why:` Snapshot output must be deterministic and path-safe.
- `Responsibilities:`
  - Cover filename generation.
  - Cover grouped Markdown rendering.
  - Cover repo-root-relative output path resolution through injected/stubbed dependencies where practical.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Use a fixed timestamp and a mixed-state ledger fixture.
- `Dependencies:` `extensions/qna/markdown-export.ts`
- `Risks / notes:` Keep tests stable by injecting `now` rather than depending on real clock values.

### File Plan — `extensions/qna/ledger-command.test.ts`

- `Action:` `add`
- `Why:` Command orchestration needs focused coverage for send/export/edit flows without broad repo archaeology by the implementing agent.
- `Responsibilities:`
  - Verify interactive guard.
  - Verify `send_updates` no-op vs batched-send persistence.
  - Verify clarification-triggered loop reactivation.
  - Verify export path notification.
- `Planned exports / signatures:` none
- `Key logic to add or change:` Mock overlay actions and form-shell results so command logic can be tested without TUI snapshots.
- `Key logic to add or change:` Mock overlay actions and form-shell results so command logic can be tested without TUI snapshots; assert interview-guard blocking, stale-id rejection, no-op send, clarification-send message ordering, and export notifications.
- `Dependencies:` `extensions/qna/ledger-command.ts`, `extensions/qna/send.ts`, `extensions/qna/markdown-export.ts`
- `Risks / notes:` Prefer command-loop unit tests over brittle full-overlay rendering tests.

## Read-only reference context

- `docs/qna/qna-inbox-spec.md`
- `docs/qna/tasks/task-04/task-04.md`
- `docs/qna/tasks/task-05/task-05.md`
- `extensions/question-runtime/form-shell.ts`
- `extensions/question-runtime/form-state.ts`
- `extensions/question-runtime/types.ts`
- `extensions/question-runtime/request-paths.ts`
- `extensions/shared/option-picker.ts`

## 7. File Fingerprints

### Fingerprint — `extensions/qna.ts`

- `Reason this file changes:` Register the new `/qna-ledger` command.
- `Existing anchors to search for:` `import { registerQnaCommand } from "./qna/command.js";`, `export default function qnaExtension(pi: ExtensionAPI): void {`
- `New anchors expected after implementation:` `import { registerQnaLedgerCommand } from "./qna/ledger-command.js";`, `registerQnaLedgerCommand(pi, { loopController, getAttachedInterviewSessionId: getAttachedInterviewSessionIdFromBranch });`
- `Unsafe areas to avoid touching:` Existing loop-controller construction and lifecycle registration order.

### Fingerprint — `extensions/qna/types.ts`

- `Reason this file changes:` Add shared filter/send/loop metadata types.
- `Existing anchors to search for:` `export const QNA_STATE_ENTRY = "qna.state";`, `export interface QnaOpenQuestionReference {`, `export type QnaToolInput =`
- `New anchors expected after implementation:` `export type QnaLedgerFilter =`, `export type QnaLoopSource =`, `export interface QnaLoopQuestionReference {`, `export interface QnaLedgerSendBatch {`
- `Unsafe areas to avoid touching:` Existing `QnaLedgerQuestionRecord` discriminated-union field names and snapshot shape.

### Fingerprint — `extensions/qna/loop-control-message.ts`

- `Reason this file changes:` Kickoff details must become source-aware and review-question-aware.
- `Existing anchors to search for:` `export interface QnaLoopKickoffDetails {`, `openQuestionIds`, `buildQnaLoopKickoffMessage(`
- `New anchors expected after implementation:` `source:`, `reviewQuestionIds`, `QnaLoopSource`
- `Unsafe areas to avoid touching:` `QNA_LOOP_CONTROL_CUSTOM_TYPE` constant name.

### Fingerprint — `extensions/qna/loop-controller.ts`

- `Reason this file changes:` Generalize loop activation for ledger-send clarification reactivation.
- `Existing anchors to search for:` `interface ActiveLoopState {`, `startLoop(input: { openQuestions:`, `handleBeforeAgentStart(`, `formatOpenQuestions(`
- `New anchors expected after implementation:` `source:`, `reviewQuestions:`, `getAllowedQuestionIds(): string[]`, `qna_ledger_send`
- `Unsafe areas to avoid touching:` Tool restore logic in `restoreTools()` and session reset event hooks.

### Fingerprint — `extensions/qna/runtime-request.ts`

- `Reason this file changes:` New shared runtime-request/draft builder for both `/qna` and `/qna-ledger`.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export function buildQnaLedgerDraft(`, `export function buildQnaRuntimeRequest(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/tool.ts`

- `Reason this file changes:` Reuse shared request building and loop-controller eligibility.
- `Existing anchors to search for:` `function getOpenQuestions(`, `export function buildQuestionRuntimeRequest(`, `validateBatchInput(`, `qna is available only during an active /qna loop`
- `New anchors expected after implementation:` `import { buildQnaRuntimeRequest } from "./runtime-request.js";`, `options.loopController.getAllowedQuestionIds()`, `allowedStates`
- `Unsafe areas to avoid touching:` Existing tool name, parameter schema, and `complete` action contract.

### Fingerprint — `extensions/qna/ledger-records.ts`

- `Reason this file changes:` New pure single-record edit/reopen logic for ledger overlay.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export function reopenQnaLedgerQuestion(`, `export function applyQnaLedgerQuestionEdit(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/send.ts`

- `Reason this file changes:` New pure send-delta and payload module.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export const QNA_LEDGER_SEND_CUSTOM_TYPE = "qna.ledger.send";`, `export function getPendingQnaLedgerSendItems(`, `export function buildQnaLedgerSendBatch(`, `export function markQnaLedgerItemsSent(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/markdown-export.ts`

- `Reason this file changes:` New Markdown snapshot formatter and writer.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export function formatQnaLedgerMarkdownSnapshot(`, `export async function writeQnaLedgerMarkdownSnapshot(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/ledger-overlay.ts`

- `Reason this file changes:` New overlay UI for ledger browsing/filtering/actions.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export interface QnaLedgerOverlayViewState`, `export type QnaLedgerOverlayAction =`, `export async function showQnaLedgerOverlay(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/ledger-command.ts`

- `Reason this file changes:` New `/qna-ledger` command orchestration entrypoint.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `export interface QnaLedgerCommandOptions`, `export function registerQnaLedgerCommand(`, `export async function runQnaLedgerCommand(`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/command.ts`

- `Reason this file changes:` Adapt `/qna` to the generalized loop-controller API.
- `Existing anchors to search for:` `function maybeStartLoop(`, `options.loopController.startLoop({`, `export interface QnaCommandOptions {`
- `New anchors expected after implementation:` `source: "manual_qna"`, `reviewQuestions:`
- `Unsafe areas to avoid touching:` Transcript scan, model reconciliation, and interview-attachment guard branches.

### Fingerprint — `extensions/qna/runtime-submit.ts`

- `Reason this file changes:` Extract reusable transition helpers rather than duplicating edit logic.
- `Existing anchors to search for:` `function bumpRevision(`, `export function applyQnaDraftSnapshot(`, `export function applyQnaStructuredSubmitResult(`
- `New anchors expected after implementation:` `function`, `map`, or helper names used by both batch and single-record paths, plus preserved existing exports
- `Unsafe areas to avoid touching:` `no_user_response` branch semantics and untouched-open-question behavior.

### Fingerprint — `extensions/qna/branch-state.ts`

- `Reason this file changes:` Only if implementation proves an additive parser/clone alignment gap.
- `Existing anchors to search for:` `function cloneSnapshot(`, `function parseSnapshot(`, `export class QnaBranchStateStore`
- `New anchors expected after implementation:` none unless implementation proves a concrete additive parser/clone gap
- `Unsafe areas to avoid touching:` Runtime draft hydration logic after `QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE` entries.

### Fingerprint — `extensions/qna/loop-control-message.test.ts`

- `Reason this file changes:` Cover the widened kickoff message contract.
- `Existing anchors to search for:` `describe("loop-control-message", () => {`, `buildQnaLoopKickoffMessage`, `isQnaLoopKickoffMessage`
- `New anchors expected after implementation:` `source: "manual_qna"`, `source: "qna_ledger_send"`, `reviewQuestionIds`
- `Unsafe areas to avoid touching:` Keep message-role/customType fixtures aligned with `QNA_LOOP_CONTROL_CUSTOM_TYPE`.

### Fingerprint — `extensions/qna/loop-controller.test.ts`

- `Reason this file changes:` Add source-aware loop coverage.
- `Existing anchors to search for:` `describe("QnaLoopController", () => {`, `starts a new loop`, `restores question_runtime_request`
- `New anchors expected after implementation:` `qna_ledger_send`, `getAllowedQuestionIds`, `ledger send guidance`
- `Unsafe areas to avoid touching:` Existing baseline activation assertions.

### Fingerprint — `extensions/qna/tool.test.ts`

- `Reason this file changes:` Tool validation/request-building seams change.
- `Existing anchors to search for:` `describe("qna tool", () => {`, `rejects stale question ids`, `complete leaves older open items untouched`
- `New anchors expected after implementation:` assertions for loop-controller allowed ids or shared runtime request builder behavior
- `Unsafe areas to avoid touching:` Existing task-05 behavior expectations unrelated to request compilation.

### Fingerprint — `extensions/qna/ledger-records.test.ts`

- `Reason this file changes:` New unit coverage for single-record edit/reopen behavior.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `describe("ledger record edits", () => {`, `reopens closed records`, `edits answered_in_chat records`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/runtime-request.test.ts`

- `Reason this file changes:` New unit coverage for draft synthesis and request building.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `describe("buildQnaRuntimeRequest", () => {`, `prefers persisted runtime draft`, `reconstructs from submittedOutcome`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/send.test.ts`

- `Reason this file changes:` New unit coverage for send-delta batching.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `describe("QnA ledger send batching", () => {`, `sends only unsent revisions`, `marks records sent`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/markdown-export.test.ts`

- `Reason this file changes:` New unit coverage for deterministic Markdown export.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `describe("QnA ledger markdown export", () => {`, `writes timestamped file`, `groups by state`
- `Unsafe areas to avoid touching:` none

### Fingerprint — `extensions/qna/ledger-command.test.ts`

- `Reason this file changes:` New orchestration coverage for `/qna-ledger`.
- `Existing anchors to search for:` `none (new file)`
- `New anchors expected after implementation:` `describe("/qna-ledger command", () => {`, `sends pending updates in one batch`, `reactivates qna on clarification`, `exports markdown snapshot`
- `Unsafe areas to avoid touching:` none

## 8. Stepwise Execution Plan

1. **Add shared type contracts first.**
   - Update `extensions/qna/types.ts`.
   - Update `extensions/qna/loop-control-message.ts` and `extensions/qna/loop-control-message.test.ts` to carry source-aware kickoff details.
   - Safe to do before any UI or command work.

1. **Generalize loop lifecycle with tests.**
   - Update `extensions/qna/loop-controller.ts` and `extensions/qna/loop-controller.test.ts`.
   - Update `extensions/qna/command.ts` to call the widened `startLoop(...)` contract.
   - Checkpoint: existing `/qna` loop tests should still conceptually pass after API adaptation.

1. **Extract shared runtime-request building.**
   - Add `extensions/qna/runtime-request.ts` and `extensions/qna/runtime-request.test.ts`.
   - Refactor `extensions/qna/tool.ts` + `extensions/qna/tool.test.ts` to use the new builder.
   - This step is mostly independent from send/export UI work once the type changes are in.

1. **Add pure ledger edit helpers.**
   - Add `extensions/qna/ledger-records.ts` and `extensions/qna/ledger-records.test.ts`.
   - If needed, extract small reusable transition helpers from `extensions/qna/runtime-submit.ts`.
   - Checkpoint: verify revision-bump rules and reopen behavior in unit tests before any command wiring.

1. **Add pure send/export helpers.**
   - Add `extensions/qna/send.ts` + `extensions/qna/send.test.ts`.
   - Add `extensions/qna/markdown-export.ts` + `extensions/qna/markdown-export.test.ts`.
   - Lock the send-message ordering here: ledger batch first, kickoff second only when clarification follow-up should trigger a turn.
   - These two can be done in parallel after shared types are stable.

1. **Build the overlay UI.**
   - Add `extensions/qna/ledger-overlay.ts`.
   - Keep it action-returning only; do not mix persistence or file writes into the overlay.
   - This can proceed in parallel with step 5 once filter/action types are stable.

1. **Wire the `/qna-ledger` command.**
   - Add `extensions/qna/ledger-command.ts` and `extensions/qna/ledger-command.test.ts`.
   - Integrate overlay, the interview-attachment guard, shared runtime request building, single-record edit application, send batching, loop reactivation, and export writing.
   - Checkpoint: command tests should cover stale-id rejection, no-op send, clarification-triggered send ordering, and export path notification.

1. **Register the new command.**
   - Update `extensions/qna.ts` to register `/qna-ledger`.
   - This is quick and should happen after the command file exists.

1. **Run focused tests and manual verification.**
   - Run `bun test extensions/qna/*.test.ts`.
   - Reload the extension before manual UI testing because `extensions/` changed.
   - Manual checkpoints:
     - `/qna-ledger` opens and filters all authoritative states.
     - editing a closed record persists immediately
     - `Send updates` emits one batch and advances send metadata
     - `needs_clarification` send reactivates `qna`
     - export writes a timestamped file under `docs/qna/`

## 9. Validation Plan

## Unit / integration / manual verification needed

- **Unit**
  - `runtime-request.test.ts`: draft reconstruction and request validation.
  - `ledger-records.test.ts`: reopen and single-record edit semantics.
  - `send.test.ts`: unsent-delta selection, payload shape, send-state advancement.
  - `markdown-export.test.ts`: deterministic filename and Markdown rendering.
  - Updated `loop-control-message.test.ts`, `loop-controller.test.ts`, and `tool.test.ts`.

- **Command integration**
  - `ledger-command.test.ts` should verify orchestration using mocked overlay actions, mocked form-shell results, mocked clock/export helpers, the interview-attachment guard, and clarification-send message ordering.

- **Manual**
  1. Run `/qna-ledger` on a branch with mixed-state records and confirm all states, including `answered_in_chat` and `superseded`, are visible under filters.
  1. Edit an `answered` or `superseded` item, submit a new authoritative state, and confirm the branch-local ledger updates immediately.
  1. Reopen a previously closed item and confirm it becomes `open` and is marked unsent.
  1. Trigger `Send updates` when two or more records have pending revisions and confirm exactly one structured hidden payload is sent.
  1. Trigger `Send updates` with at least one `needs_clarification` item and confirm the ledger batch is emitted before the kickoff, the `qna` tool becomes active again for follow-up, and structured `qna` review remains limited to currently `open` items.
  1. Trigger export and confirm a new timestamped Markdown file lands under `docs/qna/`.

## Expected user-visible behavior

- `/qna-ledger` opens a simple overlay, not a transcript scan flow.
- Filter changes affect the list immediately without mutating storage.
- Record edits persist immediately after submit/reopen.
- Send action skips already-sent revisions and reports success only when there is a real delta.
- Export action reports the written path.

## Failure modes to test

- `/qna-ledger` invoked without UI should fail cleanly.
- Editing a record after branch state changed should rehydrate first and reject stale ids rather than mutating the wrong record.
- `Send updates` with zero pending deltas should not send an empty payload.
- `Send updates` should not mark revisions as sent if message emission throws.
- Clarification-triggered send should not trigger two separate agent turns.
- Export should fail cleanly when repo root cannot be resolved.
- Filtering to a state with zero records should render an empty-state list without crashing.

## Repo checks to run after TypeScript edits

- `bun test extensions/qna/*.test.ts`
- Rely on the local quiet-build harness for broader TypeScript validation.
- Do **not** run `mise run check` per repo guidance.

## 10. Resolved Decisions

- Decision: a hidden steer custom message (`qna.ledger.send`) satisfies the requirement for one structured send payload; no separate visible chat transcript message format is required.
- Decision: `/qna-ledger` reuses the existing interview chat-attachment guard and blocks in attached interview chats rather than showing mixed ordinary/interview maintenance UI.
- Decision: `/qna-ledger` uses the shared runtime form shell as the edit surface for answer/skip/needs-clarification, while direct `reopen` remains a ledger-native action.
- Decision: clarification-triggered ledger sends reactivate the scoped loop without widening `qna` submit semantics beyond currently `open` questions; clarification follow-up can continue in ordinary chat and later `/qna-ledger` edits.
- Decision: UTC sortable filenames under `docs/qna/` are acceptable as the timestamped export naming convention.
