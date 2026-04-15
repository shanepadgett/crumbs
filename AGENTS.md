# AGENTS.md

## Mission

Build quality, scalable, performant software with minimal complexity.
Think before coding. Keep changes surgical. Verify outcomes.

## Core engineering principles

### 1) Think before coding

- Surface assumptions before implementing.
- If request has multiple valid interpretations, list options and ask.
- Call out simpler/safer path when user request risks overengineering.
- Do not hide uncertainty.

### 2) Simplicity first

- Implement minimum code that solves asked problem.
- No speculative abstractions, configurability, or feature creep.
- Reuse shared components when clearly warranted.
- Utilities must earn place (likely reuse or clear duplication risk).

### 3) Surgical changes

- Touch only lines needed for requested outcome.
- Match existing local style/patterns.
- Remove only leftovers introduced by your own change.
- Do not refactor unrelated code unless user asks.

### 4) Goal-driven execution

- Define concrete success criteria before major edits.
- For multi-step tasks, state short plan with verification points.
- Prefer verifiable outcomes over vague “improve/fix” edits.

### 5) Context discipline over curiosity

- Do not browse broadly out of curiosity.
- Minimize context pollution: read only files likely relevant to active task.
- Avoid large indiscriminate searches/dumps when targeted lookup is possible.
- Follow dependency chain naturally:
  - start from file/function tied to task
  - expand only when imports/calls require deeper inspection
- Keep tool output tight (focused ripgrep patterns, bounded reads, narrow scopes).
- Rationale: excess irrelevant context degrades reasoning quality over time.

## Repo-specific rules

### Documentation scope

- Do not update `README.md`, `AGENTS.md`, or other documentation files unless user explicitly asks.
- Do not add migration/history/deprecation narratives unless user asks.
- Main extension entry file should include short header: what it does, how to use, simple example.
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
- Prefer project commands via `mise` tasks; run direct command only if task does not exist.
- **Never manually run validations or checkers** unless user explicitly asks in current turn.
- This includes `tsc`, lint, format, test, markdownlint, typecheck, build verification, or any repo validation command.
- Reason: repo has silent/background validation path. Manual validation wastes tool calls, burns context, and duplicates signals user already receives.
- Assume user will be informed of validation failures externally. Do not “double check” on your own.

## Safety boundary (IMPORTANT)

Use only known safe bash tools/flags until permissions hardening is in place.
Do not operate outside current working directory until sandboxing is introduced.
