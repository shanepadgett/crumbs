# Worktree Management Utilities

Add built-in worktree utilities so users can create, switch, inspect, and clean up worktrees without leaving Pi. The value is not just wrapping `git worktree`, but reducing the mental overhead of remembering which branch lives where and which session belongs to which task.

There is already a strong product direction for this in `docs/_hidden/WORKTREE_EXTENSION_PLAN.md`, where the base checkout acts like a protected lobby and real implementation happens in managed workspaces. This idea can stay smaller in scope if needed, but it clearly wants to grow into a full workspace-management layer rather than a handful of shell shortcuts.

The key product decision is how opinionated the utilities should be. A minimal version could offer helper commands only, while a fuller version would track metadata, bind sessions to worktrees, enforce lobby safety rules, and guide users through create/resume/finish flows inside the TUI.
