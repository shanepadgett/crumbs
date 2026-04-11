# Planning Interview Specification

## Product boundary

- The system shall treat `/interview` as a dedicated planning interview system rather than as ordinary opportunistic QnA.
- `/interview` shall share only the low-level question runtime with `/qna`.
- While a chat is attached to an interview session, the system shall block `/qna` in that chat to avoid mixing the two systems.
- `/interview` shall remain the only interview command and shall open a chooser for `start new`, `resume existing`, `browse sessions`, or `cancel`.

## Clean-chat requirement

- The interview system shall start and resume in a clean chat.
- When the user runs `/interview` after the first user message in a chat, the system shall not attach the interview directly to that chat.
- When `/interview` is invoked in a non-clean chat, the system shall prompt the user to start a new clean chat, jump back to the last interview chat, or cancel.
- For clean-chat interview start or resume, the system shall use `ctx.newSession()` to create a new pi session preseeded with imported canonical interview context instead of reusing the current dirty chat.

## Objective handling

- `/interview` shall accept an optional inline objective argument.
- When the user chooses `start new`, the system shall offer `enter objective` or `explore objective`.
- Objective exploration shall happen in a temporary clean chat before any persisted interview session exists.
- Objective exploration shall stay completely unpersisted until the user confirms an objective.
- The system shall confirm the objective before creating a real `interviewSessionId` or any files under `.pi/interviews/`.

## Interview loop behavior

- The interview system shall create a distinct interview session with its own stable `interviewSessionId`.
- The interview system shall use its own dedicated agent-facing tool after objective confirmation.
- The dedicated interview agent tool shall remain distinct from the low-level shared question-runtime tool.
- Objective exploration shall happen before that dedicated interview tool is active.
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

## Repo-scoped committed session store

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

## Committed question state

- `questions.json` shall keep all linked interview question records in their current shared state, including answered and skipped questions, instead of only unresolved questions.
- `questions.json` shall store only each question's current shared state and latest submitted answer or note.
- `questions.json` shall not store transition history, rejected drafts, or intermediate edit history.
- `questions.json` shall keep enough structural data for deterministic resume without an LLM pass, including prompt, kind, option IDs, dependencies, question-graph activation rules, current shared state, and linked note fields.
- `questions.json` shall keep canonical question definitions separate from normalized follow-up relationship metadata so repeated authored occurrences of the same `questionId` do not duplicate committed question records.
- When follow-up relationships are stored for deterministic resume, `anyOfSelectedOptionIds` and `allOfSelectedOptionIds` shall be stored as occurrence-owned edge metadata rather than canonical question-definition fields.
- `questions.json` shall store question records as an ordered array with explicit `questionId` fields.
- Each committed interview question record shall use one normalized `currentState` object.
- Topic grouping shall not be stored on question records and shall instead be derived by the agent during spec compilation.

## Derived artifacts

- `spec.json` shall use a simple derived shape like `{ objective, topics: [{ title, requirements: [earsSentence] }] }`.
- `spec.json` shall not contain requirement IDs.
- `spec.json` shall not contain question history or question ID references.
- `resume-packet.json` shall be a checkpoint handoff artifact rather than the primary source of truth.
- The interview resume packet shall contain the interview objective, the current spec, the remaining decisions summary, and concise key constraints or rationale.
- `resume-packet.json` shall include explicit source `questionId` references for remaining-decision items.
- `spec.json` and `resume-packet.json` shall be refreshed only at pause, completion, and cross-chat resume checkpoints, with a stale flag in between.

## Local runtime state

- The system shall maintain local runtime state under `.pi/local/interviews/<interviewSessionId>.json`.
- `.pi/local/` shall be a git-ignored repo-local scratch area.
- The local runtime file shall store current chat attachment, interview-owned persisted copies of unsent shared-runtime drafts keyed by `questionId`, and local stale flags.
- When a chat attaches to or detaches from an interview session, the interview system shall mirror that state into a hidden current-chat marker `customType: "interview.chat_attachment"` with data `{ schemaVersion: 1, interviewSessionId: string | null }`.
- The local runtime file shall store the latest shared-runtime `draftSnapshot` keyed by `questionId`, including hidden inactive branch drafts for currently inactive follow-up branches.
- Unsent interview form drafts shall remain local-only runtime state.
- The interview system shall own durable storage of interview drafts outside the live shared runtime form.
- When the user pauses an interview with in-progress unsent edits, the system shall preserve those drafts for restoration on resume.

## Pause and interruption

- During an active interview session, the UI shall expose an explicit Pause session action.
- When the user pauses an interview, the extension shall automatically run a visible distillation pass, persist the refreshed `resume-packet.json`, and only then mark the session as paused.
- If pause-time distillation fails or is cancelled, the interview shall still enter paused state using the last good resume packet, shall mark that packet stale, and shall warn the user.
- If the user closes or cancels an interview form without using Pause, the session shall become `interrupted` rather than `paused`.
- When an interview session becomes `interrupted`, the system shall keep local drafts and the last good resume packet and shall defer a fresh distillation pass until resume time.

## Cross-chat resume

- Paused and interrupted interview sessions shall be discoverable across pi chats within the same repository.
- The system shall allow the same `interviewSessionId` to be resumed from any clean chat.
- When the user resumes an interview session from a clean chat, the system shall continue it by importing the latest canonical state instead of reopening the original long-context chat.
- When the system seeds a clean chat for interview start or resume, it shall inject only the interview objective plus a compact canonical summary derived from `questions.json` and `spec.json` rather than raw old transcript excerpts.
- When an interview resumes in a fresh chat, the first visible interaction after seeding shall be the next unanswered or `needs_clarification` question form rather than an extra agent prose catch-up message.
- When a paused or interrupted interview resumes, the system shall rehydrate the next compatible shared-runtime question batch from the latest saved local `draftSnapshot` for that session.
- When the user resumes an interview session, the chooser shall list each saved session with its objective, status, last updated time, and stale-packet indicator.
- The system should surface paused or interrupted interview sessions in the status line so they are easy to rediscover.
- When an older chat tries to continue an interview session after another chat has already advanced the same `interviewSessionId`, the older chat shall have to refresh from the latest canonical state before it can continue asking new interview questions.

## Final resolution lifecycle

- An interview session shall end only after the agent presents a final resolution summary for the objective and the user explicitly accepts that the session is done.
- Final-resolution confirmation shall use a dedicated interview confirm screen rather than a normal tracked question.
- Final-resolution confirmation shall offer `accept` or `reject`.
- When the user rejects a proposed final resolution, the system shall require a note saying what is missing or wrong.
- When the user rejects a proposed final resolution, the system shall keep the interview active and shall send only the structured rejection result plus the user's note.
- The committed interview session state shall store only the accepted final resolution summary and shall not retain rejected final-resolution proposals.
- If a completed interview session is reopened, the system shall change its shareable status back to `paused`.
- When a completed interview session is reopened, the previously accepted final resolution shall remain stored and visible as the current baseline resolution until a newly accepted one replaces it.
- When a reopened interview session is later resumed, the seeded context shall include that previous accepted final resolution as baseline context.

## Status transitions

- `abandoned` shall be reachable only through explicit user action.
- The system shall never mark an interview session `abandoned` due to inactivity, close, cancel, or failed distillation.
- An interview session marked `abandoned` shall remain resumable until it is explicitly deleted.

## Interview explorer

- The system shall provide a dedicated interview explorer overlay.
- The interview explorer shall browse repo-scoped interview sessions rather than ordinary QnA items.
- The interview explorer shall show session-level status, objective, stale state, and local-draft state clearly.
- The interview explorer shall order sessions by most recently updated first.
- The interview explorer shall collapse completed sessions or filter them out by default so active work stays prominent.
- The interview explorer shall expose at least the tabs `Overview`, `Questions`, `Remaining decisions`, `Spec`, and `Accepted resolution`.
- The `Questions` tab shall be the editable source-of-truth view over linked interview question records.
- The `Remaining decisions` tab shall be a deterministic projection over question records in state `open` or `needs_clarification`, plus not-yet-active questions blocked only by unanswered dependencies.
- When the user edits from the `Remaining decisions` tab, the system shall modify the same underlying question record rather than separate summary text.
- The `Spec` tab shall render the committed JSON spec in a readable view.
- The `Spec` tab shall not allow direct editing.
- The interview explorer shall not include a raw-history or transcript-links tab.
- The interview explorer shall allow `Resume`, `Start clean chat and resume`, `Reopen session`, `Mark abandoned`, `Unabandon`, and `Delete session` actions.
- `Delete session` shall remove both the committed `.pi/interviews/<interviewSessionId>/` directory and any local `.pi/local/interviews/<interviewSessionId>.json` runtime file in one confirmed action.
