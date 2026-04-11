# Task 08 — `/interview` command entry, clean-chat routing, and objective confirmation

## Overview

Build the pre-interview orchestration for the interview system. This task adds the `/interview` command, chooser entrypoint, clean-chat guardrails, optional inline objective handling, temporary objective exploration, and creation of a real interview session only after the user confirms the objective.

## Grouping methodology

This is one committable and testable unit because it covers everything that happens before substantive interview questioning starts. A user can invoke `/interview` from clean and dirty chats, explore or enter an objective, and land in a properly attached clean session without needing the active interview loop yet.

## Dependencies

- Task 07.

## Parallelization

- Task 09 depends on this task.

## Spec coverage

### `docs/qna/planning-interview-spec.md`

- The system shall treat `/interview` as a dedicated planning interview system rather than as ordinary opportunistic QnA.
- `/interview` shall share only the low-level question runtime with `/qna`.
- While a chat is attached to an interview session, the system shall block `/qna` in that chat to avoid mixing the two systems.
- `/interview` shall remain the only interview command and shall open a chooser for `start new`, `resume existing`, `browse sessions`, or `cancel`.
- The interview system shall start and resume in a clean chat.
- When the user runs `/interview` after the first user message in a chat, the system shall not attach the interview directly to that chat.
- When `/interview` is invoked in a non-clean chat, the system shall prompt the user to start a new clean chat, jump back to the last interview chat, or cancel.
- For clean-chat interview start or resume, the system shall use `ctx.newSession()` to create a new pi session preseeded with imported canonical interview context instead of reusing the current dirty chat.
- When a chat attaches to or detaches from an interview session, the interview system shall mirror that state into a hidden current-chat marker `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.
- `/interview` shall accept an optional inline objective argument.
- When the user chooses `start new`, the system shall offer `enter objective` or `explore objective`.
- Objective exploration shall happen in a temporary clean chat before any persisted interview session exists.
- Objective exploration shall stay completely unpersisted until the user confirms an objective.
- The system shall confirm the objective before creating a real `interviewSessionId` or any files under `.pi/interviews/`.
- Objective exploration shall happen before that dedicated interview tool is active.

## Expected end-to-end outcome

- A user can start an interview from any chat and get safely routed into a clean session without mixing ordinary QnA into the interview.
- The attached clean chat publishes a deterministic hidden attachment marker so `/qna` and future cross-product guards can detect interview ownership without guessing.
- The user can supply an objective directly or explore one temporarily, with no committed session written until the objective is explicitly confirmed.

## User test at exit

1. Run `/interview` in a clean chat and confirm the chooser offers the expected actions.
2. Run `/interview` in a dirty chat and confirm the user must choose a clean-chat path or cancel.
3. Explore an objective, then cancel, and confirm no session files were created.
4. Confirm a session is created only after objective confirmation and that the new clean chat is attached to the interview.
5. Confirm the attached chat writes `interview.chat_attachment` with a non-null `interviewSessionId`, and detaching/ending clears it to `null`.
