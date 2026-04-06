# Agent-controlled Auto-compaction

Let the agent decide when to trigger compaction instead of waiting for a fixed threshold or manual user action. This would work best with explicit keep/drop priorities so the agent can preserve high-value context like active goals, recent errors, file paths, and open decisions while discarding low-value command noise.

The main design question is how much control to give the agent versus the platform. A safe version would let the agent propose compaction with a structured reason and a candidate retention plan, while the runtime still enforces limits and guarantees that critical session state survives.

This idea also fits naturally with the existing memory extension. If compaction is no longer a blind truncation step, the memory layer can become a policy engine that marks entries as must-keep, summarize-soon, or safe-to-drop and produces more intentional summaries.
