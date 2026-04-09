# Dirty Repo Guard

Warn or block when the user starts a risky workflow inside a dirty repository, especially before actions that create a branch, switch worktrees, or begin extension development. This would reduce the chance of mixing unrelated local edits into a new task or losing track of what belonged to the original checkout.

There are a few policy levels that could work well: notify only, require confirmation, or hard block until the repo is clean or the user checkpoints their work. The useful part is not just detecting dirtiness, but giving the user a clear next step like stash, commit, checkpoint, or continue anyway.

This idea overlaps with worktree management and checkpointing. A good implementation could become a shared preflight check used by several commands instead of a one-off warning bolted onto a single flow.
