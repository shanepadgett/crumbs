# JS Tool Management Handoff

## Fresh Chat Goal

Decide whether repo-scaffolding extension should add JS/TS tools to `package.json` devDependencies or manage them through mise npm backends, then write informed answer back into this file.

## Original Interview

- Decision file: `.working/interviews/repo-scaffolding-extension/decisions.md`
- Do not edit decision file. Read it for context only.
- Write findings and final answer back into this handoff file.

## Decision Question

For tools like `oxlint`, `oxfmt`, `@biomejs/biome`, `typescript`, and `markdownlint-cli2`, should v1 scaffold them as `package.json` devDependencies, manage them through mise npm backend/tool declarations, or support both with clear rules?

## Decision Criteria

- Preserves deterministic exact version pinning.
- Fits mise-centered value prop of tool/runtime management.
- Keeps generated tasks simple and predictable for Bun, Node+npm, and dual-runtime repos.
- Avoids unnecessary lockfile/package-manager mutation if mise can own tool binaries cleanly.
- Handles tools that are libraries/compilers versus standalone CLIs correctly.
- Keeps v1 implementation small enough to build cleanly.

## Context

- Interview source of truth: `.working/interviews/repo-scaffolding-extension/decisions.md`.
- Extension docs read: `/Users/spadgett/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`.
- Existing repo extension structure inspected under `extensions/`.
- Locked decisions include:
  - Always pin exact versions; never write `latest`, ranges, or channels.
  - User selects versions from presented lists; no manual version entry.
  - Version sources include mise `ls-remote`, npm registry metadata, and curated GitHub Releases API.
  - Tool creates/overwrites/merges selected outputs only; no update tracking.
  - JS/TS quality stack is Ox (`oxlint` + `oxfmt`) or Biome (`@biomejs/biome`), not both.
  - Markdown linting is independent.
  - Runtime selection supports existing repo detection, primary runner plus optional secondary runtime.
- Current unresolved branch appeared while deciding whether v1 should create `package.json` when missing.

## Viable Options

1. Add JS tools as `package.json` devDependencies.
   - Pros: conventional JS repo workflow, package scripts work naturally, lockfile captures package graph.
   - Cons: mutates package manager state; weaker mise-centered tool-management story; bare non-JS repos need `package.json` for CLI tools.

2. Manage JS CLIs through mise npm backend/tool declarations.
   - Pros: aligns with mise tool management, keeps package dependencies focused on app/library code, avoids creating `package.json` just for global-ish CLIs.
   - Cons: must verify mise npm backend behavior, command shims, version listing, and tool naming for each selected package.

3. Hybrid rules by tool role.
   - Pros: can use mise for standalone CLIs and `package.json` for project-coupled packages like `typescript` if needed.
   - Cons: more policy surface; generated tasks may mix mise shims and package runner commands.

## Evidence Explored

- mise npm backend docs say npm packages can be installed directly from npmjs.org and activated on PATH with `[tools] "npm:prettier" = "latest"`; exact pins can use same key with resolved version. It relies on an installed npm-capable package manager (`npm`, `aube`, `bun`, or `pnpm`).
- mise docs show scoped npm package syntax is supported via examples like `mise use npm:@antfu/ni`.
- Local `mise ls-remote` works for all candidate CLI packages:
  - `npm:@biomejs/biome` returned latest entries through `2.4.15`.
  - `npm:oxlint` returned latest entries through `1.64.0`.
  - `npm:oxfmt` returned latest entries through `0.49.0`.
  - `npm:markdownlint-cli2` returned latest entries through `0.22.1`.
- npm registry metadata confirms binary names:
  - `@biomejs/biome` exposes `biome`.
  - `oxlint` exposes `oxlint`.
  - `oxfmt` exposes `oxfmt`.
  - `markdownlint-cli2` exposes `markdownlint-cli2`.
  - `typescript` exposes `tsc` and `tsserver`, and also publishes `typings: ./lib/typescript.d.ts`, making it both compiler CLI and workspace-consumed library/editor dependency.
- npm registry metadata shows candidate CLIs carry their platform/runtime dependencies as normal npm dependencies/optionalDependencies, so mise npm backend can own them as standalone tool installs without project `package.json` involvement.

## Answer To Bring Back

Use hybrid rules by tool role.

Decision:

- Manage standalone JS quality CLIs through mise npm backend with exact pinned versions:
  - `"npm:oxlint" = "x.y.z"`
  - `"npm:oxfmt" = "x.y.z"`
  - `"npm:@biomejs/biome" = "x.y.z"`
  - `"npm:markdownlint-cli2" = "x.y.z"`
- Add `typescript` as exact pinned `package.json` `devDependencies` only when TS project support is selected or an existing JS/TS package already needs TS compile/typecheck support.
- Do not create `package.json` solely to host standalone lint/format/markdown CLIs.

Rationale:

- Preserves deterministic exact version pinning in both places.
- Fits mise-centered value prop: repo tool binaries live in `mise.toml`, not app/library dependency manifests.
- Keeps non-JS or bare repos from getting `package.json` only because markdown/lint tooling was selected.
- Keeps TypeScript local to project because it is both compiler and language service/library dependency; editors, `tsserver`, plugins, and package-manager workflows commonly expect workspace install.
- Keeps v1 rule small: standalone CLI tools go to mise npm backend; project-coupled compiler/library packages go to package devDependencies.
- Generated tasks stay simple because mise tasks can call shims directly (`oxlint`, `oxfmt`, `biome`, `markdownlint-cli2`) after mise installs tools.

Confidence: high for mise support and binary names. Remaining implementation detail: generated onboarding should say `mise install` is needed before running tasks, and npm backend requires an npm-capable package manager available via system or mise-managed runtime.

Suggested decision-file update:

> JS/TS standalone quality CLIs are managed through mise npm backend with exact pinned versions in `mise.toml`. This includes `oxlint`, `oxfmt`, `@biomejs/biome`, and `markdownlint-cli2`. `typescript` is treated as project-coupled compiler/library tooling and is added as exact pinned `package.json` `devDependencies` when TS support is scaffolded. v1 does not create `package.json` solely for standalone lint/format/markdown CLIs. Generated tasks call mise-provided CLI shims and assume users run `mise install` before task execution.
