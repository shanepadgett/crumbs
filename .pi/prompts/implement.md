---
description: Implement a task from a linked technical plan file
---
# Implement

Implement the work described in `$1`.

## Scope

- Read the implementation plan at `$1` first.
- Use the plan's task signature and task file reference to find the linked task.
- Read the linked task file as needed to confirm execution scope and requirements.
- Work only in the relevant implementation files.
- Respect excluded directories and repo boundaries called out by the task, the plan, or project docs.

## Execution rules

1. Treat the implementation plan as the primary execution map.
2. Use the plan's file fingerprints and signatures to go straight to the intended files.
3. If the plan is obviously wrong, repair course minimally and keep changes aligned to the task requirements.
4. Prefer reusable shared code, extracted helpers, and deduplicated logic over task-specific branching.
5. Do not broaden scope beyond the linked task.
6. After modifying any `.ts` files, run `mise run check`.
7. If the task requires prompting or testing that depends on reloading `.pi/extensions`, note that clearly.

## Final response

- Keep the user summary short.
- State what was implemented.
- Mention checks run.
- Mention any reload step if changes touched `.pi/extensions` or `extensions/` behavior that requires it.
