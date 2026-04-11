# Task 05 — `/qna` loop control, scoped tool activation, and no-results behavior

## Overview

Add the interactive `/qna` loop behavior around the ledger-backed extraction pipeline. This task scopes the agent-facing `qna` tool above the shared runtime, applies shared-runtime submit results into the task-04 authoritative ledger state model, preserves returned `draftSnapshot` data, and defines how empty runs, untouched questions, and loop completion behave.

## Grouping methodology

This is one committable and testable unit because it completes the user-facing `/qna` command semantics for a manual run. A small set of interactive runs can verify tool activation, loop teardown, no-results handling, and persistence of still-open questions.

## Dependencies

- Task 04.

## Parallelization

- Task 06 depends on this task for `Send updates` reactivation behavior.

## Spec coverage

### `docs/qna/qna-inbox-spec.md`

- `/qna` shall be user initiated.
  - Evidence: implemented — `extensions/qna/command.ts#registerQnaCommand` exposes `/qna` only as an explicit registered command; no auto-run path found in the changed wiring.
- `/qna` shall run in smart merged mode without a mode picker.
  - Evidence: implemented — `extensions/qna/command.ts#runQnaCommand` always runs one fixed flow with no picker branch: reconcile transcript changes, then call `maybeStartLoop(..., getUnresolvedQnaQuestions(nextState))` over the full current open ledger; `extensions/qna/command.test.ts` verifies one loop starts with merged older backlog plus newly reconciled questions.
- When the user starts `/qna`, the system shall activate the agent-facing `qna` tool only for the current QnA loop.
  - Evidence: implemented — `extensions/qna/command.ts#maybeStartLoop` calls `loopController.startLoop(...)`; `extensions/qna/loop-controller.ts#startLoop` adds only `qna`, removes `question_runtime_request`, and `markSettled()`/`enforceInactiveToolBaseline()` tear it down after the loop; covered by `extensions/qna/loop-controller.test.ts`.
- The agent-facing `qna` tool shall remain distinct from the low-level shared question-runtime request tool and shall use that runtime only when structured forms are needed.
  - Evidence: implemented — `extensions/qna/tool.ts#registerQnaTool` registers a separate `qna` tool; `execute()` opens the shared runtime form only for `action: "question_batch"` via `buildQuestionRuntimeRequest(...)` + `showQuestionRuntimeFormShell(...)`, while loop activation explicitly hides `question_runtime_request` in `extensions/qna/loop-controller.ts#startLoop`.
- While the agent-facing `qna` tool is active for `/qna`, the system shall still allow the agent to ask ordinary clarifying questions in chat when structured capture is unnecessary.
  - Evidence: implemented — `extensions/qna/loop-controller.ts#handleBeforeAgentStart` appends: `You may ask ordinary clarifying questions in chat when structured capture is unnecessary.`
- When the current `/qna` loop settles, the system shall deactivate the agent-facing `qna` tool.
  - Evidence: implemented — `extensions/qna/loop-controller.ts#markSettled` clears active loop state and removes `qna` from active tools; restoration behavior is verified in `extensions/qna/loop-controller.test.ts`.
- When the current chat is attached to an interview session, the system shall block `/qna` and direct the user back to the interview instead of mixing the two systems in one chat.
  - Evidence: implemented — `extensions/qna/command.ts#runQnaCommand` checks `getAttachedInterviewSessionId(branch)` and warns `Return to /interview instead of /qna.`; covered by `extensions/qna/command.test.ts`.
- The `/qna` interview-attachment guard shall read a hidden current-chat marker `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.
  - Evidence: implemented — `extensions/qna/interview-attachment.ts` scans branch `custom` entries with `customType === "interview.chat_attachment"`, validates `schemaVersion: 1`, and returns `interviewSessionId`; wired in `extensions/qna.ts`.
- `/qna` shall consume the shared runtime's structured submit result (`question_outcomes` or `no_user_response`) rather than parsing freeform text.
  - Evidence: implemented — `extensions/qna/tool.ts#executeQuestionBatch` passes `formResult.submitResult` directly into `applyQnaStructuredSubmitResult(...)`; `extensions/qna/runtime-submit.ts` branches on `submitResult.kind` and never reparses prose.
- When `/qna` applies structured submit results, the affected ordinary QnA records shall adopt authoritative ledger states `answered`, `skipped`, or `needs_clarification` without reparsing freeform text.
  - Evidence: implemented — `extensions/qna/runtime-submit.ts#applyQnaStructuredSubmitResult` maps structured outcomes directly to ledger states and stores the submitted outcome payload on the record; covered by `extensions/qna/runtime-submit.test.ts`.
- When a shared runtime form closes or cancels during `/qna`, the system shall preserve the returned `draftSnapshot` in branch-local state without treating it as a send.
  - Evidence: implemented — `extensions/qna/tool.ts#executeQuestionBatch` persists cancel results with `applyQnaDraftSnapshot(...)`; submit paths also preserve `draftSnapshot`; `extensions/qna/branch-state.ts` hydrates runtime draft updates from runtime control entries; covered by `extensions/qna/tool.test.ts`, `extensions/qna/runtime-submit.test.ts`, and `extensions/qna/command.test.ts`.
- When a visible ordinary QnA question is left untouched on submit, the system shall keep that question `open` in the branch-local ledger.
  - Evidence: implemented — `extensions/qna/runtime-submit.ts#applyQnaStructuredSubmitResult` leaves batched questions without an outcome unchanged and counts them as `untouched`; `extensions/qna/runtime-submit.test.ts` verifies the second question stays `open`.
- When the form is submitted with no explicit outcomes in manual `/qna`, the system shall persist ledger state and notify the user without fabricating an agent response.
  - Evidence: implemented — `extensions/qna/tool.ts#executeQuestionBatch` always `store.replaceSnapshot(applied.nextState)` before the `no_user_response` branch, then calls `ctx.ui.notify("QnA loop settled with no submitted outcomes", "info")`; `extensions/qna/tool.test.ts` verifies `no_user_response_settled` and the notification.
- When the agent signals completion for the current `/qna` loop, the system shall be allowed to end that loop even if older open ordinary QnA items remain in the ledger.
  - Evidence: implemented — `extensions/qna/tool.ts#execute` handles `action: "complete"` by `markSettled("agent_complete")` and returns remaining open question ids instead of closing them; covered by `extensions/qna/tool.test.ts`.
- When a `/qna` loop ends while older open ordinary QnA items remain, the system shall leave those items for future `/qna` or `/qna-ledger` work.
  - Evidence: implemented — `extensions/qna/tool.ts#execute` for `action: "complete"` returns backlog in `remainingOpenQuestionIds` and does not append state changes; `extensions/qna/tool.test.ts` asserts no state append occurs.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall not open an empty review popup.
  - Evidence: implemented — `extensions/qna/command.ts#maybeStartLoop` returns early with an info notification when `unresolvedQuestions.length === 0`, so no loop or form is started; `extensions/qna/command.test.ts` covers the no-op success path.
- When `/qna` finds no unresolved ordinary QnA questions, the system shall record the successful scan boundary update and show a notification.
  - Evidence: implemented — `extensions/qna/command.ts#runQnaCommand` updates `durableBoundaryEntryId` before calling `maybeStartLoop(...)` on no-op runs, and after reconciliation persists the new boundary then shows `No unresolved QnA questions remain`; covered by `extensions/qna/command.test.ts`.

## Expected end-to-end outcome

- A user can run `/qna` as a scoped manual loop layered above the shared runtime, consume structured submit results into authoritative `answered` / `skipped` / `needs_clarification` ledger states, leave others open, and exit cleanly without losing unresolved backlog or cancelled draft state.
- Empty `/qna` runs do not show dead-end UI and instead update the scan boundary and notify the user.
- `/qna` refuses to run inside an attached interview chat.

## User test at exit

1. Start `/qna` and confirm the `qna` tool activates only for that loop.
2. Leave one visible question untouched, submit, and confirm it remains `open` in the ledger.
3. Submit a manual run with no explicit outcomes and confirm the system persists state and only shows a notification.
4. Run `/qna` when there are no unresolved questions and confirm there is no empty popup.
