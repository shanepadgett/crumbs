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
- For Pi extension keyboard shortcuts and footer/help hints, always use `keyHint(...)` or `rawKeyHint(...)` instead of plain text shortcut labels.
- For Pi extension UI, prefer built-in Pi/TUI reusable components and patterns first. Only build custom UI when those components cannot support the interaction.
- For inter-extension communication, prefer `pi.events` and event-driven updates over polling when the state change originates inside Pi or another extension. Keep polling for truly external state only when no reliable event source exists.
- Do not manually run any validations like tsc, lint, format. Trust the system will do it silently and report any issues. This includes after you make fixes.

> **IMPORTANT**: Use only known safe bash tools and flags until permissions are in place, and never work outside the current working directory until sandboxing is introduced.
