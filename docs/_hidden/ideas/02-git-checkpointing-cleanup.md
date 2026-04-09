# Pi Checkpointing with Cleanup

## Goal

Provide native, conversation-aware checkpointing for workspace files so Pi can:

- restore code to earlier points safely
- keep code state aligned with session state
- support branching and experimentation without manual Git bookkeeping
- prune old checkpoint data before it turns into storage junk

## User model

- Checkpoints are automatic during agent work.
- Restore points attach to user messages that led to code changes.
- Pi can show what changed for a restore point before applying it.
- Restoring returns the workspace and conversation to a matching point.
- Continuing from a restored point creates a clean new branch from there.
- Previous future work stays reachable through Pi's existing tree mechanics.

## Scope

The first implementation is a Git-backed checkpoint system managed by Pi.

- Snapshot storage lives in a Pi-managed repository outside the project.
- Storage is isolated per project and per worktree.
- The user's project files stay where they are.
- The user's own `.git` history remains untouched.
- Checkpoints are tied to Pi turns and user messages.

Suggested storage layout:

- `~/.pi/agent/checkpoints/<project-id>/<worktree-hash>/`

## Snapshot storage

Each project/worktree gets its own snapshot repository.

- The snapshot repository stores durable commits and refs.
- Snapshot operations treat the project directory as the working tree.
- Commits remain reachable until cleanup prunes them.
- Snapshot refs are keyed by message and turn identity so Pi can map them back to session state.

Ignore behavior:

- Respect `.gitignore` when present.
- Support Pi-level checkpoint ignore configuration for additional exclusions.
- Only files inside the active workspace scope participate in checkpointing.

## Capture model

Checkpoint capture happens at turn boundaries.

### Before state

When a turn first reaches a mutation-capable tool call, Pi captures a `before` snapshot.

Mutation-capable operations include:

- direct file mutation tools
- patch application tools
- allowed bash commands that may mutate the workspace
- custom tools that declare workspace mutation

### After state

At the end of the turn, Pi compares the workspace state.

- If the workspace changed, Pi captures an `after` snapshot.
- If the workspace did not change, Pi drops the pending checkpoint.
- Pi records the changed-file set and summary stats for that turn.

### Message aggregation

A single user message may lead to multiple internal turns or model steps.

Pi aggregates those turn records under one message-level restore point.

- per-turn records preserve fine-grained capture data
- message-level records define the restore UX
- diff summaries can roll up all turn changes for the message

## Metadata model

Checkpoint metadata lives in Pi session data so it follows branch navigation and reloads cleanly.

Each restore point should record:

- user message id
- parent leaf id for the point just before that message
- turn sequence covered by the message
- `before` commit ref
- `after` commit ref
- changed file list
- summary stats for additions, deletions, and file counts
- timestamps

Pi should also label checkpointed user messages so restore points are visible in `/tree`.

## Restore model

Restore operates at the user-message level.

Restoring to a user message means:

1. capture the current workspace state as a temporary redo snapshot
2. restore the workspace to the snapshot from immediately before the target user message
3. move the active conversation position to the parent of that user message
4. preload the user message text back into the editor so the user can resend or revise it

This keeps code state and session state aligned.

### Redo

Every restore creates a redo point.

- redo restores the workspace to the state from just before the restore
- redo returns the session to the prior active leaf
- redo remains available until the user continues from the restored point

### Continuing from a restored point

If the user sends a new message after restore:

- Pi treats that as the new active branch
- the previous future path remains available in the session tree
- checkpoint metadata continues from the restored branch point

## Diff and inspection

Each restore point should be inspectable before restore.

Pi should provide:

- a message-level file list
- addition/deletion counts per file
- full diff view when needed
- a quick summary suitable for compact TUI display

Initial command surface:

- `/checkpoints` to list recent restore points
- `/checkpoint-diff <target>` to inspect one restore point
- `/checkpoint-restore <target>` to restore to one restore point
- `/checkpoint-redo` to undo the most recent restore

Targets can resolve from message ids, labels, or recent history selection.

## `/tree` and `/fork` integration

Checkpointing should plug into Pi's existing navigation model.

### `/tree`

- Checkpointed user messages should be visibly labeled in `/tree`.
- Navigating to a checkpointed point should offer to restore the matching workspace state.
- Branch navigation and code restoration should describe the same point in history.

### `/fork`

- Forking from a checkpointed point should start from the matching workspace snapshot.
- The new session should inherit only the checkpoint metadata that belongs to the forked branch.
- Worktree-specific storage keeps forked work in one project from colliding with another worktree.

## Cleanup and storage management

Checkpoint cleanup is part of the feature, not follow-up work.

Pi should manage:

- retention by age
- retention by count per project/worktree
- pruning of refs no longer reachable from live session metadata
- periodic Git maintenance and garbage collection
- cleanup of temporary redo snapshots

Cleanup should prefer keeping:

- recent restore points
- restore points still referenced by active session branches
- restore points attached to labeled or otherwise important nodes

## Design considerations

### Conversation and code must stay aligned

The active workspace should match the active session position. That matters most when restoring, navigating the tree, and forking.

### Mutating bash detection

Pi needs a reliable way to checkpoint before shell commands that mutate the workspace. The detection path should integrate with the same mutation policies used by permissions and tool observation.

### Custom mutation tools

Custom tools need a standard way to declare that they mutate workspace state so checkpoint capture stays reliable across extensions.

### Manual edits while reverted

If the user manually edits files while sitting on a restored state, Pi needs clear behavior for restore, redo, and continue flows. The current workspace must always be captured before another destructive transition.

### Ignore rules

Checkpoint scope needs to be predictable. Users should understand which files are included, which are ignored, and why.

### Binary and large files

The snapshot repo must handle them correctly. Diff views may need to degrade to file-level summaries while restore remains exact.

### Worktree isolation

Separate snapshot repos per worktree prevent state bleed between parallel worktrees of the same project.

## Implementation sequence

1. Build the snapshot repository manager.
   - project/worktree identity
   - repo initialization
   - durable commit/ref creation
   - cleanup hooks

2. Build the turn capture coordinator.
   - mutation detection
   - `before` snapshot capture
   - `after` snapshot capture
   - changed-file aggregation

3. Build session metadata persistence.
   - custom entries
   - label integration
   - reload reconstruction

4. Build restore and redo.
   - workspace restore engine
   - session repositioning
   - editor preload
   - temporary redo snapshot handling

5. Build inspection commands and TUI surfacing.
   - list
   - diff
   - restore
   - redo

6. Integrate with `/tree` and `/fork`.

7. Add retention, pruning, and background maintenance.
