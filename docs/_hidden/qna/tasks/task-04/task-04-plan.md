### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-04/task-04.md`
- `Task Title:` `Task 04 — /qna branch-local ledger and transcript reconciliation`
- `Task Signature:` `task-04-qna-branch-local-ledger-transcript-reconciliation`
- `Primary Code Scope:` `extensions/qna.ts`, `extensions/qna/*.ts`, `extensions/qna/*.test.ts`
- `Read-only Reference Scope:` `extensions/question-runtime/types.ts`, `extensions/question-runtime/repair-messages.ts`, `extensions/question-runtime/request-store.ts`, `extensions/question-runtime/index.ts`
- `Excluded Scope:` `external/`, `extensions/permissions/`, `/interview` workflow code, `/qna-ledger` overlay work, task-05 loop-control behavior, task-06 send/export behavior, and shared question-runtime shell internals beyond read-only type alignment

### 2. Executive Summary

This task should replace the current one-shot `/qna` popup with a hidden branch-local discovery pipeline that scans only new assistant and user transcript content, reconciles that slice against existing branch-local ordinary QnA records, and persists the result as branch-local session state. The visible command surface stays minimal in this task: run reconciliation, advance the durable boundary on success including no-op success, and notify the user.

The clean architecture is to move `/qna` into a thin command orchestrator above five reusable seams: branch-state persistence, boundary-aware transcript scanning, strict model-response normalization, deterministic recovery dedupe, and pure ledger reconciliation. Shared question-runtime files stay unchanged in this task; task 04 only prepares durable storage for shared-runtime drafts, while task 05 remains responsible for actually consuming `question-runtime.control` submit or cancel messages.

### 3. Requirement Map

1. **Requirement:** `/qna` shall treat ordinary QnA as a simple current-branch inbox.\`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` only inspects the last completed assistant message and immediately opens a local answer UI.
   - `Planned implementation move:` Replace the current last-message popup flow with a branch-state-backed inbox pipeline that loads branch-local hidden state, reconciles new transcript content, and persists ledger items for later `/qna` or `/qna-ledger` work.

1. **Requirement:** `/qna` shall treat capture as opportunistic for the current chat branch rather than a repo-scoped planning system.\`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` has no branch-local storage, no branch-aware state hydrate, and no durable boundary.
   - `Planned implementation move:` Persist one branch-local `qna.state` snapshot in session custom entries and hydrate strictly from `ctx.sessionManager.getBranch()` so state follows branch ancestry and never becomes repo-global.

1. **Requirement:** `The system shall maintain a hidden branch-local QnA ledger in session state.`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/question-runtime/request-store.ts` already shows the branch-local persistence pattern via `pi.appendEntry(...)`, but `/qna` has no equivalent state entry.
   - `Planned implementation move:` Add a dedicated `QNA_STATE_ENTRY` snapshot type plus a `QnaBranchStateStore` that hydrates the latest valid snapshot from current-branch custom entries and persists full replacements.

1. **Requirement:** `The branch-local QnA ledger shall track ordinary QnA question records, answer states, notes, unsent edits, and send state.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/question-runtime/types.ts` already defines structured submitted outcomes and draft shapes, but `/qna` stores nothing.
   - `Planned implementation move:` Define a product-owned ledger record that stores stable `questionId`, current `questionText`, a deterministic recovery fingerprint, one authoritative question state, per-record send revision metadata, and branch-local runtime drafts keyed by `questionId`.

1. **Requirement:** `Each ordinary QnA record shall have one authoritative state, at minimum open, answered, skipped, needs_clarification, answered_in_chat, or superseded.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `/qna` has no durable record model, and `QuestionRuntimeQuestionOutcome` alone cannot represent transcript-closed states like `answered_in_chat` or `superseded`.
   - `Planned implementation move:` Use a product-owned discriminated union for ledger records. Reuse shared submitted-outcome payload shapes only for `answered`, `skipped`, and `needs_clarification`, while `open`, `answered_in_chat`, and `superseded` remain product-owned states.

1. **Requirement:** `/qna` shall persist the shared runtime's latest draftSnapshot keyed by questionId so cancelled edits and hidden inactive branch drafts can be restored later.\`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/question-runtime/types.ts` defines `QuestionRuntimeQuestionDraft`; `extensions/question-runtime/repair-messages.ts` and `extensions/question-runtime/index.ts` already emit `draftSnapshot` on `form_submitted` and `form_cancelled`, but `/qna` does not store it.
   - `Planned implementation move:` Add `runtimeDraftsByQuestionId` to branch state now and make it round-trippable in the snapshot. Task 04 stops at durable storage groundwork; task 05 will consume the hidden control-message payloads and update this map.

1. **Requirement:** `The system shall maintain a branch-local durable scan boundary so repeated /qna runs do not rescan the full session.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` has no state or transcript boundary at all.
   - `Planned implementation move:` Store `durableBoundaryEntryId` in branch state and add a transcript scanner that walks backward only until that entry, then builds the assistant or user slice after it.

1. **Requirement:** `When the user forks a pi session, the ordinary QnA ledger, durable scan boundary, and unsent edits shall fork with that branch.`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/question-runtime/request-store.ts` already relies on session custom entries, which naturally fork with branches once written.
   - `Planned implementation move:` Use the same branch-entry persistence model for `qna.state`; no extra fork-specific code should be needed beyond hydrating from the current branch path.

1. **Requirement:** `When /qna runs, the system shall inspect only assistant and user transcript content plus branch-local ordinary QnA ledger state.`
   - `Status:` `partially satisfied`
   - `Current files/functions/types that relate:` `extensions/qna.ts#getLastAssistantMessageText()` already filters to assistant text parts only, but it ignores user messages and ledger state.
   - `Planned implementation move:` Add a pure transcript collector that inspects only raw `SessionEntry` values where `entry.type === "message"`, keeps only `message.role === "user"` or `"assistant"`, skips incomplete assistant messages, and passes that slice plus unresolved open ledger records into the model prompt.

1. **Requirement:** `When /qna runs, the system shall stop transcript scanning at the most recent durable boundary.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no current boundary logic exists.
   - `Planned implementation move:` `collectQnaTranscriptSinceBoundary(...)` should stop once it reaches `durableBoundaryEntryId`, exclude that boundary entry from prompt content, and then reverse the collected slice back into chronological order for prompting.

1. **Requirement:** `When the stored durable boundary is missing from the current branch, /qna shall fall back to a full current-branch scan and shall not duplicate already tracked questions as net-new items.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no current boundary recovery logic exists.
   - `Planned implementation move:` Have the scanner report whether the stored boundary was found. On recovery full scans only, run deterministic question-text fingerprint dedupe against all existing records before creating net-new ledger items.

1. **Requirement:** `When QnA processing completes successfully, including the no-unresolved case, the system shall advance the durable boundary.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` no current success checkpoint exists.
   - `Planned implementation move:` Have the scanner return `latestBranchEntryId` from the run start. `command.ts` owns boundary advancement and persists that value only on successful reconciliation or explicit no-op success.

1. **Requirement:** `When a /qna run finds no new assistant or user transcript since the durable boundary, the system shall treat that run as a successful no-op, advance the boundary to the current branch tip, and show a notification.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `/qna` currently errors when no suitable assistant message exists and has no durable success path.
   - `Planned implementation move:` Scan before checking model availability. If the new transcript slice is empty, persist only the boundary advance, leave ledger state unchanged, and notify with a small no-op summary.

1. **Requirement:** `When extraction is cancelled or fails before completion, the system shall not advance the durable boundary.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `extensions/qna.ts` uses a `BorderedLoader`, but failure only aborts the popup and there is no persisted boundary to protect.
   - `Planned implementation move:` Keep branch state immutable until after model normalization and reconciliation succeed; on abort, auth failure, invalid model JSON after retry, or thrown error, notify and return without persisting a new snapshot.

1. **Requirement:** `When the model determines that an unresolved ordinary QnA question has already been answered naturally in chat, the system shall close that question silently in the branch-local ledger.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` current extraction prompt only returns question/opinion pairs from the last assistant message and has no concept of existing unresolved IDs.
   - `Planned implementation move:` Require the model to emit per-existing-question update actions, including `answered_in_chat`, then let pure reconciliation transition those open records to the authoritative `answered_in_chat` state without any visible per-question chatter.

1. **Requirement:** `When newer chat has replaced an older open ordinary QnA question with a meaningfully different decision, the system shall close the old question and track the newer one as a separate question.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` `/qna` currently has no stable question IDs, no reconciliation state, and no replacement concept.
   - `Planned implementation move:` Let the model mark an update as `replace`, require it to reference one declared net-new question via a temporary response ref, then have pure reconciliation close the old record as `superseded` and add a new stable local record with a fresh local `questionId`.

1. **Requirement:** `When /qna reconciles ledger state, the system shall give the model existing unresolved question IDs to update.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` current `EXTRACTION_SYSTEM_PROMPT` in `extensions/qna.ts` has no existing-ID input and no update channel.
   - `Planned implementation move:` Build a new reconciliation prompt that includes unresolved open ledger records as `{ questionId, questionText }[]`, explicitly forbids inventing IDs for updates, and tells the model to omit unchanged open questions from `updates[]` entirely.

1. **Requirement:** `When /qna reconciles ledger state, the system shall ask the model to extract net-new questions separately from unresolved question updates.`
   - `Status:` `needs implementation`
   - `Current files/functions/types that relate:` current payload shape is a single flat `items[]` array.
   - `Planned implementation move:` Replace the current flat schema with a strict two-channel JSON schema: `updates[]` for existing IDs and `newQuestions[]` for truly net-new items, with response normalization rejecting ambiguous output.

### 4. Current Architecture Deep Dive

- `extensions/qna.ts`
  - Owns everything today: transcript selection, LLM extraction, local TUI answer entry, final freeform message send.
  - Extracts only from the last completed assistant message via `getLastAssistantMessageText(...)`.
  - Uses the model once to return flat `{ items: [{ question, opinion }] }` JSON.
  - Opens a paged local input UI and sends freeform `Q:` / `A:` text back into chat.
  - Has no stable question IDs, no hidden state, no boundary, no branch inheritance, and no way to reconcile older questions.

- `extensions/question-runtime/types.ts`
  - Already defines reusable low-level draft and outcome shapes: `QuestionRuntimeQuestionDraft`, `QuestionRuntimeQuestionOutcome`, and structured submit result unions.
  - These are the right read-only payload contracts to embed inside `/qna` state, but they are not a complete authoritative record model because ordinary QnA also needs transcript-owned closure states like `answered_in_chat` and `superseded`.

- `extensions/question-runtime/repair-messages.ts`
  - Already emits hidden `form_submitted` and `form_cancelled` control messages carrying `draftSnapshot`.
  - `/qna` does not consume these yet, but task 04 should shape its branch state so task 05 can persist them without another schema change.

- `extensions/question-runtime/index.ts`
  - Owns the hidden control-message send path for `form_submitted` and `form_cancelled`.
  - Task 04 should treat this as read-only reference context so the stored `runtimeDraftsByQuestionId` map matches the real payload source task 05 will consume.

- `extensions/question-runtime/request-store.ts`
  - Shows the current repo pattern for branch-local hidden state snapshots: hydrate from branch custom entries, keep the latest valid snapshot, persist replacements via `pi.appendEntry(...)`.
  - `/qna` needs the same persistence model, but for ledger state instead of authorized request lifecycle state.

#### Existing runtime flow

1. User runs `/qna`.
1. `extensions/qna.ts` finds the last completed assistant message only.
1. A `BorderedLoader` wraps a single model call for flat question extraction.
1. The command opens a local answer form built only from that one extraction result.
1. Submit formats freeform `Q:` / `A:` text and sends it as a new user message.

#### Current data/model shapes

- `/qna` local-only shapes:

  ```ts
  interface ExtractedQnaItem {
    question: string;
    opinion: string;
  }

  interface AnsweredQnaItem extends ExtractedQnaItem {
    answer: string;
  }
  ```

- Shared runtime shapes already available for reuse:

  ```ts
  type QuestionRuntimeQuestionOutcome =
    | { questionId: string; state: "open" }
    | { questionId: string; state: "skipped"; note?: string }
    | { questionId: string; state: "needs_clarification"; note: string }
    | { questionId: string; state: "answered"; answer: ... };

  interface QuestionRuntimeQuestionDraft {
    questionId: string;
    closureState: "open" | "skipped" | "needs_clarification";
    answerDraft: ...;
    questionNote: string;
  }
  ```

#### Current UI/rendering flow

- `/qna` uses two TUI phases today:
  - a loader while extraction runs
  - a custom tabbed input flow for manual answers
- That UI is product-wrong for task 04 because it is ephemeral and freeform. The loader pattern remains useful; the answer form does not.

#### Reusable pieces that should be preserved

- The model-auth and one-retry JSON parse pattern in current `/qna` extraction.
- The `BorderedLoader` cancellation pattern so extraction can abort cleanly without mutating durable state.
- The branch-local hidden-state persistence pattern from `extensions/question-runtime/request-store.ts`.
- The shared runtime draft and outcome types from `extensions/question-runtime/types.ts`.

#### Friction, duplication, or missing seams

- `/qna` is one monolithic file with command wiring, prompting, UI, and output formatting interleaved.
- There is no pure transcript collector, so boundary logic would otherwise get tangled into command code.
- There is no authoritative ordinary-QnA record state model, so transcript-owned closures and future manual outcomes would otherwise drift apart.
- There is no pure reconciliation module, so stable IDs, replacement handling, recovery dedupe, and send-state bookkeeping would become ad hoc.
- There is no hidden `/qna` state entry at all.
- The current command sends freeform chat text immediately, which conflicts with the ledger-first design required by tasks 04-06.

### 5. Target Architecture

#### Proposed modules and responsibilities

- `extensions/qna.ts`
  - Real extension entry only.
  - Keeps the required extension doc header, but rewrites that header to describe hidden ledger reconciliation instead of a paged answer form.
  - Delegates command registration to `extensions/qna/command.ts`.

- `extensions/qna/command.ts`
  - Command orchestration only.
  - Hydrates branch state, scans transcript after boundary, handles the explicit no-new-transcript success path, launches model reconciliation under a loader only when needed, persists success snapshots, and shows summary notifications.

- `extensions/qna/types.ts`
  - Product-owned state types for the branch snapshot, authoritative ordinary-QnA record states, transcript slices, and model-reconciliation response.
  - Reuses shared question-runtime draft and submitted-outcome payload types without pretending they are the whole product state model.

- `extensions/qna/branch-state.ts`
  - Hidden branch-state parsing, cloning, defaulting, and persistence.
  - Owns `QNA_STATE_ENTRY`, schema-version validation, and the “latest valid snapshot wins” rule.

- `extensions/qna/transcript-scan.ts`
  - Pure helper that inspects only raw `SessionEntry` message entries after the durable boundary.
  - Returns chronological prompt-ready transcript messages, the latest branch entry ID seen at scan start, and whether the stored boundary was matched.

- `extensions/qna/model-reconcile.ts`
  - Builds the exact LLM prompt.
  - Calls `complete(...)`.
  - Parses and strictly normalizes `{ updates, newQuestions }` JSON.
  - Never mutates ledger state.

- `extensions/qna/reconcile.ts`
  - Pure merge engine.
  - Filters unresolved open records, applies `answered_in_chat` and `replace` updates, allocates stable local IDs, bumps send revisions on semantic changes, and performs deterministic question-text dedupe only for recovery full scans.

#### Data flow from command entry to final persisted result

1. User runs `/qna`.
1. Command hydrates the latest branch-local `qna.state` snapshot.
1. Transcript scanner collects assistant or user text entries after `durableBoundaryEntryId` and reports whether that boundary was actually found.
1. If the transcript slice is empty, command persists only the boundary advance to the current branch tip and shows a no-op notification.
1. If the transcript slice is non-empty, command builds model input from unresolved open ledger records only.
1. Model reconciliation receives:
   - the new transcript slice
   - unresolved open question IDs and texts
1. Model returns two separate lists:
   - `updates[]` for existing unresolved IDs only
   - `newQuestions[]` for net-new questions only
1. Pure reconciliation merges the model output into a new branch snapshot and, on recovery scans only, dedupes net-new questions against already tracked records using deterministic fingerprints.
1. On success only, command writes the new snapshot with `durableBoundaryEntryId` advanced to the scan start’s latest branch entry.
1. Command notifies the user with a short summary. It does not yet activate the loop-scoped `qna` tool or open the shared runtime form in this task.

#### Reusable abstractions to introduce or strengthen

- One product-owned authoritative ledger state model that survives tasks 04-06 unchanged.
- One pure transcript collector shared by command and tests.
- One strict model-response normalizer so replacement and net-new semantics do not leak into command code.
- One deterministic question-text fingerprint helper used only as a recovery guard when the stored boundary is missing.
- One pure reconciliation module that task 05 and task 06 can call again when user edits or sends ledger records.

#### Clear boundaries

- **Runtime:** `extensions/question-runtime/types.ts` stays the reusable draft/outcome payload contract; task 04 does not modify shared runtime behavior.
- **Hidden control-message source:** `extensions/question-runtime/index.ts` and `repair-messages.ts` stay read-only in task 04; task 05 will consume them.
- **Validation:** `model-reconcile.ts` owns JSON parsing and schema normalization for model output.
- **Storage:** `branch-state.ts` owns `qna.state` custom entries only.
- **UI:** `command.ts` uses only a loader plus notifications in this task.
- **Command orchestration:** `command.ts` coordinates the modules and is the only place allowed to advance the durable boundary.

```text
/qna command
    |
    v
hydrate qna.state ----------------------------------------+
    |                                                     |
    v                                                     |
collect transcript after durable boundary                 |
    |                                                     |
    +---- empty slice? ---- yes --> persist boundary -----+
    |                                                     |
    no                                                    |
    |                                                     |
    +-------- unresolved open ledger ---------------------+
                     |
                     v
            model-reconcile.ts
                     |
                     v
               reconcile.ts
                     |
                     v
       command-owned boundary advance + persist snapshot
                     |
                     v
            notify summary to user
```

### 6. File-by-File Implementation Plan

- `Path:` `extensions/qna.ts`
  - `Action:` `extract`

  - `Why:` The current root extension file is a task-00 prototype that hardcodes last-message extraction and a freeform answer UI.

  - `Responsibilities:`
    - Keep the short extension documentation header structure.
    - Update the header text so it describes hidden branch-local ledger reconciliation instead of a paged Q/A form.
    - Remain the only root `qna.ts` file under `extensions/`.
    - Delegate command registration to the new subfolder module.

  - `Planned exports / signatures:`

    ```ts
    export default function qnaExtension(pi: ExtensionAPI): void;
    ```

  - `Key logic to add or change:`
    - Remove the current inline extraction prompt, popup-answer UI, and freeform `Q:` / `A:` send path.
    - Import and call `registerQnaCommand(pi)` from `./qna/command.js`.
    - Update the registered command description so it matches hidden ledger reconciliation.

  - `Dependencies:` `extensions/qna/command.ts`

  - `Risks / notes:` Delete the old one-off code instead of leaving dead extraction helpers behind.

- `Path:` `extensions/qna/command.ts`
  - `Action:` `add`

  - `Why:` Task 04 needs a thin orchestrator above storage, transcript scanning, model parsing, and pure reconciliation.

  - `Responsibilities:`
    - Register `/qna`.
    - Keep the current `ctx.hasUI` guard.
    - Hydrate branch state from `ctx.sessionManager.getBranch()`.
    - Scan first, then require `ctx.model` only if there is new assistant or user transcript to reconcile.
    - Run transcript reconciliation under a `BorderedLoader` when a model call is actually needed.
    - Persist success snapshots and notify concise summary counts.

  - `Planned exports / signatures:`

    ```ts
    export function registerQnaCommand(pi: ExtensionAPI): void;

    export async function runQnaCommand(
      pi: ExtensionAPI,
      ctx: ExtensionCommandContext,
    ): Promise<void>;
    ```

  - `Key logic to add or change:`
    - Build one `QnaBranchStateStore` per command run and hydrate it from the current branch before scanning.
    - Call `collectQnaTranscriptSinceBoundary(...)` before checking `ctx.model`.
    - If the transcript slice is empty, persist the same ledger with `durableBoundaryEntryId = latestBranchEntryId`, notify a no-op success such as `QnA ledger unchanged`, and return.
    - If there are new messages and `ctx.model` is missing, notify an error and return without persisting a boundary.
    - If there are new messages, pass only the transcript slice plus unresolved open ledger items into `reconcileQnaTranscript(...)`.
    - Call `applyQnaReconciliation(...)` with `dedupeNewQuestionsAgainstExisting = true` only when the store already had a boundary but the scanner could not find it on the current branch.
    - Persist the next snapshot only after model normalization and pure reconciliation succeed.
    - Show a small summary notification such as `QnA ledger updated: 2 new, 1 answered in chat, 1 replaced`.
    - On cancellation or failure, notify and return without persisting a new boundary.

  - `Dependencies:` `extensions/qna/branch-state.ts`, `extensions/qna/transcript-scan.ts`, `extensions/qna/model-reconcile.ts`, `extensions/qna/reconcile.ts`

  - `Risks / notes:` This file should not start listening to question-runtime control messages yet; that belongs to task 05.

- `Path:` `extensions/qna/types.ts`
  - `Action:` `add`

  - `Why:` Ordinary `/qna` needs product-owned hidden state and reconciliation contracts that are more precise than the shared runtime outcome union.

  - `Responsibilities:`
    - Define the hidden branch-state snapshot shape.
    - Define the authoritative ordinary-QnA record-state union.
    - Define transcript-scan and model-response types.
    - Reuse shared question-runtime draft and submitted-outcome payload types.

  - `Planned exports / signatures:`

    ```ts
    import type {
      QuestionRuntimeQuestionDraft,
      SubmittedQuestionRuntimeQuestionOutcome,
    } from "../question-runtime/types.js";

    export const QNA_STATE_ENTRY = "qna.state";

    export interface QnaLedgerSendState {
      localRevision: number;
      lastSentRevision: number;
      lastSentAt?: string;
    }

    interface QnaLedgerQuestionRecordBase {
      questionId: string;
      questionText: string;
      questionFingerprint: string;
      sendState: QnaLedgerSendState;
    }

    export type QnaLedgerQuestionRecord =
      | (QnaLedgerQuestionRecordBase & { state: "open" })
      | (QnaLedgerQuestionRecordBase & {
          state: "answered";
          submittedOutcome: Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "answered" }>;
        })
      | (QnaLedgerQuestionRecordBase & {
          state: "skipped";
          submittedOutcome: Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "skipped" }>;
        })
      | (QnaLedgerQuestionRecordBase & {
          state: "needs_clarification";
          submittedOutcome: Extract<
            SubmittedQuestionRuntimeQuestionOutcome,
            { state: "needs_clarification" }
          >;
        })
      | (QnaLedgerQuestionRecordBase & { state: "answered_in_chat" })
      | (QnaLedgerQuestionRecordBase & {
          state: "superseded";
          supersededByQuestionId: string;
        });

    export interface QnaBranchStateSnapshot {
      schemaVersion: 1;
      durableBoundaryEntryId?: string;
      nextQuestionSequence: number;
      questions: QnaLedgerQuestionRecord[];
      runtimeDraftsByQuestionId: Record<string, QuestionRuntimeQuestionDraft>;
    }

    export interface QnaTranscriptMessage {
      entryId: string;
      role: "user" | "assistant";
      text: string;
    }

    export interface QnaTranscriptScanResult {
      messages: QnaTranscriptMessage[];
      latestBranchEntryId?: string;
      boundaryMatched: boolean;
    }

    export interface QnaReconcileModelResponse {
      updates: Array<{
        questionId: string;
        action: "answered_in_chat" | "replace";
        replacementRef?: string;
      }>;
      newQuestions: Array<{
        ref: string;
        questionText: string;
      }>;
    }
    ```

  - `Key logic to add or change:`
    - Make `state` the single authoritative ledger status field.
    - Store shared-runtime answer payloads only when the authoritative state came from a runtime submit.
    - Keep `nextQuestionSequence` in branch state so local question IDs are extension-owned and branch-forkable.
    - Track `questionFingerprint` as deterministic normalized text used only for recovery dedupe, never as user-visible identity.

  - `Dependencies:` `extensions/question-runtime/types.ts`

  - `Risks / notes:` Keep this schema versioned from day one so later task-05/task-06 additions stay backward-compatible to existing hidden snapshots.

- `Path:` `extensions/qna/branch-state.ts`
  - `Action:` `add`

  - `Why:` Hidden branch-local ledger persistence needs its own parse, clone, default, and persist seam.

  - `Responsibilities:`
    - Hydrate the latest valid `qna.state` snapshot from current-branch custom entries.
    - Default to an empty snapshot when missing or malformed.
    - Persist full snapshot replacements via `pi.appendEntry(...)`.
    - Return cloned snapshots so failure paths cannot mutate in-memory state accidentally.

  - `Planned exports / signatures:`

    ```ts
    export class QnaBranchStateStore {
      constructor(private readonly pi: ExtensionAPI) {}

      hydrateFromBranch(entries: SessionEntry[]): void;
      getSnapshot(): QnaBranchStateSnapshot;
      replaceSnapshot(snapshot: QnaBranchStateSnapshot): void;
    }

    export function createEmptyQnaBranchState(): QnaBranchStateSnapshot;
    ```

  - `Key logic to add or change:`
    - Mirror the request-store pattern: latest valid custom entry wins, malformed entries are ignored.
    - Validate `schemaVersion === 1`, record-state invariants, and non-negative integer send revisions.
    - Deep-clone `questions` and `runtimeDraftsByQuestionId` on read and write.
    - Do not embed reconciliation logic here; this module is storage only.

  - `Dependencies:` `extensions/qna/types.ts`

  - `Risks / notes:` Snapshot parsing must be tolerant enough that bad historic state does not brick `/qna`, but strict enough that impossible record unions do not leak through.

- `Path:` `extensions/qna/transcript-scan.ts`
  - `Action:` `add`

  - `Why:` Boundary-aware transcript collection is a pure concern and should not live inside command code.

  - `Responsibilities:`
    - Inspect only assistant and user message entries.
    - Stop at the durable boundary entry ID when present.
    - Return chronological text content plus the branch entry ID to use as the next success boundary.
    - Report whether the stored boundary was actually found.

  - `Planned exports / signatures:`

    ```ts
    export function collectQnaTranscriptSinceBoundary(
      branch: SessionEntry[],
      durableBoundaryEntryId?: string,
    ): QnaTranscriptScanResult;
    ```

  - `Key logic to add or change:`
    - Walk backward from the current branch leaf until the boundary entry is hit.
    - Ignore non-message entries entirely for prompt content, but still report the latest branch entry ID seen at the start of the scan.
    - For message entries, inspect only `message.role === "user"` or `"assistant"`.
    - For assistant messages, skip entries where `stopReason !== "stop"` so incomplete or aborted assistant output never enters reconciliation.
    - Keep only text parts and skip empty text bodies.
    - If the stored boundary ID is missing from the branch, return a full branch scan with `boundaryMatched = false` instead of failing.

  - `Dependencies:` `extensions/qna/types.ts`

  - `Risks / notes:` Compaction summaries, hidden custom messages, and tool-result messages must not leak into the prompt.

- `Path:` `extensions/qna/model-reconcile.ts`
  - `Action:` `add`

  - `Why:` The model contract needs its own prompt, retry, and normalization seam separate from branch-state mutation.

  - `Responsibilities:`
    - Build the reconciliation prompt from the transcript slice plus unresolved open ledger items.
    - Call `complete(...)` with the current selected model.
    - Parse and normalize strict JSON with one retry on invalid output.

  - `Planned exports / signatures:`

    ```ts
    export async function reconcileQnaTranscript(
      input: {
        transcript: QnaTranscriptMessage[];
        unresolvedQuestions: Array<{ questionId: string; questionText: string }>;
      },
      ctx: ExtensionCommandContext,
      signal?: AbortSignal,
    ): Promise<QnaReconcileModelResponse | null>;
    ```

  - `Key logic to add or change:`
    - Replace the current flat extraction prompt with a JSON schema that requires:
      - `updates[]` for existing unresolved `questionId`s only
      - `newQuestions[]` for net-new questions only
    - Tell the model to omit unchanged open questions instead of returning a `keep_open` action.
    - Reject unknown update IDs, duplicate update IDs, duplicate new refs, duplicate normalized new-question fingerprints within one model response, and `replace` updates that do not point at a declared `newQuestions[].ref`.
    - Keep the current direct-JSON parse first, fenced-object fallback second, retry once if invalid.

  - `Dependencies:` `extensions/qna/types.ts`

  - `Risks / notes:` Prompt drift is the main task risk. Strict response normalization must fail closed instead of silently guessing.

- `Path:` `extensions/qna/reconcile.ts`
  - `Action:` `add`

  - `Why:` Silent closure, replacement, stable local ID allocation, recovery dedupe, and send-state bookkeeping must be deterministic and testable outside the command.

  - `Responsibilities:`
    - Select unresolved open ledger records.
    - Allocate new local question IDs.
    - Apply model `updates[]` and `newQuestions[]` into the next branch snapshot.
    - Bump per-record local revisions only when a record changes semantically.
    - Preserve unrelated runtime drafts untouched in task 04.

  - `Planned exports / signatures:`

    ```ts
    export function buildQnaQuestionFingerprint(questionText: string): string;

    export function getUnresolvedQnaQuestions(
      state: QnaBranchStateSnapshot,
    ): Array<{ questionId: string; questionText: string }>;

    export interface ApplyQnaReconciliationResult {
      nextState: QnaBranchStateSnapshot;
      stats: {
        newQuestions: number;
        recoveryDedupedQuestions: number;
        closedAnsweredInChat: number;
        replacedQuestions: number;
      };
    }

    export function applyQnaReconciliation(input: {
      state: QnaBranchStateSnapshot;
      model: QnaReconcileModelResponse;
      dedupeNewQuestionsAgainstExisting: boolean;
    }): ApplyQnaReconciliationResult;
    ```

  - `Key logic to add or change:`
    - Treat unresolved transcript-reconciliation inputs as ledger records where `state === "open"` only.
    - `buildQnaQuestionFingerprint(...)` should use deterministic text normalization only: trim, lowercase, collapse internal whitespace, and strip trailing terminal punctuation. No semantic guessing.
    - For `answered_in_chat`, transition the matching open record to `state: "answered_in_chat"` and bump `sendState.localRevision` by 1.
    - For `replace`, transition the old record to `state: "superseded"`, set `supersededByQuestionId`, bump its `localRevision`, and create one new open record with a fresh local `questionId` such as `qna_0001`.
    - Initialize new records with `sendState.localRevision = 1` and `lastSentRevision = 0`.
    - When `dedupeNewQuestionsAgainstExisting` is true, ignore would-be new questions whose fingerprint already exists on any tracked record and count them in `recoveryDedupedQuestions`.
    - Leave `runtimeDraftsByQuestionId` untouched in task 04; this task seeds durable storage but does not yet rewrite or clear drafts.
    - Do not mutate the durable boundary here; command owns success persistence.

  - `Dependencies:` `extensions/qna/types.ts`

  - `Risks / notes:` Keep ID generation extension-owned and deterministic. The model should never mint final ledger IDs.

- `Path:` `extensions/qna/branch-state.test.ts`
  - `Action:` `add`
  - `Why:` Branch-local hidden-state hydration is the core durability seam for this task.
  - `Responsibilities:`
    - Prove latest valid snapshot wins.
    - Prove malformed older or newer custom entries do not break hydration.
    - Prove default empty state when no `qna.state` entry exists.
    - Prove `getSnapshot()` returns clones rather than live mutable references.
  - `Planned exports / signatures:` none
  - `Key logic to add or change:` use `bun:test` with fake `SessionEntry[]` fixtures and a minimal fake `ExtensionAPI` append spy where needed.
  - `Dependencies:` `extensions/qna/branch-state.ts`
  - `Risks / notes:` Keep tests pure and branch-entry based, not end-to-end UI based.

- `Path:` `extensions/qna/transcript-scan.test.ts`
  - `Action:` `add`
  - `Why:` Boundary slicing is the highest-risk pure logic in task 04.
  - `Responsibilities:`
    - Prove only assistant or user transcript text is collected.
    - Prove scanning stops at the stored boundary.
    - Prove missing boundary falls back to full scan with `boundaryMatched = false`.
    - Prove incomplete assistant messages are skipped.
  - `Planned exports / signatures:` none
  - `Key logic to add or change:` cover mixed raw `message` entries with roles `user`, `assistant`, and `toolResult`, plus `custom` entries, and assert chronological output order.
  - `Dependencies:` `extensions/qna/transcript-scan.ts`
  - `Risks / notes:` Keep fixtures small but include multi-part text content.

- `Path:` `extensions/qna/model-reconcile.test.ts`
  - `Action:` `add`
  - `Why:` The strict response contract is one of the highest-risk seams in task 04.
  - `Responsibilities:`
    - Prove unknown update IDs are rejected.
    - Prove duplicate update IDs and duplicate `newQuestions[].ref` values are rejected.
    - Prove `replace` updates without a valid `replacementRef` are rejected.
    - Prove unchanged open questions can be omitted cleanly.
  - `Planned exports / signatures:` none
  - `Key logic to add or change:` exercise both direct JSON and fenced-object fallback parsing.
  - `Dependencies:` `extensions/qna/model-reconcile.ts`
  - `Risks / notes:` These tests should lock down the exact fail-closed behavior before command wiring lands.

- `Path:` `extensions/qna/reconcile.test.ts`
  - `Action:` `add`
  - `Why:` Silent closure, replacement, recovery dedupe, and send-revision behavior are the main product semantics in task 04.
  - `Responsibilities:`
    - Prove `answered_in_chat` closes an old open record silently.
    - Prove `replace` closes the old record and creates a distinct new one.
    - Prove recovery scans do not recreate already tracked questions as net-new items.
    - Prove changed records bump `sendState.localRevision` while untouched records do not.
    - Prove unrelated runtime drafts survive reconciliation unchanged.
  - `Planned exports / signatures:` none
  - `Key logic to add or change:` cover mixed updates and net-new records, plus stable next-ID allocation from `nextQuestionSequence`.
  - `Dependencies:` `extensions/qna/reconcile.ts`
  - `Risks / notes:` The tests should assert exact stored record shapes so later tasks do not accidentally drift the hidden ledger contract.

- `Path:` `extensions/qna/command.test.ts`
  - `Action:` `add`
  - `Why:` Boundary advancement rules live in orchestration, not in pure reconciliation.
  - `Responsibilities:`
    - Prove a no-new-transcript run advances the boundary and persists unchanged ledger state.
    - Prove cancellation or model failure does not persist a new boundary.
    - Prove missing model only errors when a model call is actually needed.
  - `Planned exports / signatures:` none
  - `Key logic to add or change:` use fake `ExtensionAPI`, fake branch entries, and a minimal fake `ExtensionCommandContext` with a stubbed `ui.custom` loader path.
  - `Dependencies:` `extensions/qna/command.ts`
  - `Risks / notes:` Keep this test focused on persist or no-persist branching rather than full TUI rendering.

#### Read-only reference context

- `extensions/question-runtime/types.ts`
  - Reuse `QuestionRuntimeQuestionDraft` and `SubmittedQuestionRuntimeQuestionOutcome` payload shapes only.

- `extensions/question-runtime/repair-messages.ts`
  - Read-only source of the eventual `draftSnapshot` control-message payload shape for task 05.

- `extensions/question-runtime/index.ts`
  - Read-only source of the real hidden `form_submitted` / `form_cancelled` message flow task 05 must consume.

- `extensions/question-runtime/request-store.ts`
  - Read-only persistence pattern reference for custom branch-local state snapshots.

### 7. File Fingerprints

- `Path:` `extensions/qna.ts`
  - `Reason this file changes:` Replace the prototype inline `/qna` implementation with a thin extension entrypoint.
  - `Existing anchors to search for:` `interface ExtractedQnaItem {`, `const EXTRACTION_SYSTEM_PROMPT =`, `function getLastAssistantMessageText(`, `function formatFinalOutput(`, `pi.registerCommand("qna", {`
  - `New anchors expected after implementation:` `import { registerQnaCommand } from "./qna/command.js";`, `registerQnaCommand(pi);`, `QnA ledger`
  - `Unsafe areas to avoid touching:` keep the top-level extension documentation header structure and the default export name, but rewrite the header text itself so it matches the new behavior

- `Path:` `extensions/qna/command.ts`
  - `Reason this file changes:` New command orchestrator for branch-state hydrate, transcript scan, reconciliation, boundary advancement, persistence, and notify.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function registerQnaCommand(`, `export async function runQnaCommand(`, `collectQnaTranscriptSinceBoundary(`, `replaceSnapshot(`, `applyQnaReconciliation(`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/types.ts`
  - `Reason this file changes:` New product-owned hidden state and model-response contract.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export const QNA_STATE_ENTRY = "qna.state";`, `export type QnaLedgerQuestionRecord =`, `questionFingerprint`, `boundaryMatched`, `export interface QnaReconcileModelResponse {`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/branch-state.ts`
  - `Reason this file changes:` New hidden branch-state hydrate or persist seam.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export class QnaBranchStateStore`, `function cloneSnapshot(`, `function parseSnapshot(`, `export function createEmptyQnaBranchState(`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/transcript-scan.ts`
  - `Reason this file changes:` New durable-boundary transcript collector.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function collectQnaTranscriptSinceBoundary(`, `boundaryMatched`, `entry.type === "message"`, `message.role === "assistant"`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/model-reconcile.ts`
  - `Reason this file changes:` New model prompt and strict JSON normalization for reconciliation.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `const RECONCILIATION_SYSTEM_PROMPT =`, `export async function reconcileQnaTranscript(`, `function normalizeModelResponse(`, `replacementRef`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/reconcile.ts`
  - `Reason this file changes:` New pure merge engine for closing, replacing, deduping recovery scans, and creating ordinary QnA records.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `export function buildQnaQuestionFingerprint(`, `export function getUnresolvedQnaQuestions(`, `export function applyQnaReconciliation(`, `function allocateQuestionId(`
  - `Unsafe areas to avoid touching:` none; new isolated module

- `Path:` `extensions/qna/branch-state.test.ts`
  - `Reason this file changes:` Add focused persistence and hydration coverage.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `describe("QnaBranchStateStore"`, `latest valid snapshot wins`, `returns cloned snapshots`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/qna/transcript-scan.test.ts`
  - `Reason this file changes:` Add focused boundary and filtering coverage.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `describe("collectQnaTranscriptSinceBoundary"`, `stops at durable boundary`, `boundaryMatched`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/qna/model-reconcile.test.ts`
  - `Reason this file changes:` Add strict normalization coverage.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `describe("reconcileQnaTranscript normalization"`, `rejects unknown update IDs`, `replacementRef`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/qna/reconcile.test.ts`
  - `Reason this file changes:` Add focused closure, replacement, recovery dedupe, and revision coverage.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `describe("applyQnaReconciliation"`, `closes answered-in-chat questions silently`, `dedupes recovery-scan questions`, `localRevision`
  - `Unsafe areas to avoid touching:` none

- `Path:` `extensions/qna/command.test.ts`
  - `Reason this file changes:` Add focused boundary-persistence coverage for orchestration.
  - `Existing anchors to search for:` `none (new file)`
  - `New anchors expected after implementation:` `describe("runQnaCommand"`, `advances boundary on no-op success`, `does not persist on failure`
  - `Unsafe areas to avoid touching:` none

### 8. Stepwise Execution Plan

1. Add `extensions/qna/types.ts` and lock the hidden branch-state, authoritative record-state union, transcript-scan result, and model-response contracts first.
1. Add `extensions/qna/branch-state.ts` plus `extensions/qna/branch-state.test.ts` so storage, schema validation, and clone semantics are fixed before reconciliation work lands.
1. Add `extensions/qna/transcript-scan.ts` and `extensions/qna/transcript-scan.test.ts`.
1. Add `extensions/qna/reconcile.ts` plus `extensions/qna/reconcile.test.ts`.
1. Add `extensions/qna/model-reconcile.ts` plus `extensions/qna/model-reconcile.test.ts` once the input or output contracts are fixed.
1. Rewrite `extensions/qna.ts` into a thin entrypoint and add `extensions/qna/command.ts` as the new orchestrator.
1. Add `extensions/qna/command.test.ts` for boundary persist or no-persist behavior.
1. Reload the extension because `extensions/` changed.
1. Run focused tests, then do manual branch runs to verify no-op boundary advancement, silent closure, replacement, and fork inheritance.
1. Run `mise run check` after the TypeScript edits.

Parallel notes:

- Steps 2-4 can proceed in parallel after step 1 fixes the shared `/qna` types.
- Step 5 depends on the finalized transcript and model-response types.
- Step 6 should happen after steps 2-5 so command wiring lands against stable pure helpers.
- Steps 8-10 are sequential verification.

Checkpoints:

- After step 3: confirm transcript scan fixtures use raw `message` entries, ignore non-user or assistant prompt content, and honor the stored boundary.
- After step 4: confirm replacement, silent-closure, recovery-dedupe, and revision-bump tests pass before the command is rewritten.
- After step 6: manually verify `/qna` no longer sends freeform `Q:` / `A:` text and only updates hidden ledger state.
- After step 7: confirm a no-new-transcript run still persists the boundary and a failed model run does not.

### 9. Validation Plan

- **Unit tests**
  - `extensions/qna/branch-state.test.ts`
    - latest valid `qna.state` snapshot wins
    - malformed snapshot entries are ignored
    - missing snapshot returns the empty-state default
    - returned snapshots are clones, not live mutable references
  - `extensions/qna/transcript-scan.test.ts`
    - only assistant or user text content is included
    - tool-result messages, custom entries, branch summaries, and non-text parts are ignored
    - scan stops at the stored durable boundary
    - incomplete assistant messages are skipped
    - missing boundary falls back to full-scan behavior with `boundaryMatched = false`
  - `extensions/qna/model-reconcile.test.ts`
    - unknown update IDs are rejected
    - duplicate update IDs or duplicate new refs are rejected
    - `replace` without a valid `replacementRef` is rejected
    - unchanged open questions can be omitted from `updates[]`
  - `extensions/qna/reconcile.test.ts`
    - `answered_in_chat` silently closes the matching open record
    - `replace` closes the old record and creates a fresh stable local `questionId`
    - recovery dedupe prevents already tracked questions from being recreated as net-new items
    - changed records bump `sendState.localRevision` while untouched ones do not
    - unrelated runtime drafts survive reconciliation unchanged
  - `extensions/qna/command.test.ts`
    - no-new-transcript success advances the boundary and persists unchanged ledger state
    - model cancellation or failure does not persist a new boundary
    - missing model errors only when a model call is actually required

- **Manual verification**
  1. Run `/qna` on a branch with unresolved chat questions and inspect the latest hidden `qna.state` entry to confirm new ledger items appear.
  1. Run `/qna` again after adding new chat and confirm only entries after the stored boundary are scanned.
  1. Run `/qna` again with no new assistant or user transcript and confirm the boundary advances with an unchanged-ledger notification.
  1. Answer one prior question naturally in chat, rerun `/qna`, and confirm the old record closes without any extra visible popup.
  1. Fork the session, rerun `/qna` in the new branch, and confirm the ledger, next question sequence, and durable boundary all carried forward.

- **Expected user-visible behavior**
  - `/qna` should stop behaving like the current freeform answer popup.
  - Successful runs should update hidden branch-local state and show only a short summary notification.
  - Successful runs with no new transcript should still notify and advance the boundary.
  - Failed or cancelled runs should notify but leave the stored boundary untouched.

- **Failure modes to test**
  - model auth missing or current model missing when reconciliation is needed
  - model returns invalid JSON twice
  - scan slice contains no assistant or user messages
  - stored boundary entry ID is missing from the branch
  - replacement response points to an unknown `newQuestions[].ref`
  - duplicate update IDs, duplicate new refs, or duplicate normalized new-question fingerprints in model output

- **Repo checks**
  - Run focused tests with `bun test extensions/qna/*.test.ts` or equivalent targeted file selection.
  - Run `mise run check` after all `.ts` edits.
  - Reload the extension before manual `/qna` verification because files under `extensions/` changed.

### 10. Open Questions / Assumptions

- Ordinary transcript reconciliation treats only `state: "open"` records as unresolved input for the model. Closed records are browsed or reopened later through task 06.
- Task 04 seeds durable `runtimeDraftsByQuestionId` storage but does not yet consume `question-runtime.control` submit or cancel messages; task 05 wires that path.
- Deterministic question-text fingerprints are used only as a recovery guard when a stored boundary is missing. They are not user-visible identity and do not replace model-driven replacement semantics.
