# AGENTS.md

- Don’t update `README.md` unless the user asks.
- Every pi extension should have a short documentation header with:
  - what it does
  - how to use it, including a simple example
  - only include the header in the main extension file
- Documentation and code comments should describe the current state only.
  - Do not leave migration notes, rewrite history, deprecation narratives, or references to removed implementations unless the user explicitly asks for historical documentation.
- Prefer running project commands through `mise` tasks when executing scripts.
  - If a needed action is not available in the listed `mise` tasks, the agent may run commands directly as needed.
- Code is not live yet. Break anything. Change or replace whatever needed. Don't worry about versions or migrations.
- When modifying code, leave no past remnant unless asked to. Clean up and keep the codebase free of indirection from prior implementations.
- Any changes to extensions/ or .pi/extensions requires user to reload before testing.
- Only actual [extension-name].ts files may live under extensions/ root folder. All other files must be in an extension subfolder or extensions/shared/
- Do not manually run `mise run check` after edits. Trust the system will report issues to you.
- Do not manually run `markdownlint` after Markdown edits, even after fixing issues. Trust the quiet markdownlint extension to report failures.

> **IMPORTANT**: Use only known safe bash tools and flags until permissions are in place, and never work outside the current working directory until sandboxing is introduced.
