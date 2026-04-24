<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/_media/crumbs-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/_media/crumbs-logo-light.png">
    <img alt="lattice" src="docs/_media/crumbs-logo-light.png" style="max-width: 100%; border-radius: 8px;">
  </picture>
</p>

<p align="center">
  Tiny Pi helpers and playful extension experiments, bundled in one cozy crumb pile.
</p>

## Prerequisites

Install these tools first:

- [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) installed on your system so the `pi` command is available

```bash
bun install -g @mariozechner/pi-coding-agent
// OR
npm install -g @mariozechner/pi-coding-agent
```

- [mise](https://mise.jdx.dev/) installed on your system

## First-time setup

Run these commands once when setting up the project for the first time:

```bash
mise trust
mise install
bun install
```

- `mise trust` lets mise use this project's config
- `mise install` installs the pinned project tools
- `bun install` installs the package dependencies

## Install extensions

```bash
pi install .
```

Use `-l` to install into project settings (`.pi/settings.json`) instead of global settings.

```bash
pi install -l .
```

## Remove extensions

```bash
pi remove .
```

```bash
pi remove -l .
```

## Testing

Tests use Bun from root project tooling.

```bash
mise run test
```

Run tests for changed files and nearby extension scope when focused feedback is enough.

```bash
mise run test_targeted
```

Place unit tests beside source as `*.test.ts`. Scope tests by path when investigating one area.

```bash
bun test extensions/<extension-name>
bun test extensions/<extension-name>/src/example.test.ts
```

Testing conventions:

- use root Bun test tooling rather than per-extension test frameworks unless extension has distinct runtime needs
- prefer pure unit tests for parsers, matchers, normalizers, renderers, config coercion, and prompt builders
- use `extensions/test-support/temp-dir.ts` for tests that mutate filesystem state
- use fixtures when inline strings make tests harder to read
- avoid live network, model, or Pi runtime tests by default
- avoid snapshots unless output is stable public behavior

## Crumbs settings reload behavior

Crumbs settings are cached after Pi loads extensions.

If you edit crumbs settings files while Pi is running, `/reload` Pi to pick up changes.

## Crumbs settings architecture

Crumbs uses two config locations:

- global: `~/.pi/agent/crumbs.json`
- project: `<projectRoot>/.pi/crumbs.json`

Effective config precedence:

- project crumbs overrides global crumbs
- missing keys fall back to extension defaults

Ownership boundary:

- crumbs-owned config should live in crumbs files
- Pi settings files are not target home for crumbs-owned config

Migration note:

- this repo is actively migrating extension settings to crumbs files
- some extensions may still read/write Pi settings until migration phases complete
