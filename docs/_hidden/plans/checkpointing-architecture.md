# Pi Checkpointing Architecture

This is the implementation plan for Pi-native checkpointing.

The goal is simple:

- capture workspace state automatically during agent work
- attach restore points to user messages
- restore code and conversation together
- keep snapshot storage durable and isolated from the user's project history

## Build shape

This should be a standalone extension package:

```text
extensions/checkpoints/
  index.ts
  package.json
  README.md
  src/constants.ts
  src/types.ts
  src/config.ts
  src/runtime.ts
  src/session-index.ts
  src/maintenance.ts
  src/git/identity.ts
  src/git/repo.ts
  src/git/capture.ts
  src/git/diff.ts
  src/git/restore.ts
  src/hooks/agent.ts
  src/hooks/session.ts
  src/hooks/tree.ts
  src/hooks/fork.ts
  src/commands.ts
  src/ui/picker.ts
  src/ui/diff-view.ts
extensions/shared/workspace-mutation.ts
```

## File responsibilities

### `extensions/checkpoints/index.ts`

Thin entrypoint.

- registers hooks
- registers commands
- creates runtime state

### `extensions/checkpoints/src/constants.ts`

Shared constants.

- custom entry type names
- ref prefixes
- default retention values
- command names

### `extensions/checkpoints/src/types.ts`

Core types and serialized payload shapes.

- workspace identity
- active prompt state
- per-turn summary
- message checkpoint entry
- restore state entry
- changed-file summary

### `extensions/checkpoints/src/config.ts`

Local configuration surface for the extension.

Initial values should stay code-defined:

- snapshot root under `~/.pi/agent/checkpoints`
- retention count
- retention age
- gc interval
- tree restore prompt behavior

### `extensions/checkpoints/src/runtime.ts`

In-memory runtime container.

- active workspace identity
- active prompt capture state
- current branch checkpoint index
- active restore/redo state
- serialized git operation queue
- last maintenance timestamp

### `extensions/checkpoints/src/session-index.ts`

All session-facing persistence logic.

- append checkpoint entries with `pi.appendEntry()`
- append restore state entries
- rebuild index from `ctx.sessionManager.getBranch()`
- resolve checkpoint targets by message id or recent ordering
- locate user message text and parent leaf ids

This module is the boundary between Pi session semantics and Git snapshot storage.

### `extensions/checkpoints/src/maintenance.ts`

Background and command-triggered cleanup.

- prune expired refs
- drop cleared redo refs
- cap retained checkpoints per session/worktree
- run `git gc` on the snapshot repo when needed

### `extensions/checkpoints/src/git/identity.ts`

Derive stable storage identity.

- canonical workspace path
- project id
- worktree hash
- session key for ref namespacing
- snapshot repo path

Recommended shape:

- project id from canonical git top-level when available, otherwise canonical `ctx.cwd`
- worktree hash from canonical `ctx.cwd`
- session key from current session file path or Pi session id

### `extensions/checkpoints/src/git/repo.ts`

Snapshot repository manager.

- initialize repo if missing
- set repo config
- serialize git operations through one queue
- expose helpers for `update-ref`, `rev-parse`, `write-tree`, `commit-tree`, `gc`

This module should keep all commands explicit with `--git-dir` and `--work-tree` so it never depends on the user's project `.git` directory.

### `extensions/checkpoints/src/git/capture.ts`

Create snapshot commits and summarize changes.

- stage workspace into snapshot repo index with `git add -A -- .`
- create durable commit objects
- compute `before..after` file summaries
- promote temporary per-turn refs into message-level refs at prompt end

### `extensions/checkpoints/src/git/diff.ts`

Diff helpers.

- name-status
- numstat
- full patch text
- binary and oversized file handling

This module should return structured data for both commands and future per-turn rollup UI.

### `extensions/checkpoints/src/git/restore.ts`

Workspace restore engine.

- capture redo snapshot before destructive restore
- restore files from a target checkpoint commit
- delete files not present in the target snapshot
- verify post-restore diff is empty
- restore redo snapshot when requested

### `extensions/checkpoints/src/hooks/agent.ts`

All agent lifecycle behavior.

- `agent_start`
- `turn_start`
- `tool_call`
- `turn_end`
- `agent_end`

This module owns prompt aggregation and turn capture.

### `extensions/checkpoints/src/hooks/session.ts`

Session lifecycle behavior.

- `session_start`
- `session_switch`
- `session_tree`
- `session_shutdown`

This module rebuilds runtime state from session entries whenever the active branch changes.

### `extensions/checkpoints/src/hooks/tree.ts`

Checkpoint-aware tree navigation.

- detect when a tree target has a matching checkpoint state
- prompt whether to restore workspace state
- apply restore after navigation when chosen

### `extensions/checkpoints/src/hooks/fork.ts`

Checkpoint-aware fork behavior.

- map fork target to checkpoint semantics
- restore matching workspace state in the forked session
- preserve branch-local checkpoint metadata

### `extensions/checkpoints/src/commands.ts`

User command registration.

- `/checkpoints`
- `/checkpoint-diff`
- `/checkpoint-restore`
- `/checkpoint-redo`

### `extensions/checkpoints/src/ui/picker.ts`

Checkpoint selection UI.

- recent restore points in reverse order
- message preview
- file count and line summary
- target resolution for commands without arguments

### `extensions/checkpoints/src/ui/diff-view.ts`

Checkpoint inspection UI.

- compact file list
- full patch text when requested
- binary and large-file fallback summaries

### `extensions/shared/workspace-mutation.ts`

Shared mutation classifier used by checkpointing.

- known file mutation tools
- bash command classification
- conservative `mayMutateWorkspace()` result
- optional path hints from tool input

This should stay shared because the same classification is useful for change rollups and other workspace-aware features.

## Semantic model

The implementation should use four nested concepts.

### Workspace

The workspace is the active Pi `cwd`.

- snapshot scope is the active workspace root
- one snapshot repo exists per workspace
- worktrees are isolated from each other

### Prompt

A prompt is one `agent_start` to `agent_end` cycle.

- one prompt maps to one user message
- one prompt creates zero or one message-level checkpoint entry
- one prompt may contain multiple internal turns

### Turn

A turn is one `turn_start` to `turn_end` cycle.

- capture happens at turn boundaries
- a prompt may have multiple turns
- turn data is aggregated into the prompt restore point

### Restore point

A restore point is attached to one user message.

- `before` means the workspace state just before that user message started agent work
- `after` means the workspace state after that prompt fully finished
- `/checkpoint-restore` restores to `before`
- tree and fork integration choose `before` or `after` based on the target entry

## Serialized data model

### Message checkpoint entry

```ts
type ChangedFileSummary = {
  path: string;
  status: "added" | "deleted" | "modified";
  additions: number;
  deletions: number;
  binary?: boolean;
};

type TurnSummary = {
  turnIndex: number;
  startedAt: string;
  finishedAt: string;
  changedFiles: ChangedFileSummary[];
  totals: { files: number; additions: number; deletions: number };
};

type MessageCheckpointEntry = {
  version: 1;
  workspaceRoot: string;
  projectId: string;
  worktreeHash: string;
  sessionKey: string;
  userMessageId: string;
  parentLeafId: string | null;
  completionLeafId: string | null;
  beforeRef: string;
  afterRef: string;
  turns: TurnSummary[];
  changedFiles: ChangedFileSummary[];
  totals: { files: number; additions: number; deletions: number };
  createdAt: string;
};
```

### Restore state entry

```ts
type RestoreStateEntry = {
  version: 1;
  kind: "restore" | "clear";
  workspaceRoot: string;
  targetMessageId: string;
  targetLeafId: string | null;
  previousLeafId: string | null;
  redoRef?: string;
  createdAt: string;
};
```

These entries are append-only. Runtime state is reconstructed by scanning the current branch and taking the latest relevant value.

## Snapshot repo semantics

Each workspace gets one snapshot repo.

- path: `~/.pi/agent/checkpoints/<project-id>/<worktree-hash>/`
- all snapshot commands run with `--git-dir <repo>` and `--work-tree <workspace-root>`
- ignored files follow the workspace's `.gitignore`
- snapshot objects are durable because live message checkpoints are pinned by refs

Recommended ref layout:

- `refs/pi/session/<session-key>/message/<message-id>/before`
- `refs/pi/session/<session-key>/message/<message-id>/after`
- `refs/pi/session/<session-key>/redo/current`
- `refs/pi/session/<session-key>/tmp/prompt/<prompt-id>/turn/<turn-index>/before`
- `refs/pi/session/<session-key>/tmp/prompt/<prompt-id>/turn/<turn-index>/after`

Temporary refs exist only while a prompt is active. Message refs are the durable anchors.

## Capture flow

### 1. `session_start`

- derive workspace identity
- ensure snapshot repo exists
- rebuild checkpoint index from branch custom entries
- rebuild active restore state from branch custom entries

### 2. `agent_start`

- locate the current user message from the active branch
- store prompt state with:
  - user message id
  - parent leaf id
  - user message text
  - empty turn list

### 3. `turn_start`

- create a fresh in-memory turn state
- no snapshot yet

### 4. `tool_call`

Use `workspace-mutation.ts` to classify the tool call.

If this is the first mutation-capable action in the turn:

- capture a `before` snapshot commit
- pin it under a temporary turn ref
- mark the turn as mutation-active

This should be conservative for bash.

False positives are acceptable because empty turns are dropped later. Missing a real mutation is worse.

### 5. `turn_end`

If the turn never became mutation-active:

- do nothing

If the turn captured a `before` snapshot:

- capture an `after` snapshot commit
- diff `before..after`
- if diff is empty, drop the temporary refs and discard the turn
- if diff is non-empty, store the turn summary in prompt state

### 6. `agent_end`

If prompt state has no kept turns:

- clear prompt state
- stop

If prompt state has kept turns:

- set durable message refs:
  - `beforeRef` = first kept turn `before`
  - `afterRef` = last kept turn `after`
- aggregate per-turn file summaries into one message-level summary
- append one message checkpoint custom entry
- clear temporary refs for the prompt
- refresh the in-memory branch checkpoint index

## Restore flow

`/checkpoint-restore` is the main restore action.

### Target semantics

Restoring a checkpoint means restoring the workspace to the state from immediately before the target user message.

That is the right mental model for undo:

- go back to the point before this prompt changed code
- keep the prompt text ready so the user can resend or revise it

### Sequence

1. wait for idle
2. resolve the target checkpoint
3. capture current workspace as redo snapshot
4. restore workspace to `beforeRef`
5. navigate the session tree to `parentLeafId`
6. preload the original user message text into the editor
7. append a restore state entry

If tree navigation fails after the workspace restore, restore the redo snapshot immediately and abort the operation.

### Redo sequence

`/checkpoint-redo` should:

1. wait for idle
2. resolve the latest active restore state
3. restore the workspace from `redoRef`
4. navigate back to `previousLeafId`
5. append a restore clear entry

Redo is single-depth. A new restore replaces the previous redo state.

## Tree semantics

Tree navigation needs different restore targets depending on where the user lands.

### Navigating to a user message entry

Use the checkpoint `beforeRef` and preload that message text into the editor.

This means:

- the chat is positioned just before that prompt is replayed
- the code matches the state before that prompt ran

### Navigating to entries produced by that prompt

Use the checkpoint `afterRef`.

This means:

- the chat shows the completed response on that branch
- the code matches the finished workspace after that prompt completed

### Implementation approach

`hooks/tree.ts` should:

- inspect the navigation target
- resolve whether it maps to a checkpoint `before` or `after` state
- prompt for workspace restore when a checkpoint exists
- run the restore after navigation completes

## Fork semantics

Forking should use the same checkpoint resolution rules as tree navigation.

- fork from a user message entry → restore `beforeRef`
- fork from entries produced by that prompt → restore `afterRef`

The forked session should reconstruct its checkpoint index from its own copied branch metadata on `session_start`.

## Command surface

### `/checkpoints`

Open a picker showing restore points on the current branch.

Each row should show:

- relative time
- user message preview
- file count
- additions/deletions summary

### `/checkpoint-diff [target]`

Show the message-level diff from `beforeRef..afterRef`.

If no target is supplied, open the picker first.

### `/checkpoint-restore [target]`

Restore to the state before the chosen user message.

If no target is supplied, open the picker first.

### `/checkpoint-redo`

Undo the latest restore.

## Mutation classification

The mutation classifier should follow these rules.

### Always mutating

- `write`
- `edit`
- `apply_patch`
- custom tools that declare workspace mutation

### Conservatively mutating

- `bash`
- `exec_command`
- other command-running tools

The classifier should maintain a small list of clearly read-only command shapes and treat everything else as mutation-capable.

Examples of clearly read-only commands:

- `ls`
- `pwd`
- `cat`
- `rg`
- `find` without mutation flags
- `git status`
- `git diff`
- `git log`

This should stay conservative. The snapshot is only kept if the turn actually changed files.

## Cleanup plan

Cleanup is part of the architecture, not a later patch.

### What gets cleaned

- temporary prompt refs at prompt end
- redo refs after clear
- old message refs past retention windows
- old snapshot objects after ref pruning and `git gc`

### When cleanup runs

- on `session_start`
- after `agent_end` when a checkpoint was written
- after restore clear
- periodically based on a simple timestamp gate in runtime state

### Retention rules

Start with two simple rules:

- keep recent checkpoints by age
- keep a bounded number of checkpoints per session/worktree

The durable unit is the message checkpoint entry plus its message refs.

## Failure handling

### Snapshot repo unavailable

- notify the user once
- disable checkpoint capture for the session until reinitialized successfully

### Capture failure mid-prompt

- drop the active prompt state
- leave the workspace untouched
- notify after the turn ends

### Restore failure

- keep the redo snapshot ref
- notify with the failing step
- do not append restore state until both workspace restore and tree navigation succeed

### Reload during active restore

- rebuild restore state from custom entries
- keep `/checkpoint-redo` available after reload

## Testing plan

Add focused tests under the new extension package.

Suggested coverage:

- repo init and ref creation
- turn capture with `write`, `edit`, and `apply_patch`
- conservative bash capture that later drops empty turns
- prompt with multiple mutating turns producing one message checkpoint
- restore recreating deleted files and removing newly added files
- redo restoring the exact previous workspace
- reload reconstructing checkpoint index and active restore state
- tree target resolution choosing `before` vs `after`
- worktree isolation using two different workspace roots

## Build order

1. `git/identity.ts`
2. `git/repo.ts`
3. `git/capture.ts`
4. `git/diff.ts`
5. `session-index.ts`
6. `runtime.ts`
7. `shared/workspace-mutation.ts`
8. `hooks/agent.ts`
9. `git/restore.ts`
10. `commands.ts`
11. `ui/picker.ts`
12. `hooks/tree.ts`
13. `hooks/fork.ts`
14. `maintenance.ts`

## Implementation decisions

These should be treated as settled for the first build.

- build this as an extension package under `extensions/checkpoints/`
- keep storage in a dedicated snapshot repo outside the project
- capture at turn boundaries
- persist one durable restore point per user message
- use explicit user commands for restore and redo
- keep code state and session state aligned during restore
- treat cleanup, gc, and worktree isolation as part of the feature from day one
