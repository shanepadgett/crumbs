---
description: Implement then review through worker → reviewer → worker subagents
---
Use `subagent` tool.

Run chain:

1. `worker` make smallest clean change set for request.
2. `reviewer` review result for real issues.
3. `worker` address review findings if needed.

Keep review strict. Keep fixes narrow.

User request:
$@
