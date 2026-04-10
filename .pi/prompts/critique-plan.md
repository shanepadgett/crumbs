---
description: Critique an implementation plan file for completeness and correctness
---
# Plan Critique

Critique the implementation plan in `$1` against the linked task and current implementation.

## Scope

- Read the critique target file at `$1` first.
- From that file, find the referenced task file and evaluate the plan against it.
- Analyze only the implementation files relevant to that task.
- Respect task or repo boundaries called out in project docs.
- Do not inspect, rely on, or propose work under excluded directories such as `external/` when task or repo guidance says to avoid them.

## Goal

Find gaps, wrong assumptions, architectural problems, missing reusable abstractions, bad file targeting, weak fingerprints, and any place where a cold implementing agent would still have to guess.

## Critique rules

1. Validate every task requirement against the plan.
2. Check whether the plan matches the actual code layout and realistic implementation boundaries.
3. Prefer feedback that improves reuse, deduplication, and maintainable seams.
4. Call out over-planning too: remove unnecessary complexity where simpler architecture would work.
5. Be specific about what to add, delete, tighten, or rewrite in the plan.
6. If the plan references files that do not exist or ignores obvious relevant files, say so.

## Output format

Use exactly these sections:

### 1. Verdict

- `Ready` or `Not ready`
- 2-5 bullets summarizing why.

### 2. Requirement Coverage Audit

For each EARS requirement from the linked task:

- `Requirement:`
- `Plan coverage:` `strong` | `partial` | `missing` | `incorrect`
- `Critique:`
- `Fix needed:`

### 3. Codebase Alignment Audit

- Files the plan correctly targets.
- Files it misses.
- Files it should not touch.
- Any proposed abstractions that do not fit the current codebase.

### 4. Architecture Critique

- Good architectural decisions.
- Over-engineering.
- Missing reusable boundaries.
- Duplication risk.
- State management / UI / data-flow concerns.

### 5. File Fingerprint Critique

For each planned file change:

- Is the fingerprint precise enough for a cold agent?
- Are search anchors concrete and trustworthy?
- Are proposed signatures plausible?

### 6. Missing Plan Content

- Anything the plan still needs so an implementing agent can work without broad repo search.

### 7. Recommended Revisions

- Ordered list of exact revisions to make to the plan.

### 8. Minimal Acceptance Bar

- What must be fixed before the plan is implementation-ready.
