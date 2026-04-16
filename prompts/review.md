---
description: Review all working changes through parallel lens reviewers
---

Use `bash`, `subagent`, and `read`.

Review uncommitted working changes only: staged + unstaged. Treat changed files as primary evidence. Read unchanged nearby code only when needed to verify direct local impact.

If user concern is too vague to scope responsibly, ask one short clarifying question before doing anything else.

First run this scaffold command:

```bash
RUN_ID=$(date -u +%Y-%m-%dT%H-%M-%SZ)
REVIEW_DIR=".working/reviews/$RUN_ID"
mkdir -p "$REVIEW_DIR"

git status --short > "$REVIEW_DIR/git-status.txt"
git diff --cached --name-only --diff-filter=d > "$REVIEW_DIR/staged-files.txt"
git diff --name-only --diff-filter=d > "$REVIEW_DIR/unstaged-files.txt"
git ls-files --others --exclude-standard > "$REVIEW_DIR/untracked-files.txt"
cat \
  "$REVIEW_DIR/staged-files.txt" \
  "$REVIEW_DIR/unstaged-files.txt" \
  "$REVIEW_DIR/untracked-files.txt" \
  | sed '/^$/d' | sort -u > "$REVIEW_DIR/changed-files.txt"
printf '%s\n' "$REVIEW_DIR"
```

Read `git-status.txt` and `changed-files.txt` from created review dir.

If no changed files exist, stop and say none found.

Then dispatch parallel subagents using these subagents:

- `runtime-review`
- `overengineering-review`
- `hygiene-review`

Pass each subagent:

- user concern: `$@`
- review dir path from scaffold step
- output file path in that dir:
  - `runtime-review.md`
  - `overengineering-review.md`
  - `hygiene-review.md`
- instruction to review all working changes in repo

Tell every subagent:

- create or replace only its assigned output file under review dir
- write findings to its assigned file
- use changed files as primary evidence
- use adjacent unchanged code only for verification and direct impact tracing
- focus on high-impact findings only
- avoid implementation plans and code changes outside review artifacts

After parallel review finishes:

1. read all three output files
2. synthesize final findings report into `$REVIEW_DIR/final-findings.md`
3. reconcile and trim before writing final report:
   - prioritize runtime risk
   - then over-engineering simplification
   - then hygiene clarity and changeability
   - collapse duplicate or near-duplicate findings
   - drop low-value, weak-evidence, or non-actionable findings
   - keep only findings worth actual follow-up work
   - call out conflicts or tradeoffs when remedies may fight each other
4. write final report to that path
5. after writing final report, do not spend more tokens on long chat summary

Final report must include:

- scope reviewed
- merged high-value findings first
- source lens references for each merged finding
- conflicts or tradeoffs between lenses
- important unknowns needing verification
- exact files or symbols worth inspecting next

Final chat response must be short only:

- exact path to `$REVIEW_DIR/final-findings.md`
- one short note that detailed findings are in file
