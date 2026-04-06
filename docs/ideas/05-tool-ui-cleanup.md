# Tool UI Cleanup

Refactor the tool UI so different tools share a cleaner and more consistent rendering model. Right now this seems most relevant for Codex-style tools, but the larger opportunity is to define a minimal event vocabulary that works for shell commands, patches, research tools, and future extensions.

The goal is not just visual polish. A shared model would make it easier to reason about tool states like queued, running, streaming, blocked, succeeded, and failed, while also reducing duplicated rendering logic across extensions.

This could become the foundation for several other ideas in this folder, especially patch streaming, pane-based output, and better permission nudges. If those all need special UI treatment, then a cleanup pass here may be the right prerequisite.
