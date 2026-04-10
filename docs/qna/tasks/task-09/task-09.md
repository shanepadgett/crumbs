# Task 09 — Interview active interview loop, dedicated tool flow, and pause or interruption handling

## Overview

Implement the live interview loop on top of the shared runtime and persisted session model. This task adds the dedicated interview tool, objective-scoped question batches that compile into shared runtime forms, and the pause or interruption lifecycle for active work.

## Grouping methodology

This is one committable and testable unit because it completes the active in-chat interview behavior while leaving cross-chat resume and explorer workflows for later. A single live session can verify batch sizing, question delivery, pause distillation, and interrupted-session handling.

## Dependencies

- Tasks 07-08.

## Parallelization

- Task 10 depends on this task.

## Spec coverage

### `docs/qna/planning-interview-spec.md`

- The interview system shall use its own dedicated agent-facing tool after objective confirmation.
- The dedicated interview agent tool shall remain distinct from the low-level shared question-runtime tool.
- While an interview is running, the system shall scope questions to the interview objective.
- While an interview is running, the system shall ignore unrelated open questions instead of mixing them into the interview.
- While an interview is running, the system shall instruct the agent to ask the smallest semantically valid batch of questions and shall cap each batch at 3 questions.
- When the interview can resolve a decision with a smaller batch, the system shall prefer 1 question over 2 or 3.
- Once the objective is confirmed and the interview is active, the agent shall route substantive interview turns through the dedicated interview tool and use normal chat only for brief setup, status, or error text.
- Interview question batches shall use explicit `screen: "question_batch" | "final_resolution"` semantics.
- A `screen: "question_batch"` payload shall compile into one shared question-runtime request rather than redefining the low-level runtime protocol.
- When a `screen: "question_batch"` form is submitted, the interview system shall consume the shared runtime's structured `question_outcomes` or `no_user_response` result rather than parsing freeform text.
- When a `screen: "question_batch"` form closes or submits, the interview system shall preserve the returned `draftSnapshot` separately from committed submitted state.
- A `screen: "final_resolution"` payload shall bypass the shared question runtime and use the dedicated interview final-resolution confirm screen.
- A `screen: "final_resolution"` payload shall mean the agent wants to try to finish, but the interview shall complete only if the user accepts.
- Each `screen: "question_batch"` payload shall contain the full current renderable question snapshot for that step rather than incremental patches.
- When the user pauses an interview with in-progress unsent edits, the system shall preserve those drafts for restoration on resume.
- During an active interview session, the UI shall expose an explicit Pause session action.
- When the user pauses an interview, the extension shall automatically run a visible distillation pass, persist the refreshed `resume-packet.json`, and only then mark the session as paused.
- If pause-time distillation fails or is cancelled, the interview shall still enter paused state using the last good resume packet, shall mark that packet stale, and shall warn the user.
- If the user closes or cancels an interview form without using Pause, the session shall become `interrupted` rather than `paused`.
- When an interview session becomes `interrupted`, the system shall keep local drafts and the last good resume packet and shall defer a fresh distillation pass until resume time.

## Expected end-to-end outcome

- After objective confirmation, the interview system can conduct a real interview through its dedicated tool using small, objective-scoped batches that render through the shared runtime and return structured outcomes plus the latest `draftSnapshot`.
- Final-resolution attempts bypass the shared runtime and use the dedicated confirm screen.
- Pausing produces or reuses a resume packet correctly, while closing without Pause leaves the session interrupted with drafts intact.

## User test at exit

1. Start an interview and confirm the agent asks at most three questions and prefers fewer when possible.
2. Confirm substantive interview turns flow through the dedicated interview tool, while question batches render through the shared runtime form.
3. Drive a `screen: "final_resolution"` attempt and confirm it uses the dedicated confirm screen rather than the shared runtime form.
4. Pause the session and confirm a visible distillation pass refreshes `resume-packet.json` before status becomes `paused`.
