## Goal

Reduce paid guardian LLM calls by building auditable evidence for safe deterministic rules, while preserving hard-block safety.

## Principles

- Log first, learn later. Audit records must not change approval behavior by themselves.
- User reviews all rule promotions. No automatic weakening of security policy.
- Prefer hard deterministic blocks over guardian prompts for clearly dangerous commands.
- Prefer exact command families with parser-backed constraints over broad regex allow rules.
- Treat shell operators, redirection, command substitution, and pipelines as separate safety boundaries.

## Phase 1: Guardian audit log

- [x] Add `extensions/auto-guardian/src/audit.ts`.
- [x] Write append-only JSONL audit records for bash requests that reach guardian review or user prompt after guardian review.
- [x] Store under global crumbs data folder: `~/.agents/crumbs/auto-guardian/audit.jsonl`.
- [x] Record:
  - timestamp
  - cwd
  - command exactly as requested
  - normalized command summary
  - deterministic classification before guardian
  - guardian decision and reason category, not raw hidden prompt internals
  - user decision when prompted
  - final outcome: allowed or denied
  - tool call id/session id if available
  - extension version/config fingerprint if cheap
- [x] Keep audit best-effort: logging failure must not approve unsafe command.

## Phase 2: Audit analysis skill

- [x] Add local skill under `.agents/skills/auto-guardian-audit/`.
- [x] Skill reads audit JSONL if present.
- [x] Skill groups commands by executable, normalized shape, features, and outcome.
- [x] Skill reports:
  - repeated guardian-approved commands worth deterministic allow rules
  - repeated user-approved commands worth reviewing
  - repeated denied commands worth hard-block rules/tests
  - commands that are unsafe to promote because of shell operators, path mutation, env expansion, or unknown executable behavior
- [x] Skill outputs proposed rule/test changes only. It does not edit unless user explicitly asks.

## Phase 3: Safer shell classification model

- [x] Add command shape extraction for audited bash commands.
- [x] Identify shell features in audit records:
  - pipelines
  - redirection and append
  - command substitution
  - variable expansion
  - globbing
  - logical operators `&&` / `||`
  - subshells and grouping
  - heredocs
- [x] Apply shell feature model to deterministic allow rules for known read-only commands, shell wrappers, and plain command sequences.
- Safety stance:
  - safe read-only command alone may be allowed
  - pipeline is allowed only when every segment is safe and no sink is dangerous
  - redirection to file is mutation and must follow path policy
  - command substitution inherits risk of inner command
  - `sh`, `bash -c`, `eval`, `xargs` with shell, `curl | sh`, `wget | sh` are hard prompt/block candidates

## Phase 4: Rule promotion workflow

- Add tests before allowing promoted patterns.
- Maintain rule lists in source, not only config, for globally useful safe cases.
- Use config allowlist only for user/project-specific commands.
- Promotion checklist:
  - command is read-only or mutation is tightly scoped and intended
  - no protected/outside-workspace path writes
  - no network + execution chain
  - no privilege escalation
  - no shell parser ambiguity
  - repeated approvals exist in audit log
  - denied/risky variants have tests

## Open questions

- Exact global crumbs data path for audit logs.
- Whether audit should include full command only, or redact obvious secrets first.
- Whether audit retention/rotation is needed immediately.
- Whether user wants skill to only report, or offer patch generation after explicit confirmation.
