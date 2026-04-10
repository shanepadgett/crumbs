# Task 09 — Grill Me active interview loop, dedicated tool flow, and pause or interruption handling

## Overview

Implement the live Grill Me interview loop on top of the shared runtime and persisted session model. This task adds the dedicated interview tool, objective-scoped question batches, full-snapshot screen payloads, and the pause or interruption lifecycle for active work.

## Grouping methodology

This is one committable and testable unit because it completes the active in-chat interview behavior while leaving cross-chat resume and explorer workflows for later. A single live session can verify batch sizing, question delivery, pause distillation, and interrupted-session handling.

## Dependencies

- Tasks 07-08.

## Parallelization

- Task 10 depends on this task.

## Spec coverage

### `docs/qna/grill-me-interview-spec.md`

- Grill Me shall use its own dedicated agent-facing tool after objective confirmation.
- While Grill Me is running, the system shall scope questions to the interview objective.
- While Grill Me is running, the system shall ignore unrelated open questions instead of mixing them into the interview.
- While Grill Me is running, the system shall instruct the agent to ask the smallest semantically valid batch of questions and shall cap each batch at 3 questions.
- When Grill Me can resolve a decision with a smaller batch, the system shall prefer 1 question over 2 or 3.
- Once the objective is confirmed and Grill Me is active, the agent shall route substantive interview turns through the dedicated Grill Me tool and use normal chat only for brief setup, status, or error text.
- Grill Me question batches shall use explicit `screen: "question_batch" | "final_resolution"` semantics rather than `loopAction`.
- A `screen: "final_resolution"` payload shall mean the agent wants to try to finish, but the interview shall complete only if the user accepts.
- Each `screen: "question_batch"` payload shall contain the full current renderable question snapshot for that step rather than incremental patches.
- When the user pauses Grill Me with in-progress unsent edits, the system shall preserve those drafts for restoration on resume.
- During an active Grill Me session, the UI shall expose an explicit Pause session action.
- When the user pauses Grill Me, the extension shall automatically run a visible distillation pass, persist the refreshed `resume-packet.json`, and only then mark the session as paused.
- If pause-time distillation fails or is cancelled, Grill Me shall still enter paused state using the last good resume packet, shall mark that packet stale, and shall warn the user.
- If the user closes or cancels a Grill Me form without using Pause, the session shall become `interrupted` rather than `paused`.
- When a Grill Me session becomes `interrupted`, the system shall keep local drafts and the last good resume packet and shall defer a fresh distillation pass until resume time.

## Expected end-to-end outcome

- After objective confirmation, Grill Me can conduct a real interview through its dedicated tool using small, objective-scoped batches.
- Pausing produces or reuses a resume packet correctly, while closing without Pause leaves the session interrupted with drafts intact.

## User test at exit

1. Start an interview and confirm the agent asks at most three questions and prefers fewer when possible.
2. Confirm substantive interview turns flow through the dedicated Grill Me tool rather than ordinary chat prose.
3. Pause the session and confirm a visible distillation pass refreshes `resume-packet.json` before status becomes `paused`.
4. Close the form without pausing and confirm the session becomes `interrupted` and keeps local drafts.
