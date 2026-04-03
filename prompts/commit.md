---
description: Create git commit(s) for current changes
---
Commit the current changes.

- Inspect `git status` and diffs to choose logical commit boundaries.
- Prefer one commit when changes belong together; otherwise create a small number of commits.
- Use unscoped conventional commit messages: `type: concise why-action summary`.
- Stage intentionally and verify each staged commit with `git diff --staged` before committing.
- Run the needed `git add` and `git commit` commands.
