### 1. Plan Signature

- `Task File:` `docs/qna/tasks/task-01/task-01.md`
- `Task Title:` `Task 01 — Shared runtime request protocol, validation, and form launch`
- `Task Signature:` `task-01-shared-runtime-request-protocol-validation-form-launch`
- `Primary Code Scope:` `.gitignore`, `extensions/question-runtime/index.ts`, `extensions/question-runtime/types.ts`, `extensions/question-runtime/request-paths.ts`, `extensions/question-runtime/request-store.ts`, `extensions/question-runtime/request-validator.ts`, `extensions/question-runtime/repair-messages.ts`, `extensions/question-runtime/form-shell.ts`, `extensions/question-runtime/request-watcher.ts`, `extensions/question-runtime/tool.ts`
- `Read-only Reference Scope:` `docs/qna/tasks/task-01/task-01.md`, `docs/qna/question-runtime-core-spec.md`, `docs/qna/planning-interview-spec.md`, `extensions/qna.ts`, `extensions/shared/option-picker.ts`, `extensions/markdownlint-on-md.ts`, `extensions/web/fetch.ts`, `extensions/codex-compat/index.ts`, `extensions/codex-compat/src/path-policy.ts`, `extensions/shared/tool-observation.ts`, `extensions/workspaces/src/repo-context.ts`, `tsconfig.json`, `package.json`, `mise.toml`
- `Excluded Scope:` `external/`, `README.md`, `docs/qna/tasks/task-02/` through `task-11/`, `extensions/permissions/`, product-specific `/qna` and `/interview` implementation work

### 2. Executive Summary

This task should add the shared low-level question runtime as one standalone extension under `extensions/question-runtime/`. It should issue authorized request tickets, watch only those request files, validate structured question payloads deterministically, run the hidden repair loop with bounded retries, and launch the first read-only tabbed shell for valid requests.

This task should not implement product loop control, terminal screens, answer-entry controls, transcript extraction, qna ledger policy, interview session policy, or structured submission payloads. It should only deliver the reusable runtime plumbing that later product tasks call into.

### 3. Resolved Task-01 Contract Decisions

These are no longer assumptions.

#### 3.1 Shared runtime boundary

- The shared runtime owns only:
  - low-level authorized request issuance
  - project-local request-path policy
  - deterministic validation
  - hidden repair messaging
  - retry budgeting
  - request locking
  - read-only question-form shell launch
- Product-specific no-question outcomes and terminal screens stay outside the shared runtime.
- The low-level runtime tool is distinct from product-level agent tools such as `/qna` loop tools or interview tools.

#### 3.2 Authorized path contract

- The runtime shall resolve project root from git top-level, not current session `cwd`.
- Request files live under `<projectRoot>/.pi/local/question-runtime/requests/`.
- `.pi/local/` shall be git-ignored in this task.
- The tool returns:
  - `path`: tool-usable absolute path prefixed with `@`
  - `projectRelativePath`: display-only repo-relative path prefixed with `@`
- Example:
  - `path: @/Users/.../repo/.pi/local/question-runtime/requests/qr_0001.json`
  - `projectRelativePath: @.pi/local/question-runtime/requests/qr_0001.json`
- Internal matching and durable state use the canonical absolute path only.

Reason:

- Current file tools strip leading `@` and resolve relative paths from the active session `cwd`.
- A repo-relative path would break from nested-cwd sessions.

#### 3.3 Runtime request schema for task 01

Task 01 validates only the fields the read-only shell needs now.

```ts
type QuestionKind = "yes_no" | "multiple_choice" | "freeform";

interface AuthorizedQuestionRequest {
  questions: AuthorizedQuestionNode[];
}

interface AuthorizedQuestionBase {
  questionId: string;
  prompt: string;
  followUps?: AuthorizedQuestionNode[];
}

interface AuthorizedYesNoQuestion extends AuthorizedQuestionBase {
  kind: "yes_no";
}

interface AuthorizedFreeformQuestion extends AuthorizedQuestionBase {
  kind: "freeform";
}

interface AuthorizedMultipleChoiceOption {
  optionId: string;
  label: string;
}

interface AuthorizedMultipleChoiceQuestion extends AuthorizedQuestionBase {
  kind: "multiple_choice";
  selectionMode: "single" | "multi";
  options: AuthorizedMultipleChoiceOption[];
}

type AuthorizedQuestionNode =
  | AuthorizedYesNoQuestion
  | AuthorizedFreeformQuestion
  | AuthorizedMultipleChoiceQuestion;
```

Task-01 validation rules:

- `questions` must be a non-empty array.
- Every question must have non-empty `questionId`, `kind`, and `prompt`.
- `questionId` must be unique across the full authored payload in stable pre-order traversal.
- `followUps` may be authored inline now; later task-03 runtime behavior will normalize active questions by `questionId` into graph semantics.
- For `multiple_choice`:
  - `selectionMode` is required
  - `options` must be a non-empty array
  - every option must have non-empty `optionId` and `label`
  - `optionId` must be unique within that question
- Unknown extra fields are allowed at every object level.
- Task 01 must not validate future-task fields such as recommendation data, justification, context, suggested answers, activation rules, draft payloads, or structured submission payloads.

Minimal valid example:

```json
{
  "questions": [
    {
      "questionId": "q_scope_01",
      "kind": "freeform",
      "prompt": "What scope do you want to lock first?"
    }
  ]
}
```

#### 3.4 ID ownership

- `questionId` and `optionId` are owned by the calling extension, not by the shared runtime.
- Task 01 runtime validates caller-supplied IDs only.
- Runtime does not generate, reconcile, or rewrite IDs.

#### 3.5 Retry behavior

- Hidden retry budget is exactly `4` unique invalid contents per request.

- Track:

  - `failureCount`
  - `extraRetryBlocksGranted`
  - `pendingRetryDecision`

- Formula:

  ```ts
  allowedFailures = 4 * (1 + extraRetryBlocksGranted);
  ```

- Increment `failureCount` only for a new invalid content hash.

- When `failureCount === allowedFailures`:

  - send the normal hidden validation-failure message
  - set `pendingRetryDecision = true`
  - queue one visible Continue/Abort prompt

- While `pendingRetryDecision` is true, later edits for that same request are ignored completely.

- `Continue` grants exactly one more block of `4`.

- `Abort` stops the request permanently.

#### 3.6 Visible queue behavior

- Multiple requests may exist in one session.
- Only one visible modal may be active at a time.
- Visible queue priority:
  1. retry decision prompt
  1. ready shell launch
- Queue order within each priority is FIFO.

### 4. Requirement Coverage Map

### `docs/qna/question-runtime-core-spec.md`

- shared runtime for `/qna` and `/interview` -> new standalone extension under `extensions/question-runtime/`
- keep product workflow/storage out -> no transcript, ledger, session-store, or submit-policy logic in task 01
- stable caller-owned `questionId` -> validator requires unique non-empty IDs
- mutable presentation fields without identity churn -> validator treats `prompt` as data, not identity
- stable caller-owned `optionId` -> validator requires option IDs but runtime does not generate them
- tab-oriented cleaner UI -> shared read-only shell with no robot icon
- authorized tool flow only -> dedicated `question_runtime_request` tool and issued-path-only watcher
- tool issues request ID plus project-local temp path -> absolute `path` plus repo-relative `projectRelativePath`
- full question graph for current request -> task-01 request supports authored inline follow-ups and full static request payloads
- deterministic known-field validation -> pure validator with stable field order and issue order
- ignore unknown fields -> validator inspects only known keys
- immediate validate-on-edit -> request watcher with debounce and known-request filtering
- valid opens UI -> ready queue flushed when idle
- invalid sends hidden repair feedback -> hidden control messages only
- repair in place -> one fixed authorized file per request
- lock after consumption -> lock immediately before shell launch begins
- hidden validation messages with request ID/path/issues -> deterministic message formatter
- hidden retry budget of 4, Continue/Abort, freeze while pending -> store + prompt queue model above

### `docs/qna/planning-interview-spec.md`

- `/interview` shares only the low-level question runtime -> runtime stays product-agnostic and form-screen-only

### 5. Current Architecture Deep Dive

- `extensions/qna.ts`

  - useful as the current tab-strip and custom TUI reference
  - not reusable as-is because it mixes extraction, model prompting, answer entry, and freeform submission

- `extensions/shared/option-picker.ts`

  - best current fit for the visible Continue/Abort retry prompt

- `extensions/markdownlint-on-md.ts`

  - best current fit for hidden custom-message delivery via `pi.sendMessage(..., { deliverAs: "steer", triggerTurn: ... })`

- `extensions/web/fetch.ts` and `extensions/codex-compat/index.ts`

  - best current fit for custom tool registration style and structured result details

- `extensions/codex-compat/src/path-policy.ts`

  - confirms that relative file paths resolve from `cwd`, forcing an absolute authorized runtime path

- `extensions/shared/tool-observation.ts`

  - confirms current repo conventions for stripping `@` and normalizing path strings

- `extensions/workspaces/src/repo-context.ts`

  - best current reference for resolving git top-level from arbitrary session `cwd`

Current gaps task 01 must fill:

- no shared question runtime extension exists
- no authorized request tool exists
- no project-local runtime scratch path exists
- no deterministic request validator exists
- no durable request lifecycle state exists
- no hidden repair loop exists
- no branch-aware question-request restore flow exists

### 6. Target Architecture

#### 6.1 Extension layout

- `extensions/question-runtime/index.ts`
- `extensions/question-runtime/types.ts`
- `extensions/question-runtime/request-paths.ts`
- `extensions/question-runtime/request-store.ts`
- `extensions/question-runtime/request-validator.ts`
- `extensions/question-runtime/repair-messages.ts`
- `extensions/question-runtime/form-shell.ts`
- `extensions/question-runtime/request-watcher.ts`
- `extensions/question-runtime/tool.ts`

Use `extensions/question-runtime/index.ts`, not `extensions/question-runtime.ts`.

#### 6.2 Module responsibilities

- `index.ts`

  - extension entrypoint and orchestration only
  - holds current `ctx`, store, watcher, visible queues, and modal state
  - hydrates on `session_start`
  - rehydrates and rescans on `session_tree`
  - closes watcher and clears queues on `session_shutdown`
  - flushes retry prompts before shell launches

- `types.ts`

  - shared request, validation, and runtime state types only

- `request-paths.ts`

  - resolve project root
  - build request directory and request file paths
  - return absolute tool path and repo-relative display path
  - normalize canonical absolute paths for matching

- `request-store.ts`

  - durable request lifecycle state via `pi.appendEntry()` snapshots
  - hydrate from `ctx.sessionManager.getBranch()` only
  - own dedupe, retry math, and state transitions

- `request-validator.ts`

  - parse JSON safely
  - validate only task-01-known fields
  - emit stable ordered `ValidationIssue[]`

- `repair-messages.ts`

  - build deterministic hidden control messages
  - no state mutation

- `form-shell.ts`

  - read-only tabbed runtime shell
  - flatten authored inline questions in stable pre-order for task-01 display only
  - no answer controls or submit controls

- `request-watcher.ts`

  - watch request directory only
  - debounce `rename` and `change`
  - read known request files, hash contents, invoke validator, return structured outcomes

- `tool.ts`

  - register `question_runtime_request`
  - generate request IDs
  - ensure request directory exists
  - create pending store records
  - return ticket plus minimal template

#### 6.3 Durable state model

```ts
export const QUESTION_RUNTIME_STATE_ENTRY = "question-runtime.state";

export type RuntimeRequestStatus = "pending" | "ready" | "locked" | "aborted";

export interface RuntimeRequestRecord {
  requestId: string;
  path: string;
  projectRelativePath: string;
  status: RuntimeRequestStatus;
  failureCount: number;
  extraRetryBlocksGranted: number;
  pendingRetryDecision: boolean;
  lastProcessedContentHash?: string;
}

export interface QuestionRuntimeStateSnapshot {
  requests: RuntimeRequestRecord[];
}
```

Persistence rules:

- hydrate from the latest `question-runtime.state` custom entry on the current branch
- persist a full snapshot after every mutating state transition
- do not hydrate from `getEntries()`
- on `session_tree`, clear visible queues, rehydrate branch state, and rescan known request files

#### 6.4 Data flow

1. Agent calls `question_runtime_request`.
1. Tool resolves project root, ensures request directory exists, creates `requestId`, persists `pending` record, and returns the ticket.
1. Agent writes one JSON object to the issued absolute path.
1. Watcher sees the change, filters to known request files, reads current contents, hashes them, and asks the store whether this hash should be processed.
1. Validator parses and validates the text.
1. If invalid:
   - store records failure and computes `allowedFailures`
   - orchestrator sends hidden validation feedback
   - if exhaustion was hit, orchestrator queues Continue/Abort and freezes further edits for that request
1. If valid:
   - store marks request `ready`
   - orchestrator queues shell launch for the parsed request
1. When idle and no higher-priority prompt is active:
   - orchestrator locks the request
   - opens the shared read-only shell
1. Later edits to the locked file are ignored.

### 7. File-by-File Implementation Plan

- `Path:` `.gitignore`

  - `Action:` `modify`
  - `Change:` add exactly `.pi/local/`
  - `Reason:` runtime scratch stays out of git status

- `Path:` `extensions/question-runtime/index.ts`

  - `Action:` `add`

  - `Responsibilities:`

    - required extension documentation header
    - store current context and modal state
    - start watcher on `session_start`
    - rehydrate and rescan on `session_tree`
    - close watcher on `session_shutdown`
    - handle Continue/Abort via `showOptionPicker()`
    - lock immediately before shell launch

  - `Export:`

    ```ts
    export default function questionRuntimeExtension(pi: ExtensionAPI): void;
    ```

- `Path:` `extensions/question-runtime/types.ts`

  - `Action:` `add`
  - `Responsibilities:` request model, validation issues, runtime state types

- `Path:` `extensions/question-runtime/request-paths.ts`

  - `Action:` `add`
  - `Responsibilities:` project-root resolution, directory creation, absolute/display path building, absolute-path normalization

- `Path:` `extensions/question-runtime/request-store.ts`

  - `Action:` `add`
  - `Responsibilities:` branch-aware hydrate/persist, dedupe, retry math, and lifecycle transitions
  - `Rules:`
    - store owns content-hash dedupe
    - store owns retry math
    - watcher must not duplicate those rules

- `Path:` `extensions/question-runtime/request-validator.ts`

  - `Action:` `add`
  - `Responsibilities:` safe parse, deterministic known-field validation, duplicate-ID checks
  - `Issue path format:` JSONPath-like, starting with `$`

- `Path:` `extensions/question-runtime/repair-messages.ts`

  - `Action:` `add`
  - `Responsibilities:` build hidden `question-runtime.control` messages for validation failure, retry granted, and abort

- `Path:` `extensions/question-runtime/form-shell.ts`

  - `Action:` `add`
  - `Responsibilities:`
    - tab strip
    - read-only question body
    - neutral runtime chrome
    - close/cancel only
  - `Non-goals:` answer controls, recommendation/justification UI, submit behavior

- `Path:` `extensions/question-runtime/request-watcher.ts`

  - `Action:` `add`
  - `Responsibilities:` request-directory watch, debounce, file read, hash, validator call, structured callback emission
  - `Ignore:` unknown files, locked requests, aborted requests, frozen requests, missing files after save events

- `Path:` `extensions/question-runtime/tool.ts`

  - `Action:` `add`
  - `Responsibilities:` tool registration, request ID generation, pending-record creation, ticket/template result
  - `Tool schema:` empty object

### 8. Deterministic Validator Order

Validation order must be fixed exactly like this:

1. parse JSON text
   - on parse failure emit one issue at `$` and stop
1. validate top-level object
1. validate `questions`
1. validate questions in stable pre-order
   - `questionId`
   - `kind`
   - `prompt`
   - `multiple_choice.selectionMode`
   - `multiple_choice.options`
   - each option `optionId`
   - each option `label`
   - `followUps`
1. after structural walk, run duplicate checks in discovery order
   - duplicate `questionId` across full request
   - duplicate `optionId` within each `multiple_choice` question

Issue codes:

- `json_parse`
- `expected_object`
- `missing_required`
- `invalid_type`
- `invalid_enum`
- `empty_string`
- `empty_array`
- `duplicate_question_id`
- `duplicate_option_id`

### 9. Stepwise Execution Plan

1. Update `.gitignore` with `.pi/local/`.
1. Add `types.ts` and `request-paths.ts`.
1. Add `request-validator.ts`.
1. Add `request-store.ts`.
1. Add `tool.ts` and `repair-messages.ts`.
1. Add `form-shell.ts`.
1. Add `request-watcher.ts`.
1. Wire `index.ts`.
1. Reload extensions with `/reload`.
1. Manually verify lifecycle scenarios.
1. Run `mise run check`.

Parallel notes:

- steps 3 and 4 should settle before watcher work starts
- step 5 can overlap with step 6
- step 8 is last

### 10. Validation Plan

Pure verification:

- `request-paths.ts`

  - nested `cwd` still resolves same project root
  - emitted `path` is absolute and `@`-prefixed
  - emitted `projectRelativePath` matches `.pi/local/question-runtime/requests/<requestId>.json`

- `request-validator.ts`

  - malformed JSON -> one `json_parse` issue at `$`
  - missing `questions`
  - empty `questions`
  - missing `questionId`
  - invalid `kind`
  - missing `prompt`
  - `multiple_choice` missing `selectionMode`
  - `multiple_choice` empty `options`
  - option missing `optionId`
  - option missing `label`
  - duplicate `questionId`
  - duplicate `optionId`
  - unknown extra fields but otherwise valid -> valid

- `request-store.ts`

  - hydrate from latest branch snapshot only
  - identical content hash is ignored
  - fourth unique invalid hash exhausts first retry block
  - Continue raises allowance from `4` to `8`
  - pending retry decision freezes that request
  - lock prevents later processing

Manual verification:

- tool returns `requestId`, absolute `path`, and repo-relative `projectRelativePath`
- invalid file edits send hidden repair feedback and do not open UI
- fourth unique invalid content shows Continue/Abort once
- while prompt is pending, more edits to same request do nothing
- Continue grants exactly four more invalid attempts
- Abort stops the request permanently
- valid file opens clean tabbed shell
- edits after lock do not reopen the shell
- absolute path works from a nested repo subdirectory session
- reload and branch navigation restore only branch-local runtime state

### 11. Non-Goals for Task 01

- no rewrite of `extensions/qna.ts`
- no `/interview` command work
- no answer-entry controls
- no recommendation/justification rendering
- no submission payload construction
- no runtime graph activation semantics beyond accepting graph-ready authored structure
- no product-specific draft persistence
- no product-specific no-question or terminal-screen handling
