# Permissions Model Overhaul

- Redesign permission modes to match familiar mental models from Claude Code/Codex-style workflows.
- Add explicit user approval flow for file/folder access outside the current workspace.
- Track and enforce approved external paths with clear prompts and revocation behavior.
- Keep permission decisions visible in UI so current access scope is always obvious.
- Success: external path access is blocked by default and unlocked only through explicit user consent.
