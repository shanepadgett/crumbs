---
name: auto-guardian-audit
description: Analyze Auto Guardian bash audit logs and propose safe deterministic allow/block rule improvements. Use when reducing guardian LLM calls or reviewing command approval patterns.
---

# Auto Guardian Audit

Use this skill to inspect guardian-reviewed bash commands and propose safer deterministic rules.

## Source log

Read this JSONL file when it exists:

```text
~/.agents/crumbs/auto-guardian/audit.jsonl
```

Each line is one guardian-reviewed bash command with exact command text, command shape, guardian outcome, user decision, and final outcome.

## Workflow

1. Read the audit log.
1. Parse JSONL defensively; skip malformed lines and report count.
1. Group records by:
   - `shape.executable`
   - `shape.normalized`
   - `shape.features`
   - `finalOutcome`
1. Identify candidates:
   - repeated `guardian_allowed` commands that are read-only and have no risky shell features
   - repeated user-approved commands that deserve human review
   - repeated denied commands that deserve hard-block tests or rules
1. Output proposals only. Do not edit source or config unless user explicitly asks.

## Promotion rules

Recommend deterministic allow rules only when all are true:

- command is read-only, or writes are tightly scoped and intentionally handled by existing path policy
- command has no protected or outside-workspace write risk
- command does not use privilege escalation
- command does not combine network fetch with execution
- command does not depend on ambiguous shell parsing
- similar approved records repeat enough to justify source change
- risky variants can be covered by tests

Do not promote commands with these features unless parser-backed classification proves every segment safe:

- `pipeline`
- `redirection`
- `command-substitution`
- `variable-expansion`
- `globbing`
- `logical-operator`
- `subshell-or-group`
- `heredoc`

## Output format

Return concise sections:

```text
Audit summary
- records read: N
- malformed lines: N

Safe allow candidates
- command/executable: reason, count, suggested tests

Block candidates
- command/executable: reason, count, suggested tests

Needs human review
- command/executable: concern, count

Recommended next patch
- files/rules/tests to change if user wants implementation
```
