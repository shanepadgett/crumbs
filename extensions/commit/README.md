# commit extension

Adds a deterministic `/commit` command for git worktrees with local changes.

## What it does

- collects a fixed evidence bundle from git status, summaries, and focused diffs
- runs a clean child agent session using `openai-codex/gpt-5.5` with high thinking
- injects evidence only into that child session so current chat context stays clean
- restricts the child session to shell execution for staging and committing
- reports the child session result back to the command caller

## How to use it

Run `/commit` inside a git repository with uncommitted changes.

The extension prepares commit evidence, starts a clean `/commit` child session, and asks that agent to create one or more semantic commits.
