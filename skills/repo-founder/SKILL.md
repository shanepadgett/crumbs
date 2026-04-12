---
name: repo-founder
description: "Interview user, then set up agent-friendly repository guidance and tooling: sane .gitignore, repo-specific AGENTS.md, and optional mise.toml with runtime and check tasks. Use when user wants to start a new repo, prepare repo automation, create AGENTS.md guidance, or set up repo tooling from requirements."
---

# Repo Founder

Use for repo setup interview and foundation docs/tooling. Not feature scaffolding.

Read first:

- `references/interview.md`
- `references/principles.md`
- `references/outputs.md`
- only language refs that match planned stack

## Goal

Turn vague repo idea into agent-friendly repo setup:

- sane `.gitignore`
- repo-specific `AGENTS.md`
- optional `mise.toml`
- runtime-aware tool setup
- simple lint/check tasks
- language-local guidance agents can follow later

## Inputs

Required:

- repo idea or product brief

Optional:

- target dir
- language / framework
- runtime tools
- lint / format / dead-code tools
- repo type
- team size
- constraints

If key inputs missing, interview user with `references/interview.md`.

## Rules

- Discovery first
- Ask before writing if requirements still ambiguous
- Prefer smallest repo setup that fits stated near-term needs
- Do not scaffold feature folders or architecture unless user asks
- Keep guidance concrete, searchable, and stack-specific
- If `.gitignore` exists and is good, leave it alone
- If `.gitignore` exists but misses stack/runtime/tooling needs, patch surgically
- Offer `mise.toml` only when missing or user wants upgrade
- `mise.toml` tasks should cover lint and combined `check`; include format or dead-code only when repo needs them
- Never add markdown lint tasks
- Match language-local modern patterns from active refs
- Emit root `AGENTS.md` guidance tuned to repo
- Keep tool choices aligned with expected runtimes: `node`, `bun`, etc.

## Workflow

1. Read user brief
2. Run interview from `references/interview.md` until stack, runtimes, repo tooling, and agent guidance needs are clear
3. Pick only matching language refs
4. Inspect existing `.gitignore`, `AGENTS.md`, `mise.toml`, package/runtime files if present
5. Build repo setup plan using `references/principles.md`
6. Present plan before writing unless user already asked for direct creation
7. Create or patch files from `references/outputs.md`
8. Summarize decisions, assumptions, and next setup steps

## Deliverables

Default deliverables:

- updated or new `.gitignore`
- root `AGENTS.md`
- optional `mise.toml`
- notes on chosen runtimes, linting, dead-code checks, and `check` task shape

## Language activation

Activate only refs that match planned stack:

- Swift / SwiftUI -> `references/languages/swift-swiftui.md`
- Java -> `references/languages/java.md`
- Kotlin -> `references/languages/kotlin.md`
- JavaScript -> `references/languages/javascript.md`
- TypeScript -> `references/languages/typescript.md`

If stack mixed, apply each ref only to owned areas.

## Guardrails

- Do not invent repo structure user did not ask for
- Do not rewrite good existing config for style alone
- Do not add tooling user will not use
- Do not add markdown lint tasks
- Do not add format or dead-code tasks unless stack/tools justify them
- Keep generated guidance short, concrete, searchable
- Every added task must map to real repo tooling
