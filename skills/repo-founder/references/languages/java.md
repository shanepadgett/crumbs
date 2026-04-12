# Java

## AGENTS.md guidance

- Prefer direct app code over enterprise ceremony
- Use interfaces only for multiple impls, hard boundaries, or real test seams
- Keep request flow traceable
- Be careful with blocking work, resource cleanup, partial writes, swallowed exceptions

## .gitignore hints

- Ignore build outputs, IDE files, local env files, dependency caches when repo-local

## mise/tooling hints

- Runtime may need `java`, build tool CLI if used, linter if chosen
- `lint` can wrap project lint task if repo has one
- `check` can depend on lint plus formatter/dead-code tasks when chosen
