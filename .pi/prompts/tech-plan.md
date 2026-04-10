---
description: Build a deep implementation plan for a task file against a target code area
---
# Technical Plan

Create a detailed implementation plan for `$1` against the relevant current implementation.

## Scope

- Read the task file at `$1` first.
- Analyze only implementation files directly relevant to the task.
- Prefer the narrowest reasonable code area instead of broad repo exploration.
- Respect task or repo boundaries called out in project docs.
- If the task is extension-focused, inspect only the relevant files under `extensions/` unless the task clearly requires another area.
- Do not inspect, rely on, or propose work under excluded directories such as `external/` when the task or repo guidance says to avoid them.
- Do not broaden scope beyond what the task requires.

## Goal

Produce a cold-agent-ready technical plan that another agent can execute with minimal extra discovery. Optimize for reusable architecture, shared components, deduplication, and clean boundaries instead of one-off code paths.

## Planning rules

1. Derive all requirements from the task file and its referenced requirements.
2. Reconcile those requirements with the current implementation in the relevant code area.
3. Identify missing infrastructure, reusable abstractions, UI/runtime boundaries, data shapes, and integration points.
4. Prefer extending or extracting shared code over duplicating logic.
5. Do not write full implementation code unless a tiny illustrative signature is necessary.
6. Leave exact file signatures for any file that must be added or changed so the implementing agent does not have to guess.
7. If a file is unchanged but important for context, list it separately as read-only reference context.
8. Call out assumptions, risks, and validation points explicitly.

## Output format

Use exactly these sections in this order:

### 1. Plan Signature

- `Task File:` `<path>`
- `Task Title:` `<title>`
- `Task Signature:` `<stable slug derived from the task file name/title>`
- `Primary Code Scope:` `<specific paths inspected>`
- `Excluded Scope:` `<directories or files intentionally excluded>`

### 2. Executive Summary

- 1 short paragraph on the implementation target.
- 1 short paragraph on the architectural approach.

### 3. Requirement Map

For every EARS requirement in the task:

- Quote or restate the requirement.
- Mark status as `already satisfied`, `partially satisfied`, or `needs implementation`.
- Cite the current files/functions/types that relate to it.
- State the planned implementation move.

### 4. Current Architecture Deep Dive

- Relevant files and what role each one plays.
- Existing runtime flow.
- Current data/model shapes.
- Current UI/rendering flow.
- Reusable pieces that should be preserved.
- Friction, duplication, or missing seams.

### 5. Target Architecture

- Proposed modules and responsibilities.
- Data flow from command entry to final persisted or emitted result.
- Reusable abstractions to introduce or strengthen.
- Clear boundaries between runtime, validation, storage, UI, and command orchestration.

Include at least one ASCII diagram.

### 6. File-by-File Implementation Plan

For each file to modify or add:

- `Path:`
- `Action:` `add` | `modify` | `extract` | `rename` | `delete`
- `Why:`
- `Responsibilities:`
- `Planned exports / signatures:`
- `Key logic to add or change:`
- `Dependencies:`
- `Risks / notes:`

When describing signatures, use concrete TypeScript-style shapes where useful, for example:

```ts
function example(input: ExampleInput): ExampleOutput
interface ExampleState {
  value: string;
}
```

### 7. File Fingerprints

For every file to modify or add, provide a fingerprint block:

- `Path:`
- `Reason this file changes:`
- `Existing anchors to search for:` exact strings, exports, types, or functions
- `New anchors expected after implementation:` exact names or headings to add
- `Unsafe areas to avoid touching:`

If a new file is needed, say `Existing anchors to search for: none (new file)`.

### 8. Stepwise Execution Plan

- Ordered implementation steps.
- Note which steps are safe to do in parallel and which are not.
- Include checkpoints where the agent should run tests or manual verification.

### 9. Validation Plan

- Unit/integration/manual verification needed.
- Expected user-visible behavior.
- Failure modes to test.
- Any `mise run check` or other repo checks to run after TypeScript edits.

### 10. Open Questions / Assumptions

- Only list true blockers or ambiguities.
- If none, say `None`.

## Final quality bar

The plan must be detailed enough that a cold implementing agent can take:

- the original task file
- this technical plan

and perform the work without doing broad repo archaeology.
