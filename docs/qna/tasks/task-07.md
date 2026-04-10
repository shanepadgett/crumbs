# Task 07 — Grill Me session store, local runtime state, and derived artifacts

## Overview

Build the canonical persistence model for Grill Me. This task creates repo-scoped committed interview sessions under `.pi/interviews/`, git-ignored local runtime state under `.pi/local/interviews/`, normalized question storage, and the derived artifact pipeline for `spec.json` and `resume-packet.json`.

## Grouping methodology

Everything here is persistence and serialization. It is one committable and testable unit because a session can be created, written, reloaded, scanned, and diffed without implementing the interactive interview loop yet.

## Dependencies

- Tasks 01-03.

## Parallelization

- This starts the Grill Me track.
- Tasks 08-11 depend on this task.

## Spec coverage

### `docs/qna/grill-me-interview-spec.md`

- Grill Me shall create a distinct interview session with its own stable `grillSessionId`.
- The system shall store committed Grill Me sessions under `.pi/interviews/` inside the repository.
- The system shall discover sessions by scanning `.pi/interviews/*/meta.json` instead of keeping a committed index file.
- Each Grill Me session shall live under `.pi/interviews/<grillSessionId>/`.
- Each Grill Me session directory shall contain exactly `meta.json`, `questions.json`, `spec.json`, `resume-packet.json`, and optional `accepted-resolution.json`.
- `questions.json` shall be the canonical committed source of truth for shared Grill Me question records and submitted answers.
- `spec.json` and `resume-packet.json` shall be derived artifacts that can be regenerated from canonical committed state.
- `meta.json` shall stay minimal and shall contain only `grillSessionId`, objective, shareable status, timestamps, and revision counters or hashes for committed interview files.
- `meta.json` shall record whether derived files are stale relative to the current `questions.json` revision.
- The committed session store shall contain only shareable semantic state.
- The committed session store shall never persist local runtime facts such as current active chat, local session path, unsent drafts, or stale working copies.
- The committed session store shall use only shareable statuses such as `paused`, `interrupted`, `completed`, or `abandoned`.
- The committed session store shall never persist `active`.
- `questions.json` shall keep all linked Grill Me question records in their current shared state, including answered and skipped questions, instead of only unresolved questions.
- `questions.json` shall store only each question's current shared state and latest submitted answer or note.
- `questions.json` shall not store transition history, rejected drafts, or intermediate edit history.
- `questions.json` shall keep enough structural data for deterministic resume without an LLM pass, including prompt, kind, option IDs, dependencies, follow-up activation rules, current shared state, and linked note fields.
- `questions.json` shall store question records as an ordered array with explicit `questionId` fields.
- Each committed Grill Me question record shall use one normalized `currentState` object.
- Topic grouping shall not be stored on question records and shall instead be derived by the agent during spec compilation.
- `spec.json` shall use a simple derived shape like `{ objective, topics: [{ title, requirements: [earsSentence] }] }`.
- `spec.json` shall not contain requirement IDs.
- `spec.json` shall not contain question history or question ID references.
- `resume-packet.json` shall be a checkpoint handoff artifact rather than the primary source of truth.
- The Grill Me resume packet shall contain the interview objective, the current spec, the remaining decisions summary, and concise key constraints or rationale.
- `resume-packet.json` shall include explicit source `questionId` references for remaining-decision items.
- `spec.json` and `resume-packet.json` shall be refreshed only at pause, completion, and cross-chat resume checkpoints, with a stale flag in between.
- The system shall maintain local runtime state under `.pi/local/interviews/<grillSessionId>.json`.
- `.pi/local/` shall be a git-ignored repo-local scratch area.
- The local runtime file shall store current chat attachment, unsent drafts keyed by `questionId`, and local stale flags.
- Unsent Grill Me form drafts shall remain local-only runtime state.

## Expected end-to-end outcome

- Grill Me sessions have a stable on-disk shape that can be created, discovered, read, and regenerated deterministically.
- Canonical committed state lives in `questions.json`, while local-only chat attachment and unsent drafts stay outside versioned interview files.
- `spec.json` and `resume-packet.json` can be regenerated from canonical question state instead of becoming independent sources of truth.

## User test at exit

1. Create a test Grill Me session and confirm the expected directory and file set appears under `.pi/interviews/<grillSessionId>/`.
2. Confirm `.pi/local/interviews/<grillSessionId>.json` stores only local runtime state.
3. Edit canonical question state, regenerate derived files, and confirm `meta.json` revision and stale markers update correctly.
4. Scan `.pi/interviews/*/meta.json` and confirm sessions can be discovered without a committed index file.
