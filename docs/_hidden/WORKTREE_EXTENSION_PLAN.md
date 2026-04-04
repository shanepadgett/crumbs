# Worktree Workspace Extension Plan

## Goal

Build a pi extension that makes **managed git worktrees** the default way to do implementation work.

The extension should keep users inside the pi TUI for workspace management and make the base checkout act like a **lobby/control plane**, not a normal coding workspace.

## Core Concept

The extension manages 3 repo states:

1. **Lobby**
   - The protected base checkout
   - Used for inspection and workspace management
   - Not used for implementation work

2. **Managed Workspace**
   - A git worktree created and tracked by the extension
   - Full normal pi usage is allowed here
   - Intended for real feature work

3. **Foreign Checkout**
   - A checkout/worktree not created by the extension
   - Should warn and optionally support adoption later

## Product Behavior

### Lobby behavior

In the lobby, the extension should:

- allow read/search/inspection workflows
- block edits/writes and mutating bash commands
- direct the user to open the workspace manager for implementation work
- optionally support a stricter mode later

### Managed workspace behavior

In a managed workspace, the extension should:

- allow full normal pi work
- bind the current pi session to workspace metadata
- make it easy to return to the lobby or switch workspaces

## Main UX Surface

The primary interface should be a **TUI overlay/modal** launched from a command such as:

- `/ws`

The overlay should support:

- create workspace
- open/resume workspace
- inspect workspace status
- finish/cleanup workspace
- repair/prune stale metadata

The user should not need to leave pi to manage worktrees.

## Workspace Model

Each managed workspace should have metadata such as:

- id
- task name
- branch name
- worktree path
- base branch
- status
- created at / last active
- associated pi session

Later metadata may include:

- summary
- setup profile
- merge/cleanup state
- parent workspace for stacked work

## Session Model

The intended model is:

- one primary pi session for the lobby
- one primary pi session per managed workspace
- switching workspaces means switching sessions

This keeps task history isolated and aligned with filesystem isolation.

## Core Lifecycle Flows

### Create workspace

- collect task name and base branch
- create branch + worktree
- register metadata
- create or switch into the workspace session
- end with the user effectively working in that workspace

### Resume workspace

- select a managed workspace
- switch into its associated session
- restore workspace-aware UI state

### Finish workspace

- validate clean/dirty state
- support merge/handoff/cleanup decisions
- remove or archive the workspace safely

### Repair workspace

- detect stale metadata
- detect missing or moved worktrees
- help recover or prune broken entries

## Enforcement Model

Initial enforcement should be **read-only lobby mode**.

Blocked in lobby:

- `edit`
- `write`
- mutating/destructive `bash`

Allowed in lobby:

- `read`
- `grep`
- `find`
- `ls`
- safe inspection commands
- workspace-management UI and commands

Possible future mode:

- **strict mode** where most non-management activity is blocked in the lobby

## MVP

Initial version should include:

1. repo state detection: lobby vs managed vs foreign
2. workspace metadata model
3. lobby restrictions
4. `/ws` overlay
5. create workspace flow
6. resume workspace flow
7. session/workspace binding
8. finish/cleanup flow

## Later Enhancements

Possible later features:

- setup profiles/hooks
- workspace summaries
- adoption of foreign worktrees
- strict lobby mode
- stacked/dependent workspaces
- multi-agent orchestration across workspaces

## Implementation Direction

Recommended build order:

1. define workspace metadata/state model
2. implement repo state detection
3. implement lobby restrictions
4. build `/ws` overlay UI
5. add create workspace flow
6. add resume/session switching
7. add finish/cleanup flow
8. add repair/prune support

## Design Intention

This extension is not just a thin wrapper over `git worktree`.

It is intended to be a **workspace management layer for pi** that:

- encourages isolated feature work
- discourages accidental coding in the base checkout
- keeps management inside the pi TUI
- supports clean parallel development workflows
