# Task 08 — `/grill-me` command entry, clean-chat routing, and objective confirmation

## Overview

Build the pre-interview orchestration for Grill Me. This task adds the `/grill-me` command, chooser entrypoint, clean-chat guardrails, optional inline objective handling, temporary objective exploration, and creation of a real interview session only after the user confirms the objective.

## Grouping methodology

This is one committable and testable unit because it covers everything that happens before substantive interview questioning starts. A user can invoke `/grill-me` from clean and dirty chats, explore or enter an objective, and land in a properly attached clean session without needing the active interview loop yet.

## Dependencies

- Task 07.

## Parallelization

- Task 09 depends on this task.

## Spec coverage

### `docs/qna/grill-me-interview-spec.md`

- The system shall treat `/grill-me` as a dedicated planning interview system rather than as ordinary opportunistic QnA.
- `/grill-me` shall share only the low-level question runtime with `/qna`.
- While a chat is attached to a Grill Me interview session, the system shall block `/qna` in that chat to avoid mixing the two systems.
- `/grill-me` shall remain the only Grill Me command and shall open a chooser for `start new`, `resume existing`, `browse sessions`, or `cancel`.
- Grill Me shall start and resume in a clean chat.
- When the user runs `/grill-me` after the first user message in a chat, the system shall not attach Grill Me directly to that chat.
- When `/grill-me` is invoked in a non-clean chat, the system shall prompt the user to start a new clean chat, jump back to the last Grill Me chat, or cancel.
- For clean-chat Grill Me start or resume, the system shall use `ctx.newSession()` to create a new pi session preseeded with imported canonical interview context instead of reusing the current dirty chat.
- `/grill-me` shall accept an optional inline objective argument.
- When the user chooses `start new`, the system shall offer `enter objective` or `explore objective`.
- Objective exploration shall happen in a temporary clean chat before any persisted Grill Me session exists.
- Objective exploration shall stay completely unpersisted until the user confirms an objective.
- The system shall confirm the objective before creating a real `grillSessionId` or any files under `.pi/interviews/`.
- Objective exploration shall happen before that dedicated Grill Me tool is active.

## Expected end-to-end outcome

- A user can start Grill Me from any chat and get safely routed into a clean session without mixing ordinary QnA into the interview.
- The user can supply an objective directly or explore one temporarily, with no committed session written until the objective is explicitly confirmed.

## User test at exit

1. Run `/grill-me` in a clean chat and confirm the chooser offers the expected actions.
2. Run `/grill-me` in a dirty chat and confirm the user must choose a clean-chat path or cancel.
3. Explore an objective, then cancel, and confirm no session files were created.
4. Confirm a session is created only after objective confirmation and that the new clean chat is attached to Grill Me.
