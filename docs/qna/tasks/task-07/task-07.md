# Task 07 — Interview session store, local runtime state, and derived artifacts

## Overview

Build the canonical persistence model for the interview system. This task creates repo-scoped committed interview sessions under `.pi/interviews/`, git-ignored local runtime state under `.pi/local/interviews/`, normalized question storage, and the derived artifact pipeline for `spec.json` and `resume-packet.json`.

## Grouping methodology

Everything here is persistence and serialization. It is one committable and testable unit because a session can be created, written, reloaded, scanned, and diffed without implementing the interactive interview loop yet.

## Dependencies

- Tasks 01-03.

## Parallelization

- This starts the interview track.
- Tasks 08-11 depend on this task.

## Spec coverage

### `docs/qna/planning-interview-spec.md`

- The interview system shall create a distinct interview session with its own stable `interviewSessionId`.
- The system shall store committed interview sessions under `.pi/interviews/` inside the repository.
- The system shall discover sessions by scanning `.pi/interviews/*/meta.json` instead of keeping a committed index file.
- Each interview session shall live under `.pi/interviews/<interviewSessionId>/`.
- Each interview session directory shall contain exactly `meta.json`, `questions.json`, `spec.json`, `resume-packet.json`, and optional `accepted-resolution.json`.
- `questions.json` shall be the canonical committed source of truth for shared interview question records and submitted answers.
- `spec.json` and `resume-packet.json` shall be derived artifacts that can be regenerated from canonical committed state.
- `meta.json` shall stay minimal and shall contain only `interviewSessionId`, objective, shareable status, timestamps, and revision counters or hashes for committed interview files.
- `meta.json` shall record whether derived files are stale relative to the current `questions.json` revision.
- The committed session store shall contain only shareable semantic state.
- The committed session store shall never persist local runtime facts such as current active chat, local session path, unsent drafts, or stale working copies.
- The committed session store shall use only shareable statuses such as `paused`, `interrupted`, `completed`, or `abandoned`.
- The committed session store shall never persist `active`.
- `questions.json` shall keep all linked interview question records in their current shared state, including answered and skipped questions, instead of only unresolved questions.
- `questions.json` shall store only each question's current shared state and latest submitted answer or note.
- `questions.json` shall not store transition history, rejected drafts, or intermediate edit history.
- `questions.json` shall keep enough structural data for deterministic resume without an LLM pass, including prompt, kind, option IDs, dependencies, question-graph activation rules, current shared state, and linked note fields.
- `questions.json` shall keep canonical question definitions separate from normalized follow-up relationship metadata so repeated authored occurrences of the same `questionId` do not duplicate committed question records.
- When follow-up relationships are stored for deterministic resume, `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` shall be stored as occurrence-owned edge metadata rather than canonical question-definition fields.
- `questions.json` shall store question records as an ordered array with explicit `questionId` fields.
- Each committed interview question record shall use one normalized `currentState` object.
- Topic grouping shall not be stored on question records and shall instead be derived by the agent during spec compilation.
- `spec.json` shall use a simple derived shape like `{ objective, topics: [{ title, requirements: [earsSentence] }] }`.
- `spec.json` shall not contain requirement IDs.
- `spec.json` shall not contain question history or question ID references.
- `resume-packet.json` shall be a checkpoint handoff artifact rather than the primary source of truth.
- The interview resume packet shall contain the interview objective, the current spec, the remaining decisions summary, and concise key constraints or rationale.
- `resume-packet.json` shall include explicit source `questionId` references for remaining-decision items.
- `spec.json` and `resume-packet.json` shall be refreshed only at pause, completion, and cross-chat resume checkpoints, with a stale flag in between.
- The system shall maintain local runtime state under `.pi/local/interviews/<interviewSessionId>.json`.
- `.pi/local/` shall be a git-ignored repo-local scratch area.
- The local runtime file shall store current chat attachment, interview-owned persisted copies of unsent shared-runtime drafts keyed by `questionId`, and local stale flags.
- When a chat attaches to or detaches from an interview session, the interview system shall mirror that state into a hidden current-chat marker `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.
- The local runtime file shall store the latest shared-runtime `draftSnapshot` keyed by `questionId`, including hidden inactive branch drafts for currently inactive follow-up branches.
- Unsent interview form drafts shall remain local-only runtime state.
- The interview system shall own durable storage of interview drafts outside the live shared runtime form.

## Expected end-to-end outcome

- Interview sessions have a stable on-disk shape that can be created, discovered, read, and regenerated deterministically.
- Canonical committed state lives in `questions.json`, while local-only chat attachment and the latest shared-runtime `draftSnapshot` stay outside versioned interview files.
- Chat-attachment state is mirrored into hidden session markers so non-interview commands (for example `/qna`) can enforce cross-product guardrails without reading interview storage internals.
- `spec.json` and `resume-packet.json` can be regenerated from canonical question state instead of becoming independent sources of truth.

## User test at exit

1. Create a test interview session and confirm the expected directory and file set appears under `.pi/interviews/<interviewSessionId>/`.
2. Confirm `.pi/local/interviews/<interviewSessionId>.json` stores only local runtime state and interview-owned persisted drafts.
3. Edit canonical question state, regenerate derived files, and confirm `meta.json` revision and stale markers update correctly.
4. Scan `.pi/interviews/*/meta.json` and confirm sessions can be discovered without a committed index file.
