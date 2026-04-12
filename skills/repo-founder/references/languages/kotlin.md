# Kotlin

## AGENTS.md guidance

- Prefer structured concurrency
- Keep coroutine ownership obvious
- Use interfaces, use-cases, repositories only when they pay for themselves
- Be careful with cancellation, dispatcher choice, lifecycle leaks, partial persistence failures

## .gitignore hints

- Ignore build outputs, IDE files, local env files, generated artifacts

## mise/tooling hints

- Runtime may need `java`, `gradle` or `kotlin` tooling, linter if chosen
- `lint` can wrap project lint task if repo has one
- `check` can depend on lint plus formatter/dead-code tasks when chosen
