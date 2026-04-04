---
description: Review marked bash approvals and suggest safe policy updates
---

Review marked bash approvals from `.pi/permission-review.ndjson`.

- Read each NDJSON entry with fields: `command`, `action`, `approvalReason`, optional `failedSegments` array, optional `note`.
- Group repeated/similar commands and summarize patterns.
- Prioritize evaluating `failedSegments` (the exact segment(s) that forced approval), not just full commands.
- Read `@extensions/permission-gate/safe-commands.ts` to see whether a command pattern should be added there as built-in safe command handling.
- For each failed segment/group, classify the best destination:
  1) baseline built-in safe handling in `@extensions/permission-gate/safe-commands.ts`,
  2) project/user policy in `.pi/crumbs.json`, or
  3) keep denied / user-by-user approval.
- Prefer durable, non-fragile rules. Use `exact` only when truly stable; otherwise prefer narrowly scoped `prefix` or safe `regex`.
- Flag risky/ambiguous commands for explicit user decision.
- Propose concrete edits to `.pi/crumbs.json` and/or `@extensions/permission-gate/safe-commands.ts` as needed, but do not apply edits without user confirmation.
- If the review file is missing or empty, report that clearly.
- Do **not** clear `.pi/permission-review.ndjson` immediately after presenting the review.
- Clear `.pi/permission-review.ndjson` only after the user explicitly confirms what to do with the suggestions (e.g., apply additions/denials), so entries are not lost before a decision.
- Present the review to the user as a simple markdown table with columns: `Command / Pattern`, `Safety level`, and `Justification`.
- Use exactly these safety levels:
  - `built-in` = good candidate for built-in safe handling in `@extensions/permission-gate/safe-commands.ts`
  - `project-policy` = likely safe only as a project/user policy rule in `.pi/crumbs.json`
  - `approval/deny` = should remain approval-gated or denied
- Use one row per command or grouped pattern.
- Keep justifications brief, concrete, and decision-oriented.
- If the review file is missing or empty, say so clearly instead of fabricating a table.
- Use this output format example:

```md
| Command / Pattern | Safety level | Justification |
| --- | --- | --- |
| `git status` | `built-in` | Read-only git inspection with no write side effects; suitable for built-in safe handling. |
| `mise run check` | `project-policy` | Likely safe in this repo's workflow, but too project-specific for a universal built-in allowance. |
| `find . -exec rm {} \;` | `approval/deny` | Includes destructive execution behavior and should not be broadly auto-allowed. |
```
