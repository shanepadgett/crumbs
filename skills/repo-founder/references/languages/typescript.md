# TypeScript

## AGENTS.md guidance

- Same JavaScript guidance applies
- Prefer clear domain types over clever type machinery
- Keep schema, DTO, and API types from drifting
- Narrow explicitly at unsafe edges
- Be careful with unsafe assertions hiding runtime risk

## .gitignore hints

- Ignore `node_modules/`, build outputs, coverage, generated types if reproducible, env files, package-manager logs

## mise/tooling hints

- Runtime may need `node` or `bun`
- Tooling may include eslint, typescript, prettier, knip, ts-prune-style tools
- `lint` should call chosen lint tool
- `check` should depend on lint plus optional format/dead-code checks
