# Task 10 — Grill Me cross-chat resume, seeded continuation, and stale-chat synchronization

## Overview

Implement the cross-chat continuation model for Grill Me. This task makes paused and interrupted sessions discoverable across chats, resumes them into fresh clean sessions seeded from canonical state, and prevents stale older chats from continuing after another chat has advanced the same interview.

## Grouping methodology

This is one committable and testable unit because it completes the multi-chat behavior of a persisted interview without changing the active interview semantics themselves. A handful of clean-chat resume scenarios can prove discovery, seeding, and stale-session refresh rules.

## Dependencies

- Tasks 07-09.

## Parallelization

- Task 11 depends on this task for resume-related explorer actions.

## Spec coverage

### `docs/qna/grill-me-interview-spec.md`

- Paused and interrupted Grill Me sessions shall be discoverable across pi chats within the same repository.
- The system shall allow the same `grillSessionId` to be resumed from any clean chat.
- When the user resumes a Grill Me session from a clean chat, the system shall continue it by importing the latest canonical state instead of reopening the original long-context chat.
- When the system seeds a clean chat for Grill Me start or resume, it shall inject only the interview objective plus a compact canonical summary derived from `questions.json` and `spec.json` rather than raw old transcript excerpts.
- When Grill Me resumes in a fresh chat, the first visible interaction after seeding shall be the next unanswered or `needs_clarification` question form rather than an extra agent prose catch-up message.
- When the user resumes a Grill Me session, the chooser shall list each saved session with its objective, status, last updated time, and stale-packet indicator.
- The system should surface paused or interrupted Grill Me sessions in the status line so they are easy to rediscover.
- When an older chat tries to continue a Grill Me session after another chat has already advanced the same `grillSessionId`, the older chat shall have to refresh from the latest canonical state before it can continue asking new interview questions.

## Expected end-to-end outcome

- A user can resume the same Grill Me interview from any clean chat using canonical persisted state instead of the original transcript.
- Older stale chats cannot continue blindly after another chat has advanced the interview.
- Resume entrypoints clearly show which sessions exist and which ones have stale derived artifacts.

## User test at exit

1. Pause or interrupt a Grill Me session, then resume it from a different clean chat.
2. Confirm the new chat is seeded from objective plus canonical summary and jumps straight to the next question form.
3. Advance the same session from one chat, then try to continue from the older chat and confirm a refresh is required.
4. Confirm paused or interrupted sessions are visible in the chooser and status line with stale indicators.
