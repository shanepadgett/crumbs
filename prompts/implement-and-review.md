---
description: Implement then review through worker → reviewer → worker subagents
---

Use `subagent` tool.

Run chain:

1. `worker` make smallest clean change set for request.
1. `reviewer` review result for real issues.
1. `worker` address review findings if needed.

Keep review strict. Keep fixes narrow.

User request:
$@
