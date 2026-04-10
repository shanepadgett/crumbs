# Task 10 — Interview cross-chat resume, seeded continuation, and stale-chat synchronization

## Overview

Implement the cross-chat continuation model for Interview. This task makes paused and interrupted sessions discoverable across chats, resumes them into fresh clean sessions seeded from canonical state, and prevents stale older chats from continuing after another chat has advanced the same interview.

## Grouping methodology

This is one committable and testable unit because it completes the multi-chat behavior of a persisted interview without changing the active interview semantics themselves. A handful of clean-chat resume scenarios can prove discovery, seeding, and stale-session refresh rules.

## Dependencies

- Tasks 07-09.

## Parallelization

- Task 11 depends on this task for resume-related explorer actions.

## Spec coverage

### `docs/qna/planning-interview-spec.md`

- Paused and interrupted interview sessions shall be discoverable across pi chats within the same repository.
- The system shall allow the same `interviewSessionId` to be resumed from any clean chat.
- When the user resumes an interview session from a clean chat, the system shall continue it by importing the latest canonical state instead of reopening the original long-context chat.
- When the system seeds a clean chat for interview start or resume, it shall inject only the interview objective plus a compact canonical summary derived from `questions.json` and `spec.json` rather than raw old transcript excerpts.
- When an interview resumes in a fresh chat, the first visible interaction after seeding shall be the next unanswered or `needs_clarification` question form rather than an extra agent prose catch-up message.
- When a paused or interrupted interview resumes, the system shall rehydrate the next compatible shared-runtime question batch from the latest saved local `draftSnapshot` for that session.
- When the user resumes an interview session, the chooser shall list each saved session with its objective, status, last updated time, and stale-packet indicator.
- The system should surface paused or interrupted interview sessions in the status line so they are easy to rediscover.
- When an older chat tries to continue an interview session after another chat has already advanced the same `interviewSessionId`, the older chat shall have to refresh from the latest canonical state before it can continue asking new interview questions.

## Expected end-to-end outcome

- A user can resume the same interview from any clean chat using canonical persisted state instead of the original transcript.
- Resume rehydrates the next compatible shared-runtime question batch from the latest saved local `draftSnapshot` when available.
- Older stale chats cannot continue blindly after another chat has advanced the interview.
- Resume entrypoints clearly show which sessions exist and which ones have stale derived artifacts.

## User test at exit

1. Pause or interrupt an interview session, then resume it from a different clean chat.
2. Confirm the new chat is seeded from objective plus canonical summary and jumps straight to the next question form.
3. Advance the same session from one chat, then try to continue from the older chat and confirm a refresh is required.
4. Confirm paused or interrupted sessions are visible in the chooser and status line with stale indicators.
