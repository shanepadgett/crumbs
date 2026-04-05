# AGENTS.md

- Don’t update `README.md` unless the user asks.
- Every code extension should have a short documentation header with:
  - what it does
  - how to use it, including a simple example
- Documentation and code comments should describe the current state only.
  - Do not leave migration notes, rewrite history, deprecation narratives, or references to removed implementations unless the user explicitly asks for historical documentation.
- Prefer running project commands through `mise` tasks when executing scripts.
  - If a needed action is not available in the listed `mise` tasks, the agent may run commands directly as needed.
  - Always run `mise run check` after modifying .ts files
