# Task 11 — Grill Me final resolution, explorer, and lifecycle actions

## Overview

Build the completion and maintenance surface for Grill Me. This task adds the final-resolution confirmation flow, accepted-resolution persistence, session reopening and abandonment rules, and the dedicated Grill Me explorer overlay for browsing and editing interview sessions.

## Grouping methodology

This is one committable and testable unit because it closes the interview lifecycle and gives users a durable session management UI. A user can finish an interview, reject or accept proposed resolution, reopen or abandon sessions, and manage all persisted Grill Me data from one explorer.

## Dependencies

- Tasks 07-10.

## Parallelization

- This completes the Grill Me track.

## Spec coverage

### `docs/qna/grill-me-interview-spec.md`

- A Grill Me session shall end only after the agent presents a final resolution summary for the objective and the user explicitly accepts that the session is done.
- Final-resolution confirmation shall use a dedicated Grill Me confirm screen rather than a normal tracked question.
- Final-resolution confirmation shall offer `accept` or `reject`.
- When the user rejects a proposed final resolution, the system shall require a note saying what is missing or wrong.
- When the user rejects a proposed final resolution, the system shall keep the interview active and shall send only the structured rejection result plus the user's note.
- The committed Grill Me session state shall store only the accepted final resolution summary and shall not retain rejected final-resolution proposals.
- If a completed Grill Me session is reopened, the system shall change its shareable status back to `paused`.
- When a completed Grill Me session is reopened, the previously accepted final resolution shall remain stored and visible as the current baseline resolution until a newly accepted one replaces it.
- When a reopened Grill Me session is later resumed, the seeded context shall include that previous accepted final resolution as baseline context.
- `abandoned` shall be reachable only through explicit user action.
- The system shall never mark a Grill Me session `abandoned` due to inactivity, close, cancel, or failed distillation.
- A Grill Me session marked `abandoned` shall remain resumable until it is explicitly deleted.
- The system shall provide a dedicated Grill Me explorer overlay.
- The Grill Me explorer shall browse repo-scoped interview sessions rather than ordinary QnA items.
- The Grill Me explorer shall show session-level status, objective, stale state, and local-draft state clearly.
- The Grill Me explorer shall order sessions by most recently updated first.
- The Grill Me explorer shall collapse completed sessions or filter them out by default so active work stays prominent.
- The Grill Me explorer shall expose at least the tabs `Overview`, `Questions`, `Remaining decisions`, `Spec`, and `Accepted resolution`.
- The `Questions` tab shall be the editable source-of-truth view over linked Grill Me question records.
- The `Remaining decisions` tab shall be a deterministic projection over question records in state `open` or `needs_clarification`, plus not-yet-active questions blocked only by unanswered dependencies.
- When the user edits from the `Remaining decisions` tab, the system shall modify the same underlying question record rather than separate summary text.
- The `Spec` tab shall render the committed JSON spec in a readable view.
- The `Spec` tab shall not allow direct editing.
- The Grill Me explorer shall not include a raw-history or transcript-links tab.
- The Grill Me explorer shall allow `Resume`, `Start clean chat and resume`, `Reopen session`, `Mark abandoned`, `Unabandon`, and `Delete session` actions.
- `Delete session` shall remove both the committed `.pi/interviews/<grillSessionId>/` directory and any local `.pi/local/interviews/<grillSessionId>.json` runtime file in one confirmed action.

## Expected end-to-end outcome

- Grill Me can end only through explicit user acceptance of a final resolution, while rejected proposals feed structured feedback back into the interview.
- Users can browse, inspect, edit, reopen, abandon, un-abandon, resume, and delete interview sessions from a dedicated explorer.
- Accepted resolutions persist as the current baseline for reopened work without retaining rejected resolution history.

## User test at exit

1. Drive a session to `screen: "final_resolution"`, reject it with a note, and confirm the interview stays active with a structured rejection payload.
2. Accept a final resolution and confirm the session becomes `completed` with only the accepted resolution persisted.
3. Reopen the completed session and confirm the accepted resolution remains visible as baseline context.
4. Open the Grill Me explorer and verify tabs, ordering, filters, lifecycle actions, and confirmed deletion of both committed and local runtime files.
