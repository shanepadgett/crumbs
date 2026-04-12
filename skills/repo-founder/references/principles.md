# Principles

Distilled from agent-friendly repo guidance and refactor review rules.

## Core

- Discovery before design
- Smallest setup that fully fits current scope
- Runtime safety and data safety beat cleanup
- Searchable guidance beats vague policy
- Simple local config beats abstraction
- Stable contracts beat pretty rewrites

## Config behavior

- Inspect existing files first
- Leave good config alone
- Patch bad or incomplete config surgically
- Prefer one obvious tool per job
- Keep tasks explicit and easy to run
- Avoid magic wrappers around standard tooling

## Anti-bloat

- No speculative extensibility
- No infrastructure inflation
- No boilerplate that makes routine checks expensive
- No task sprawl for tiny repos

## Agent ergonomics

- Names must grep well
- Keep docs current in root
- Put stack-specific rules in `AGENTS.md`
- Make high-risk paths easy to locate
- Prefer explicit commands over hidden automation

## Tooling lens

Set up only when useful:

- sane `.gitignore`
- runtime pins in `mise.toml`
- `lint` task
- `check` task depending on repo checks
- optional format and dead-code tasks

## Reconcile priorities

When choices fight:

1. runtime risk
2. over-engineering reduction
3. hygiene clarity
