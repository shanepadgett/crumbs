# Worktree Management Utilities

Add built-in worktree utilities so users can create, open, inspect, and clean up Git worktrees without leaving Pi. The point is not to wrap `git worktree` with prettier commands. The point is to make parallel task work understandable and safe inside Pi.

For this project, the most useful mental model is:

- **base checkout = lobby**
- **worktree = task workspace**
- **open workspace in Pi = switch to a Pi session whose cwd is that worktree path**

That last point matters. Pi does not need to magically change the parent shell's directory. What it needs to do is switch its own active session and runtime context to the selected worktree. In practice, that means a worktree manager in Pi should feel like a workspace switcher, not like a shell alias.

## Why this matters

Raw Git worktrees are powerful but awkward for normal people:

- users do not think in terms of linked checkout metadata
- users forget which branch lives in which folder
- users hit branch deletion or checkout conflicts and do not know why
- users manually delete worktree folders and end up with stale Git state
- users still have no help connecting a worktree to a task, a review, or a Pi session

Pi can improve this by treating a worktree as a first-class task workspace instead of a low-level Git object.

## Recommended product shape

Pi should present worktrees as task workspaces.

Example:

- `~/code/crumbs` → lobby on `main`
- `~/code/crumbs-feature-a` → feature workspace on `feature/a`
- `~/code/crumbs-pr-123` → review workspace for a PR branch
- `~/code/crumbs-bug-repro` → isolated bug reproduction workspace

Each workspace should feel like:

- one folder
- one checked out branch or detached review state
- one Pi session
- one task context

This is much easier to reason about than constant branch switching in a single checkout.

## Workspace location

New workspaces should live beside the lobby checkout by default, not inside it.

Example:

- `~/code/crumbs` → lobby
- `~/code/crumbs-feature-a` → workspace for `feature-a`
- `~/code/crumbs-bug-repro` → workspace for `bug-repro`

This is the best default because it:

- keeps the lobby checkout clean
- makes each workspace path obvious
- matches normal Git worktree habits
- keeps cleanup straightforward

The expected behavior is:

- Pi creates sibling directories using a predictable naming pattern
- Pi makes removal easy enough that users do not accumulate stale workspaces
- Pi does not create nested worktrees inside the current repository

## How this should work inside Pi

The extension should not rely on changing the user's outer shell directory. Instead, it should use Pi's session model.

When a user launches Pi from the base repo:

- terminal cwd stays wherever the user launched Pi
- Pi starts in the lobby session
- opening a workspace switches Pi into a session whose cwd is the selected worktree path

So if the user starts Pi in `~/code/crumbs` and opens `~/code/crumbs-feature-a`, Pi should begin operating on files, Git state, and tools inside `~/code/crumbs-feature-a` even though the parent shell remains in `~/code/crumbs`.

This gives us clear semantics:

- **Lobby** = base repo session
- **Workspace** = worktree-backed Pi session
- **Open workspace** = switch Pi session to that worktree cwd
- **Return to lobby** = switch back to the base repo session

## TUI shape

The chosen reference is the tree-style workspaces UI, not a centered modal.

It should feel closer to Pi's built-in session tree:

- horizontal rules instead of a boxed panel
- a title line like `Workspaces (Lobby)` or `Workspaces (<current workspace>)`
- one compact hint line
- one search line
- then the workspace list

This keeps the UI feeling native to Pi. It reads like a selector or switcher, not like a settings dialog.

The list is the main event. It should carry almost all useful information directly in each row, so the UI does not need a duplicate detail pane or bottom status bar.

The workspace list should show the important state at a glance:

- workspace name or label
- branch
- dirty or clean state
- path only as a secondary, de-emphasized line when needed

Likely actions in the workspaces UI:

- open
- new
- return to lobby
- remove
- doctor

Create, doctor, and remove flows can still use follow-up overlays, prompts, or subviews. But the top-level workspaces UI should stay a fast searchable list first.

Outside the workspaces UI, Pi should use only minimal orientation chrome.

Good supporting UI:

- a small status indicator showing lobby vs workspace
- optionally the current workspace name in the title or status area

Those supporting elements should stay lightweight. They should only answer "where am I operating right now?"

## Build now

The build should stay narrow and opinionated around the lobby/workspace model.

Core capabilities:

- **List workspaces**
  - show branch, dirty state, and path in a secondary line when helpful
- **Create workspace**
  - create a worktree from a new branch
  - optionally switch into it immediately
- **Open workspace**
  - resume the existing Pi session for that worktree path when one exists
  - otherwise create a new Pi session for that worktree path
- **Return to lobby**
  - switch back to the base checkout session
- **Remove workspace safely**
  - warn or block on dirty state
  - remove the worktree cleanly instead of leaving stale registrations

The main interaction surface should use the tree-style workspaces UI described above. That UI should show a simple searchable workspace list and offer actions like:

- new
- open
- return to lobby
- remove

## Why this is the right starting point

This approach fits Pi's actual runtime model well.

Pi already has:

- sessions
- session switching
- cwd-bound runtime state
- extension commands
- overlay UI
- persistent session metadata

So the most natural implementation is not arbitrary cwd mutation inside one long-lived session. The natural implementation is:

- one Pi session per worktree
- one lobby session for the base repo
- a worktree manager that routes between them

That is native to Pi and avoids fake shell-like behavior.

## Add later

Once the basic lobby/workspace model is in place, this can grow into a more complete workspace layer.

Useful later additions:

- bind lightweight task metadata to each workspace
  - task name
  - last opened time
  - status
  - notes
- add a more guided **finish workspace** flow
  - summarize what changed
  - warn if branch is unmerged
  - remove workspace and return to lobby
- add better recovery flows
  - explain when a branch is already checked out in another worktree
  - repair moved worktrees
  - convert detached experiments into named branches
  - unlock or explain locked worktrees
- track richer workspace state inside Pi
  - last summary
  - pending todos
  - last failures
  - review notes
- support review-specific and bug-repro-specific creation flows instead of only raw branch-based creation
- show a stronger workspace dashboard with more status and context

## Product principle

Stay Git-native in storage and operations, but Pi-native in workflow.

Git should remain the source of truth for worktree state. Pi should provide the missing layer that Git does not:

- task framing
- session binding
- clear workspace switching semantics
- safer cleanup and recovery
- a TUI that makes parallel work understandable

## Recommended implementation decisions

To keep the feature coherent, the implementation should assume:

- **Default location**: sibling directories beside the lobby checkout
- **Main UI**: tree-style workspaces selector
- **Create**: new branch only
- **Open**: resume existing Pi session for that workspace path, or create one if none exists
- **Remove**: block on dirty workspaces
- **Persistence**: minimal Pi-specific metadata at first

For lobby detection, Pi should treat the session started in the base repository path as the lobby for that repository. In practice, the lobby is just the non-worktree base checkout session for that repo root.
