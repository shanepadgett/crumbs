# JavaScript

## AGENTS.md guidance

- Prefer direct modules over service/factory/adapter stacks
- Keep boundaries explicit at API, storage, and UI edges
- Use one clear async style per area
- Be careful with event-loop blocking work, stale async updates, leaked listeners/timers, runtime validation gaps

## .gitignore hints

- Ignore `node_modules/`, build outputs, coverage, env files, package-manager logs

## mise/tooling hints

- Runtime may need `node` or `bun`
- Tooling may include eslint, prettier, knip, depcheck, ts-prune-style tools depending on stack
- `lint` should call chosen lint tool
- `check` should depend on lint plus optional format/dead-code checks
