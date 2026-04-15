# AGENTS.md

## Repo-specific rules

### Documentation scope

- Do not update `README.md`, `AGENTS.md`, or other documentation files unless user explicitly asks.
- Main extension entry file should include short header: what it does, how to use, simple example.
- Each completed extension should have `extensions/<name>/README.md` with minimal description of purpose, user-facing surface, and how it works.
- Add extension README only near completion so scope is stable and README churn stays low.
- Keep header in main entry file only, not helper files.

### Extension structure and shared code

- Only extension entry files may live at `extensions/` root.
- Put all other code in extension subfolders or `extensions/shared/`.
- Put truly reusable helpers in shared domains (for example `extensions/shared/io`, `extensions/shared/ui`, `extensions/shared/config`).
- Avoid extracting trivial helpers by default.

### Pi UI and interaction patterns

- Use `keyHint(...)` or `rawKeyHint(...)` for shortcut hints.
- Prefer built-in Pi/TUI components over custom UI.
- Prefer `pi.events` over polling when state change originates inside Pi.

### Change scope boundaries

- Do not add commands, modes, settings, UI options, or behavior not requested.
- This codebase is non-live; prefer clean replacement over compatibility layering when user asks for redesign.

## Execution constraints

- Changes under `extensions/` or `.pi/extensions` require `/reload` before user testing.
- When change is testable end-to-end by user, final response should include minimal test instructions.
- For extension changes in this repo, test instructions should explicitly say to run `/reload` first.
- Prefer project commands via `mise` tasks; run direct command only if task does not exist.
- **Never manually run validations or checkers** unless user explicitly asks in current turn.
- This includes `tsc`, lint, format, test, markdownlint, typecheck, build verification, or any repo validation command.
- Reason: repo has silent/background validation path. Manual validation wastes tool calls, burns context, and duplicates signals user already receives.
- Assume user will be informed of validation failures externally. Do not “double check” on your own.

## Safety boundary (IMPORTANT)

Do not operate outside current working directory until sandboxing is introduced.
