---
description: Finish a task by closing gaps found in the task file evidence and proving full spec coverage
---
# Finish Task Implementation

Finish the implementation for `$1` using the requirement evidence already tagged in the task file.

## Scope

- Read the task file at `$1` first.
- Treat the task file's existing `Evidence:` bullets as the primary gap list.
- Use the current git diff as the primary discovery surface for what is already implemented.
- Read only the additional files needed to close remaining gaps and verify the intended integration points.
- Respect task or repo boundaries called out in project docs.
- Do not inspect, rely on, or propose work under excluded directories such as `external/` when task or repo guidance says to avoid them.

## Goal

Act as a focused follow-up implementation agent. Finish the missing work, tighten weak areas, and update the task file so every requirement has refreshed evidence grounded in the current code.

## Execution rules

1. Start from the task file's current evidence bullets, not from scratch.
2. Treat every `partially implemented`, `not found`, or `unclear` requirement as unresolved until you verify and close it in code.
3. Use the current git diff to avoid reworking already-complete areas.
4. Implement the narrowest changes that satisfy the task cleanly.
5. Prefer reusable shared code, extracted helpers, and clean integration points over task-specific branching.
6. Do not mark a requirement `implemented` unless concrete code evidence now exists.
7. Refresh the task file evidence bullets after implementation so they reflect the final state.
8. After modifying any `.ts` files, run `mise run check`.
9. If the changes touch `extensions/` or `.pi/extensions` behavior that requires reload before testing, note that clearly.

## Task file update rules

- Edit `$1` directly.
- Under each requirement bullet, keep exactly one nested evidence bullet.
- Use this format exactly:

```md
- Requirement text
  - Evidence: <implemented|partially implemented|not found|unclear> — <concise file/function/behavior evidence>
```

- Refresh stale evidence bullets instead of duplicating them.
- Keep evidence terse, concrete, and based on final code.

## Quality bar

Before finishing:

- Every requirement in the task file must be revisited.
- Any remaining non-`implemented` requirement must have a concrete reason.
- Evidence must point to real files, functions, tests, or observable behavior.
- The final state should be ready for a fresh validation pass.

## Final response

- Keep it short.
- State what gaps were closed.
- State whether the task file evidence was refreshed.
- Mention checks run.
- Mention any remaining requirement that is still partial or unresolved.
- Mention any reload step if changes touched `extensions/` or `.pi/extensions` behavior that requires it.
