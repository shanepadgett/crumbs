---
name: refactor-execute
description: Execute verified refactor work units from refactor-opportunities. Builds dependency graph, dispatches parallel subagents per work unit, validates results.
---

# Refactor Execute

Execute work units produced by `refactor-opportunities`. Input: path to a review run dir containing `plans/index.json`.

## Rules

- Say `subagents`. Host decides parallel vs sequential.
- Trust work unit plans — they are pre-verified. Don't re-evaluate whether work is worth doing.
- Each subagent works on exactly one work unit in an isolated worktree.
- Orchestrator merges results back, resolving any conflicts.
- No speculative changes beyond what the work unit describes.
- Match existing code style and local patterns.
- If a work unit fails or produces unexpected results, skip it and report — don't force.

## Inputs

Required: `RUN_DIR` — path to a `refactor-opportunities` run directory.

Verify before starting:

- `$RUN_DIR/plans/index.json` exists
- At least one `WU-*.md` file in `$RUN_DIR/plans/`
- `$RUN_DIR/reconciled-findings.md` exists

Optional: `--units WU-001,WU-003` to execute a subset. Default: all.

## 1. Build execution plan

```bash
node .agents/skills/refactor-execute/scripts/build-execution-plan.mjs \
  "$RUN_DIR/plans/index.json" \
  "$RUN_DIR/execution-plan.json"
```

Script reads `index.json`, builds dependency graph, outputs ordered batches:

```json
{
  "batches": [
    { "batch": 1, "units": ["WU-001", "WU-002", "WU-004", "WU-005"] },
    { "batch": 2, "units": ["WU-003"] }
  ],
  "skipped": []
}
```

Units with no dependencies and no file overlap -> same batch (parallel).
Units with `depends-on` -> later batch after dependency completes.
Units touching same files -> sequential batches to avoid merge conflicts.

If `--units` subset specified, include only those units and their transitive dependencies.

## 2. Execute batches

Process batches in order. Within each batch, dispatch subagents in parallel.

Each subagent gets:

- The work unit plan file (`$RUN_DIR/plans/WU-NNN.md`)
- Target codebase access
- Isolation: worktree (each subagent works on isolated copy)

Subagent prompt:

> Read your work unit plan. Execute the steps described. Follow the goal and
> non-goals exactly. Match existing code style. Do not make changes beyond
> what the plan describes. After completing, report: files changed, what was
> done, any issues encountered. If a step cannot be completed safely, stop
> and report why instead of forcing.

## 3. Collect and validate results

After each batch completes:

- Read each subagent's result
- Check reported changes align with work unit's declared files
- Flag unexpected file changes (files not listed in work unit)
- Run project build/lint if available to catch regressions
- Record per-unit status: `completed`, `partial`, `failed`, `skipped`

Write results:

```bash
node .agents/skills/refactor-execute/scripts/record-results.mjs \
  "$RUN_DIR/execution-results.json" \
  --unit WU-001 --status completed --files "path1.swift,path2.swift"
```

## 4. Merge results

After all batches complete, orchestrator reviews:

- All completed units' changes are consistent with each other
- No merge conflicts between parallel units (worktree isolation should prevent this)
- Build still passes after all changes applied

If conflicts exist between units, keep the higher-priority unit's changes and mark the other as `conflict — needs manual resolution`.

## 5. Summary

Report:

- Total units: attempted, completed, partial, failed, skipped
- Per-unit status with one-line description of what was done
- Files changed across all units
- Any issues requiring manual attention
- Build/lint status after changes

## Ownership

| Step                              | Owner                    |
| --------------------------------- | ------------------------ |
| execution plan, batch ordering    | script                   |
| work unit execution               | subagents (one per unit) |
| result collection, merge, summary | orchestrator             |

## Guardrails

- Never execute a work unit whose dependencies haven't completed successfully
- Never modify files outside a work unit's declared file list without flagging
- Stop on build failure — don't continue to next batch if current batch broke the build
- Subagents must not read other work unit plans (prevents scope creep)
- If a unit's changes conflict with already-applied changes, skip and report — don't force merge
