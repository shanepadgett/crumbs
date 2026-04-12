# Interview

Use only needed questions. Skip answered items. Stop once repo setup decisions are clear.

## 1. Repo shape

- What does repo build?
- Who uses it?
- Single app, package, service, library, monorepo, or tool?
- Greenfield or replacing existing code?

## 2. Stack

- Primary language?
- Frameworks?
- Expected runtimes: `node`, `bun`, JVM, Swift toolchain, browser, other?
- Single runtime or multiple runtimes?

## 3. Tooling

- Existing `.gitignore`?
- Existing `AGENTS.md`?
- Existing `mise.toml`?
- Existing package manager or version manager?
- Lint tools wanted per language?
- Format tools wanted?
- Dead-code detection wanted?

## 4. Agent guidance

- What coding patterns should agents prefer?
- What should agents avoid?
- Any runtime-risk or data-safety paths agents must treat carefully?
- Any repo-specific validation habits to mention?

## 5. Workflow

- Solo or team?
- Strong preference for tests, lint, CI, codegen, strict typing?
- Repo optimized for speed, safety, compliance, or experimentation?
- Agent-first workflow expected?

## 6. Delivery target

- Want plan only or direct file creation?
- Want `mise.toml` created if missing?
- Want existing files patched or only reviewed?
- Where should repo be created?

## Decision test

Ready to write when all are clear:

- repo type
- primary stack
- runtime tools
- lint / format / dead-code preferences
- agent guidance priorities
- output location
