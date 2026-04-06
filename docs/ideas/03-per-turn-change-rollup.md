# Per-turn Change Rollup

Collect all file changes made during a single agent turn into one expandable output block so the user can inspect the full delta in one place. This would make it much easier to understand what actually changed before deciding whether to keep it, ask for revisions, or revert.

The rollup should answer the practical questions first: which files changed, what kind of changes happened, and what the combined diff for that turn looks like. A compact default view could show file summaries, with an expanded view revealing the full patch or grouped hunks.

This is related to checkpointing, but it solves a different problem. Checkpointing is about recovery, while a per-turn rollup is about visibility and review, and the two ideas would work especially well together.
