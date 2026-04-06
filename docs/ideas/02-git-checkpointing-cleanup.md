# Git Checkpointing with Cleanup

Automatically create checkpoints before any mutating action so the user can roll the repository back if a turn goes sideways. That includes tool-driven edits like `write`, `edit`, and `apply_patch`, but also shell commands or other operations that modify, delete, rename, or otherwise change tracked files.

The key product value is fast rewind. If the last turn made a mess, the user should be able to restore the repo to the state it was in immediately before that change without manually using Git or trying to guess which files were touched.

The implementation details are still open. We need to decide what the checkpoint unit is, whether it happens per mutating tool call or per full agent turn, and what storage model makes sense under the hood. This is a good place to research how other agent tools handle checkpointing, snapshots, and rollback so the feature feels reliable instead of ad hoc.

Cleanup still matters because automatic checkpoints can pile up quickly. If we do this, Pi should also provide a way to inspect, restore, collapse, and prune old checkpoints so the recovery system stays understandable.
