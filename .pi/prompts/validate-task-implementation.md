---
description: Validate a task file against the current git diff and tag requirement evidence
---
# Validate Task Implementation

Validate the implementation of `$1` against the current codebase and git diff.

## Scope

- Read the task file at `$1` first.
- Use the current git diff as the primary discovery surface for what changed.
- Read any additional files needed to verify whether each requirement is actually implemented.
- Respect task or repo boundaries called out in project docs.
- Do not inspect, rely on, or propose work under excluded directories such as `external/` when task or repo guidance says to avoid them.

## Goal

Act as a fresh verification agent. Confirm whether each task requirement is covered by the implemented changes, tag the task file with concrete evidence, and provide light implementation critique where relevant.

## Validation rules

1. Start from the git diff, not assumptions.
2. For each requirement, find concrete implementation evidence in code, behavior, tests, or wiring.
3. Distinguish clearly between `implemented`, `partially implemented`, `not found`, and `unclear`.
4. Be skeptical. Do not give credit for intent when code evidence is weak.
5. If you find likely correctness or architecture issues while validating, note them as concise review comments.
6. Update the task file with requirement-level evidence.
7. Keep evidence terse and concrete.

## Task file update rules

- Edit `$1` directly.
- Under each requirement bullet, add a short nested evidence bullet.
- Use this format exactly:

```md
- Requirement text
  - Evidence: <implemented|partially implemented|not found|unclear> — <concise file/function/behavior evidence>
```

- If multiple pieces of evidence matter, keep them on one line separated by semicolons.
- If the task file already contains evidence bullets, refresh them instead of duplicating them.

## Output format

### 1. Validation Result

- `Pass`, `Partial`, or `Fail`
- Short reason.

### 2. Requirement Audit Summary

- Count of implemented requirements.
- Count of partial requirements.
- Count of not found or unclear requirements.

### 3. Review Notes

- Short bullets for anything concerning, fragile, overcomplicated, or notably well done.

### 4. Files Verified

- List the main files inspected during validation.

## Final response

- Keep it short.
- Say that the task file was updated with evidence.
- Mention any important review findings.
