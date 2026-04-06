# Worktree Management Utilities Architecture Plan

Related idea: `docs/ideas/01-worktree-management-utilities.md`

## Purpose

Implement worktree management in Pi around the settled mental model:

- base checkout = lobby
- linked worktree = task workspace
- opening a workspace = switching Pi into a session whose cwd is that workspace path

This plan assumes the feature is implemented as a Pi extension in this repository, using Pi's existing session model and custom TUI APIs.

## Settled product decisions

- new workspaces live beside the lobby checkout as sibling directories
- the main UI is the tree-style workspaces selector
- create uses a new branch only
- open resumes an existing Pi session for that workspace path when possible
- open creates a new Pi session when no workspace session exists yet
- remove blocks on dirty workspaces
- path is secondary information in the list
- Pi-specific persistence stays minimal
- Git remains the source of truth for worktree state

## Main command surface

Keep the external command surface small.

- `/workspaces` opens the workspaces UI
- `Ctrl+Shift+W` opens the workspaces UI

Create, open, return to lobby, and remove all happen from inside that UI.

## Runtime model

Pi never mutates the parent shell's directory.

Pi changes where it operates by switching sessions.

- lobby session cwd = base repo path
- workspace session cwd = linked worktree path
- the active session cwd determines where tools, file reads, bash commands, and Git operations run

All worktree management operations should resolve the repo context first, then run against the lobby checkout as the authoritative Git control point.

## Repo and worktree detection

The extension should build a `RepoContext` from the current cwd.

```ts
interface RepoContext {
  repoName: string;
  currentPath: string;
  lobbyPath: string;
  commonGitDir: string;
  currentIsLobby: boolean;
}
```

### Detection algorithm

1. Run `git rev-parse --show-toplevel` from the current cwd.
   - This gives the current checkout root.
2. Run `git rev-parse --git-common-dir` from the current cwd.
   - Resolve the result to an absolute real path.
3. Compute `lobbyPath` as the parent directory of `commonGitDir`.
   - For a normal non-bare repo, that is the base checkout path.
4. Compare `realpath(currentPath)` with `realpath(lobbyPath)`.
   - equal = lobby session
   - different = workspace session

This avoids inventing a separate workspace registry just to figure out where the base checkout lives.

## Git data source

The extension should derive the workspace list from Git every time it refreshes.

Use:

- `git -C <currentPath> worktree list --porcelain`

Parse that into records like:

```ts
interface WorkspaceRecord {
  path: string;
  branch?: string;
  head: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isLobby: boolean;
  isCurrent: boolean;
  dirty: boolean;
  label: string;
}
```

### Derived fields

- `isLobby` comes from `path === lobbyPath`
- `isCurrent` comes from `path === currentPath`
- `dirty` comes from `git -C <path> status --porcelain --untracked-files=normal`
- `label` comes from path and branch naming rules

The list should not depend on whether Pi has a session for the workspace. That is implementation detail, not primary UI state.

## Workspace path strategy

New workspace paths should be generated as sibling directories beside the lobby checkout.

Example:

- lobby: `~/code/crumbs`
- branch: `feature/a`
- workspace path: `~/code/crumbs-feature-a`

### Path derivation

1. Take the lobby repo basename, for example `crumbs`
2. Take the branch name, for example `feature/a`
3. Slug it for filesystem use
   - replace `/` with `-`
   - collapse repeated separators
   - remove characters that are awkward in paths
4. Join as `<repo-name>-<branch-slug>` beside the lobby path

```ts
targetPath = join(dirname(lobbyPath), `${basename(lobbyPath)}-${slug(branchName)}`)
```

If the directory already exists, or Git already has a worktree at that path, creation should stop with a clear error.

## Session architecture

Pi session files are how workspace switching works.

### Session lookup

When the user opens a workspace:

1. call `SessionManager.list(workspacePath)`
2. sort by modified time if needed
3. take the most recent session file for that cwd
4. if one exists, call `ctx.switchSession(session.path)`

This gives the desired behavior without inventing a second session index.

### Creating a new workspace session

If no existing session exists for the workspace path:

1. create a new persisted session manager for that path
   - `const sm = SessionManager.create(workspacePath)`
2. optionally set a friendly session name
   - `sm.appendSessionInfo(label)`
3. switch Pi into it
   - `await ctx.switchSession(sm.getSessionFile()!)`

Using `SessionManager.create()` keeps session storage aligned with Pi's existing per-cwd layout.

### Returning to lobby

Returning to lobby needs to work well without building a new persistent mapping layer.

Use two resolution levels:

1. **In-memory preferred lobby session**
   - keep `Map<string, string>` keyed by `lobbyPath`
   - whenever the current session is the lobby and has a session file, remember it
   - while the current Pi process lives, this lets workspace sessions return to the exact lobby session the user last had open
2. **Fallback lobby session lookup**
   - if no remembered lobby session exists, call `SessionManager.list(lobbyPath)`
   - switch to the most recent lobby session if found
   - otherwise create a new lobby session with `SessionManager.create(lobbyPath)` and switch to it

This stays simple, avoids extra persistent metadata, and still gives good behavior during normal use.

### Session cleanup policy

Removing a workspace should remove the Git worktree only.

It should not automatically delete Pi session files.

Reasons:

- session history may still be useful
- Pi already has missing-cwd handling for resumed sessions
- deleting conversation history should be a separate decision from removing a checkout

## UI architecture

The workspaces UI should be a custom TUI component shown with `ctx.ui.custom()` as an overlay.

### Layout shape

Use a bottom-docked, full-width selector that visually matches Pi's built-in session tree.

- horizontal rule
- title line: `Workspaces (Lobby)` or `Workspaces (<current workspace>)`
- compact hint line
- search line
- horizontal rule
- workspace rows
- bottom rule only

It should leave the built-in Pi footer and status area visible.

That means the overlay should reserve bottom margin instead of covering the footer.

### Row shape

Each workspace row should carry almost all information directly.

Primary line:

- selection marker
- workspace label
- branch
- dirty or clean state

Secondary line:

- dimmed path, truncated as needed

Do not show:

- a separate detail pane
- a duplicate bottom status bar
- session or no-session badges in the main list

### Input model

- `↑` / `↓` move selection
- `Enter` opens selected workspace
- `n` creates a new workspace
- `l` returns to lobby
- `x` removes selected workspace
- typing filters the list
- `Backspace` edits the filter
- `Esc` clears filter first, then closes the UI

### Status and feedback

Use lightweight orientation UI outside the selector:

- `ctx.ui.setStatus()` for `• Lobby` or `• Workspace:<label>`
- `ctx.ui.setTitle()` to reflect the current location

Use `ctx.ui.notify()` for action results and errors so the selector itself stays list-focused.

## Main modules

Recommended extension layout:

```text
.pi/extensions/worktree-manager/
  index.ts
  repo-context.ts
  git-worktrees.ts
  workspace-paths.ts
  workspace-sessions.ts
  workspace-actions.ts
  status.ts
  ui/
    workspaces-selector.ts
```

### `index.ts`

- register `/workspaces`
- register `Ctrl+Shift+W`
- wire session lifecycle handlers
- hold in-memory preferred lobby session map

### `repo-context.ts`

- resolve lobby path
- detect whether current cwd is lobby or workspace
- derive repo name

### `git-worktrees.ts`

- run Git commands
- parse `git worktree list --porcelain`
- compute dirty state for each workspace
- normalize errors into readable messages

### `workspace-paths.ts`

- slug branch names into stable sibling directory names
- derive labels from path and branch

### `workspace-sessions.ts`

- find the most recent session for a cwd
- create a new session for a workspace path
- resolve preferred lobby session

### `workspace-actions.ts`

- create workspace
- open workspace
- return to lobby
- remove workspace

### `status.ts`

- update title and footer status on session start and session switch
- clear extension status on shutdown and before switch

### `ui/workspaces-selector.ts`

- render the tree-style list UI
- manage search query and selection state
- trigger actions and refresh after each one

## Core action flows

### Open workspaces UI

1. Resolve `RepoContext`
2. Load workspace list from Git
3. Build derived UI rows
4. Open selector overlay
5. Refresh the list after any mutating action

If the current cwd is not in a Git worktree, the command should fail immediately with a clear notification.

### Create workspace

1. Prompt for branch name
2. Validate with `git check-ref-format --branch <name>`
3. Derive sibling target path
4. Run `git -C <lobbyPath> worktree add -b <branch> <targetPath> HEAD`
5. Create or resume the Pi session for `targetPath`
6. Switch into that session

If Git reports that the branch already exists, is already checked out elsewhere, or the path conflicts, Pi should surface that error plainly instead of inventing custom rules.

### Open workspace

1. Resolve selected workspace path
2. Look for the most recent Pi session whose cwd matches that path
3. If found, switch to it
4. Otherwise create a new session for that path and switch to it

### Return to lobby

1. Resolve lobby path from the current repo context
2. Prefer the remembered lobby session for that repo if it still exists
3. Otherwise switch to the most recent lobby session for that path
4. If no lobby session exists yet, create one and switch to it

### Remove workspace

1. Reject removal if the selected item is the lobby
2. Reject removal if the selected item is the current active workspace
3. Check dirty state
4. If dirty, block removal with a clear message
5. Confirm removal
6. Run `git -C <lobbyPath> worktree remove <workspacePath>`
7. Refresh the list

This keeps Pi from deleting the directory it is currently operating in and avoids surprising loss of uncommitted work.

## Error handling and safety rules

- if not inside a Git worktree, the feature does nothing except explain why
- if repo detection fails, stop before showing partial UI
- if a workspace path no longer exists, Git discovery should naturally stop listing it
- if a user manually deleted a workspace and only stale Git registration remains, that belongs to later doctor and repair flows
- if Git rejects create or remove, Pi should show Git's message clearly
- if a remembered lobby session path is gone, fall back cleanly to session lookup by cwd

## Persistence policy

Keep persistence intentionally small.

What persists:

- Git worktree state
- Pi sessions per cwd
- optional friendly session names

What does not persist in a separate store:

- a custom workspace registry
- a separate path-to-session database
- task metadata
- cleanup history

The only extra state the extension should keep is the in-memory preferred lobby session map for the current process.

## Deferred work

Not part of this architecture slice:

- doctor and repair flows
- richer workspace metadata
- detached review creation flows
- direct handling for moved or locked worktrees
- session deletion tied to workspace removal
- advanced branch ownership explanations beyond surfacing Git errors

## Testing plan

### Unit tests

- parse `git worktree list --porcelain`
- resolve lobby path from `git-common-dir`
- slug branch names into sibling paths
- derive labels from path and branch

### Integration tests

- create temp repo and linked worktrees
- verify create makes sibling directories
- verify open resumes the newest session for a workspace cwd
- verify lobby fallback creates a new session when none exists
- verify remove blocks when workspace is dirty
- verify remove rejects the currently active workspace

### Manual checks

- footer remains visible under the selector
- status line updates correctly between lobby and workspace sessions
- search behaves like Pi's tree selector
- create, open, return to lobby, and remove all round-trip cleanly

## Architecture summary

The core of the design is simple:

- Git owns the workspace graph
- Pi sessions own runtime context
- the workspaces UI is just a fast tree-style router between them

That keeps the implementation aligned with both Git's model and Pi's model without inventing a second workspace system.
