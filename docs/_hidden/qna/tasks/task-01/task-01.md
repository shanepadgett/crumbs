# Task 01 — Shared runtime request protocol, validation, and form launch

## Overview

Build the shared low-level request pipeline that both `/qna` and `/interview` use to open structured question forms. This task establishes the authorized absolute-path protocol, deterministic validation, hidden repair messaging, retry budgeting, request locking, and the first tabbed runtime shell that launches from a valid request.

## Grouping methodology

Everything here is pre-product infrastructure. It is one committable and testable unit because a minimal one-question request can prove the full request lifecycle end to end before any QnA inbox extraction or interview session behavior exists.

## Dependencies

- None.

## Parallelization

- Completion of this task unblocks every later task.

## Spec coverage

### `docs/qna/question-runtime-core-spec.md`

- The system shall use this runtime as shared infrastructure for `/qna` and `/interview`.
  - Evidence: partially implemented — `extensions/question-runtime/index.ts` delivers the shared standalone runtime, but proving reuse still depends on later `/qna` and `/interview` integration work outside task-01 scope.
- The system shall keep product-specific workflow and storage policy out of this shared spec.
  - Evidence: implemented — `extensions/question-runtime/` only defines request paths, validation, retry control, watcher/store state, and shell UI; no product-specific storage or workflow code found.
- The shared runtime shall own only low-level structured-question request protocol, validation, retry control, and question-form rendering.
  - Evidence: implemented — `extensions/question-runtime/tool.ts`, `request-validator.ts`, `request-store.ts`, `request-watcher.ts`, `repair-messages.ts`, and `form-shell.ts` cover only protocol/validation/retries/rendering.
- Product-specific no-question outcomes and terminal screens shall remain product-owned rather than extending the shared question runtime protocol.
  - Evidence: implemented — `extensions/question-runtime/types.ts` and `form-shell.ts` define only question payload/rendering primitives, and existing no-question handling stays in product code such as `extensions/qna.ts` notifications.
- The shared runtime authorized-question tool shall remain distinct from any product-level agent tool.
  - Evidence: implemented — `extensions/question-runtime/tool.ts` registers `question_runtime_request`; existing product command remains separate in `extensions/qna.ts`.
- Each question shall have a stable `questionId` owned by the calling extension.
  - Evidence: implemented — `extensions/question-runtime/types.ts` requires `questionId`; `request-validator.ts` requires non-empty caller-supplied `questionId` on every question.
- The shared runtime shall validate caller-supplied `questionId`s but shall not generate or reconcile them.
  - Evidence: implemented — `request-validator.ts` validates presence/uniqueness of `questionId`; no generator or reconciliation logic exists outside request ID generation in `tool.ts`.
- The system shall allow per-run presentation fields to change without changing the stable `questionId`.
  - Evidence: implemented — `request-validator.ts` only validates `questionId`/presentation field shape and `form-shell.ts` renders current prompt text from the latest valid file without reconciling IDs.
- Every `multiple_choice` option shall have a stable `optionId` separate from its display label.
  - Evidence: implemented — `types.ts` defines `{ optionId, label }`; `request-validator.ts` requires both fields for each multiple-choice option.
- The shared runtime shall validate caller-supplied `optionId`s but shall not generate or reconcile them.
  - Evidence: implemented — `request-validator.ts` validates non-empty and duplicate `optionId`s; no option ID generation or reconciliation code found.
- When a resurfaced `multiple_choice` option keeps the same meaning, the system shall preserve its `optionId` across rewrites.
  - Evidence: not found — `extensions/question-runtime/request-validator.ts` only validates option ID shape and uniqueness; future product/runtime reconciliation work must preserve stable IDs across rewrites.
- The calling extension shall own `optionId`s and shall pass existing `optionId`s into reconciliation so same-meaning options keep their IDs and only truly new options get new IDs.
  - Evidence: not found — no reconciliation API exists in `extensions/question-runtime/`; later caller integration must carry forward prior `optionId`s when rebuilding question sets.
- The system shall present the question form in a tab-oriented interface.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` flattens questions into tabs and switches with Tab/Shift+Tab/←/→.
- The system shall use a cleaner UI and shall not use the current robot icon.
  - Evidence: implemented — `extensions/question-runtime/form-shell.ts` renders a plain tabbed text shell with request metadata and question content only, and it does not reuse the robot-icon `/qna` chrome.
- When the agent needs to ask structured questions, the system shall require use of an authorized question tool flow rather than arbitrary file watching.
  - Evidence: implemented — `tool.ts` issues authorized request records; `request-watcher.ts` only processes `knownPaths` populated from store records created by the tool.
- When the authorized question tool is called, the system shall issue a request ID and a tool-usable absolute JSON path rooted in a project-local temp location, and it may also return a repo-relative display path.
  - Evidence: implemented — `tool.ts` returns `requestId`, `path`, and `projectRelativePath`; `request-paths.ts` roots files at `.pi/local/question-runtime/requests/<requestId>.json`.
- The system shall require the agent to write the structured question spec to that authorized path rather than to an arbitrary file.
  - Evidence: implemented — `request-watcher.ts` ignores any file outside store-managed `knownPaths`; only `question_runtime_request` adds those paths in `tool.ts`/`request-store.ts`.
- The structured question spec shall contain the full question graph needed for the current request.
  - Evidence: partially implemented — `extensions/question-runtime/types.ts` and `request-validator.ts` accept inline `followUps`, but they do not prove authored payload completeness; later product compilation must supply the full graph per request.
- The structured question spec shall contain at least one renderable question.
  - Evidence: implemented — `request-validator.ts` rejects missing/non-array/empty `questions`; `form-shell.ts` returns early if flattened renderable questions are empty.
- The structured question spec shall not encode product-level loop-control or terminal-screen semantics.
  - Evidence: implemented — `extensions/question-runtime/request-validator.ts` rejects product-control fields like `screen`, `loopControl`, `terminalScreen`, and `terminal` with `forbidden_field` issues while still allowing unrelated unknown fields.
- The system shall require the structured question spec to be deterministic for the known fields the UI depends on.
  - Evidence: implemented — `request-validator.ts` deterministically validates required fields, enums, duplicates, and array/object shapes before UI launch.
- The system shall ignore unknown extra fields in an otherwise valid JSON file.
  - Evidence: implemented — `request-validator.ts` only inspects known fields and returns valid requests without stripping/rejecting extra keys.
- When the authorized file is created or edited, the system shall validate the current JSON immediately.
  - Evidence: implemented — `request-watcher.ts` watches request files and validates on change/rename; `index.ts` also rescans known files on session start/tree restore.
- When the authorized file is valid, the system shall present the question UI immediately.
  - Evidence: implemented — `index.ts` calls `store.markReady(...)`, queues the request, and `showQuestionRuntimeFormShell(...)` runs on the next visible flush.
- When the authorized file is invalid, the system shall send hidden repair feedback to the agent instead of opening the UI.
  - Evidence: implemented — `index.ts` sends `buildValidationFailureMessage(...)` and returns without queuing the shell when validation fails.
- The system shall allow the agent to repair the authorized file in place with its normal file-editing tools.
  - Evidence: implemented — repair messages in `repair-messages.ts` repeat the same request ID/path, and `request-watcher.ts` revalidates later edits to that same file.
- When a valid authorized request has been consumed and the UI has been shown, the system shall lock that request ID so later edits to the same file do not reopen it.
  - Evidence: implemented — `index.ts` calls `store.lockRequest(...)` before opening the shell; `request-store.ts` then causes `shouldProcess(...)` to ignore later edits for locked requests.
- When a product flow has no renderable questions for the current step, it shall handle that outcome without launching the shared question runtime form.
  - Evidence: partially implemented — `extensions/qna.ts` already keeps zero-question handling in product code, and later `/qna` or `/interview` runtime integration must continue short-circuiting before `question_runtime_request`.
- When validation fails, the system shall send a hidden custom message rather than a visible user message.
  - Evidence: implemented — `repair-messages.ts` builds `customType: "question-runtime.control"` messages with `display: false`.
- When validation fails, the hidden custom message shall include the same request ID and authorized path.
  - Evidence: implemented — `buildValidationFailureMessage(...)` includes `requestId`, absolute `path`, and `projectRelativePath` in both content and details.
- When validation fails, the hidden custom message shall describe the field path, expected shape, actual problem, and a concise fix hint for every deterministic error the validator can report.
  - Evidence: implemented — `request-validator.ts` emits structured issues with `path`, `expected`, `actual`, `message`, and `hint`; `repair-messages.ts` formats all issues into the hidden message.
- When the agent repeatedly fails to produce a valid authorized file, the system shall enforce a hidden retry budget of 4 failed validations.
  - Evidence: implemented — `request-store.ts` sets `RETRY_BLOCK_SIZE = 4` and tracks `failureCount`/`allowedFailures` per request.
- When the hidden retry budget is exhausted, the system shall ask the user whether to continue or abort that request.
  - Evidence: implemented — `index.ts` enqueues exhausted requests and `showRetryPrompt(...)` uses `showOptionPicker(...)` with Continue and Abort options.
- While the retry-exhaustion decision is pending, later edits to that same authorized request shall be ignored.
  - Evidence: implemented — `request-store.ts` sets `pendingRetryDecision = true` at exhaustion and `shouldProcess(...)` returns `pending_retry` to ignore later edits.
- When the user chooses Continue after the retry budget is exhausted, the system shall grant exactly one additional block of 4 hidden retries.
  - Evidence: implemented — `extensions/question-runtime/request-store.ts` increments `extraRetryBlocksGranted` by exactly 1 in `grantRetryBlock(...)`, and `allowedFailuresFor(...)` expands capacity by one 4-retry block per Continue decision.
- When the user chooses Abort after the retry budget is exhausted, the system shall stop that request.
  - Evidence: implemented — `index.ts` calls `store.abortRequest(...)` on Abort; `request-store.ts` then causes `shouldProcess(...)` to ignore future edits for aborted requests.

### `docs/qna/planning-interview-spec.md`

- `/interview` shall share only the low-level question runtime with `/qna`.
  - Evidence: partially implemented — `extensions/question-runtime/` is product-agnostic shared infrastructure, but actual `/interview` reuse still needs later product integration to verify shared-only usage.

## Expected end-to-end outcome

- A valid authorized question request opens a shared tabbed form shell immediately.
- Invalid request files never flash broken UI to the user and instead drive a hidden repair loop with deterministic error feedback and bounded retries.
- Once a request has been consumed, later edits to the same authorized file do not reopen the form.

## User test at exit

1. Trigger the authorized question tool and receive a request ID plus tool-usable project-local path.
1. Write invalid JSON and confirm the agent receives hidden repair feedback with the request ID, path, field errors, and fix hints.
1. Exhaust four failed validations and confirm the user sees a Continue or Abort choice, then confirm later edits are ignored until the user decides.
1. Repair the file, confirm the form opens, then edit the same file again and confirm it stays locked.
