---
name: refactor-opportunities
description: "Refactor and code review across hygiene, over-engineering, runtime lenses. Supports target review and uncommitted-changes review. Reconciles conflicts, checks churn, emits ordered work units, uses language overlays."
---

# Refactor Opportunities

Target dir defaults to cwd.

## Artifact root

- Artifact root: `.agents/reviews/refactor-opportunities`
- Per-run artifacts: `.agents/reviews/refactor-opportunities/runs/<run-id>/`
- Cross-run history: `.agents/reviews/refactor-opportunities/history.jsonl`

## Init

No full discovery first.

Order:

1. Root topology scan
2. Scope-mode confirmation
3. Scope confirmation
4. Effort confirmation
5. Scoped language discovery
6. Setup + dispatch

## Scope modes

- `target`: review repo or confirmed dir
- `changes`: review uncommitted git changes; judge impl quality; catch missed local impact

## Modes

- `full`: hygiene + over-engineering + runtime
- `hygiene`
- `over-engineering`
- `runtime`

## Rules

- Say `subagents`. Host chooses parallel or sequential.
- Agents judge. Scripts shape.
- Discovery before dispatch.
- Subagents get only files for their lane.
- Subagents read one section from their lens criteria file, not isolated excerpt. Reason: adjacent-criteria awareness.
- Lens criteria stay language-agnostic. Overlays live in `references/languages/`.
- Output matches `references/output-schema.md`.
- No automatic code changes.
- Work units must not fight.
- Orchestrator stays thin. Read only routing files.
- Orchestrator reads language overlays only if routing needs them.
- Root scan stays cheap. No deep traversal before scope confirmation.
- Detect repo shape before scope question.
- One obvious target -> propose it.
- Many targets -> show short candidate list.
- Effort controls fanout. No fixed max fanout by default.
- `changes` mode is focused review, not blind diff review.
- In `changes`, changed files are primary evidence.
- In `changes`, unchanged files are context only: verification, dependency tracing, missed-impact checks.
- In `changes`, every finding ties to changed work or direct local impact.
- Do not use `changes` mode for random repo cleanup hunt.
- Cross-run history is advisory. It warns on churn. It does not veto findings.
- Churn check can use cheaper model. Escalate only strong conflicts.

## 1. Root topology scan

Run deterministic root scan.

```bash
ARTIFACT_ROOT=.agents/reviews/refactor-opportunities
ROOT_SCAN_DIR="$ARTIFACT_ROOT/root-scan"
node ./scripts/root-topology-scan.mjs \
  . \
  "$ROOT_SCAN_DIR/root-topology.txt"
```

Read `root-topology.txt`. Infer shape:

- single-project root
- single obvious app/service dir
- multi-project repo
- monorepo with `apps/`, `packages/`, `services/`, similar roots

Do not read criteria or overlays yet.

## 2. Confirm scope mode

Ask for:

- `target`
- `changes`

Default rules:

- repo or dir review -> `target`
- uncommitted work, working tree, feature in progress, current impl review -> `changes`

## 3. Confirm scope

Use root scan + chosen scope mode.

### `target` scope

- One obvious target -> ask to review it.
- Root app present -> include repo root as candidate.
- Many targets -> show short list.
- Ask user to pick target or whole repo.

Target is actual review scope. Subagents stay inside it. Mention outside issues only if they materially affect in-scope findings.

### `changes` scope

Build changed-files manifest first.

```bash
ARTIFACT_ROOT=.agents/reviews/refactor-opportunities
RUN_ID=$(date -u +%Y-%m-%dT%H-%M-%SZ)
RUN_DIR="$ARTIFACT_ROOT/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
node ./scripts/collect-changed-files.mjs . "$RUN_DIR/changed-files.json"
```

Read `changed-files.json`.

- No changed files -> stop. Say none found.
- Exclude deleted files from primary scope.
- Keep rename paths accurate.
- Ignore generated artifacts and lockfiles unless user asks or finding depends on them.
- If volume is high, ask: all changed files or subset?

In `changes`, target is changed-files manifest + nearby unchanged code only when needed for truth.

## 4. Confirm effort

Ask after scope confirmation.

- `low`: one subagent per active lens
- `medium`: one subagent per active criteria section for active lenses
- `high`: per-section subagents; add verification subagents if needed; extra partition only for very large scope

Effort controls token spend and fanout.

## 5. Scoped language discovery

Run only inside confirmed scope.

Supported: TypeScript, JavaScript, Swift, Java, Kotlin, Go, Rust.

### `target` language discovery

```bash
ARTIFACT_ROOT=.agents/reviews/refactor-opportunities
RUN_ID=$(date -u +%Y-%m-%dT%H-%M-%SZ)
RUN_DIR="$ARTIFACT_ROOT/runs/$RUN_ID"
MANIFEST="$RUN_DIR/run-manifest.json"
mkdir -p "$RUN_DIR"
TARGET_PATH="<confirmed-target>"
node ./scripts/detect-languages.mjs \
  "$TARGET_PATH" \
  "$RUN_DIR/detected-languages.json"
```

### `changes` language discovery

Detect languages from changed-files manifest first.

```bash
node ./scripts/detect-languages-from-files.mjs \
  "$RUN_DIR/changed-files.json" \
  "$RUN_DIR/detected-languages.json"
```

Use counts to pick stacks:

- whole repo -> only stacks with meaningful counts
- subdir scope -> only stacks inside target
- changed scope -> only stacks in changed files unless adjacent context proves direct involvement
- one dominant stack -> prefer that overlay only
- mixed stack -> pass only overlays relevant to lane
- never send unrelated overlays

Counts help routing and summary. They do not force overlays.

## 6. Setup

Write `run-manifest.json` with:

- `runId`
- `artifactRoot`
- `runDir`
- `historyPath`
- `scopeMode`
- `target`
- `mode`
- `effort`
- detected languages
- active overlays
- active lens sections
- paths: `findings`, `compiled`, `normalized`, `reconciled`, `churn`, `plan`, `plans`

If `scopeMode=changes`, include:

- `changedFiles`
- optional `reviewedChangedFiles`
- optional `excludedFiles`
- `contextRule`: unchanged files are support evidence only

```bash
node ./scripts/init-run.mjs "$MANIFEST"
```

## 7. Dispatch subagents

Fanout by effort.

- `low`
  - `full`: 3 subagents, one per lens
  - single-lens modes: 1 subagent
- `medium`
  - one subagent per active criteria section
  - `full` 17 | `hygiene` 7 | `over-engineering` 5 | `runtime` 5
- `high`
  - same section fanout as `medium`
  - add verification subagents if needed
  - split extra only when scope size justifies it

Each subagent gets: target dir or changed-files scope, manifest path, assigned lens criteria scope, matching overlays, one output path, `references/output-schema.md`.

Lane shape:

- `low`: one subagent reads whole active lens criteria file; one output file per lens
- `medium` and `high`: one subagent reads one assigned section from one active lens criteria file; one output file per section

Prompt:

> Read assigned lens criteria scope, `references/output-schema.md`, and only
> assigned language overlays. Do not read other overlays. Do not read other
> lens criteria files. Investigate codebase in scope. Flag adjacent issues in
> same lens if seen. If scope mode is `changes`, changed files are primary
> evidence and unchanged files are context only. Tie findings to changed work
> or direct impact from it. Use overlays to refine checks, not replace lens
> criteria. Write exactly one findings markdown file to assigned output path.
> File only. No extra report text.

Overlay rule: orchestrator picks overlays first. Subagent gets explicit paths. No overlay match -> lens criteria only.

| Lens | Sections |
|---|---|
| hygiene | `references/hygiene/criteria.md` 1-7 |
| over-engineering | `references/over-engineering/criteria.md` 1-5 |
| runtime | `references/runtime/criteria.md` 1-5 |

| Stack | Overlay |
|---|---|
| Swift / SwiftUI | `references/languages/swift-swiftui.md` |
| Java | `references/languages/java.md` |
| Kotlin | `references/languages/kotlin.md` |
| JavaScript | `references/languages/javascript.md` |
| TypeScript | `references/languages/typescript.md` |
| Go | none |
| Rust | none |

## 8. Validate raw findings

```bash
node ./scripts/validate-findings.mjs "$RUN_DIR/findings"
```

Re-dispatch failed sections only.

## 9. Compile per lens

```bash
node ./scripts/compile-lens-report.mjs "$RUN_DIR/findings/<lens>" "$RUN_DIR/compiled/<lens>.md" "<lens>"
```

## 10. Normalize and detect conflicts

```bash
node ./scripts/extract-issues.mjs "$RUN_DIR/normalized/issues.json" "$RUN_DIR/compiled"/*.md
node ./scripts/detect-conflicts.mjs "$RUN_DIR/normalized/issues.json" "$RUN_DIR/normalized/conflict-candidates.json"
```

## 11. Verify findings accuracy

Verify against source before reconciliation. For each finding:

- cited file and symbol exist
- described behavior matches code; not guarded, handled, or outdated
- evidence snippet is real
- in `changes`, finding stays anchored to changed work or direct local impact

Triage by severity:

- verify all high
- spot-check medium
- sample low

Drop failed findings. Update compiled reports. Re-run extract/detect if anything dropped.

If volume is high, dispatch verification subagents per lens. Each gets compiled report + source access. Return verified and dropped finding IDs with one-line reason per drop.

## 12. Reconcile

Orchestrator reads compiled lens reports after verification, `normalized/issues.json`, `normalized/conflict-candidates.json`, `references/reconcile.md`, and `references/output-schema.md`. Write `reconciled-findings.md` in strict schema. Use reconcile subagent only if volume is too high for one pass.

## 13. Check churn

Run cheap churn pass after reconciliation.

Inputs:

- `reconciled-findings.md`
- recent entries from `history.jsonl`
- `references/reconcile.md`

Output:

- `churn-report.md`

Guidance:

- Use cheaper model if available.
- Judge churn risk per reconciled finding: `none` | `weak` | `strong`.
- Match by overlapping paths, symbols, theme, or direction.
- Escalate only `strong` churn conflicts to main reconciler.
- `weak` churn is informational.
- New evidence can justify reversal. Explain why.

## 14. Validate reconciled findings

```bash
node ./scripts/validate-findings.mjs "$RUN_DIR/reconciled-findings.md"
```

## 15. Scaffold and fill remediation plan

```bash
node ./scripts/scaffold-remediation.mjs "$RUN_DIR/remediation-plan.md"
```

Fill plan: group work units, order by deps then severity, cite source finding IDs, explain why units do not conflict, note strong churn warnings, defer unresolved conflicts.

## 16. Append cross-run history

After plan is finalized, append accepted, deferred, rejected, or superseded architectural and refactor decisions to `history.jsonl`.

```bash
node ./scripts/append-history.mjs \
  "$RUN_DIR/history-entries.json" \
  "$ARTIFACT_ROOT/history.jsonl"
```

Append only terse entries useful for future churn checks.

## 17. Split and index

```bash
node ./scripts/split-work-units.mjs "$RUN_DIR/remediation-plan.md" "$RUN_DIR/plans"
node ./scripts/index-work-units.mjs "$RUN_DIR/plans" "$RUN_DIR/plans/index.json"
```

## 18. Final summary

Report:

- scope mode
- target
- effort
- review mode
- active lenses
- active stacks
- top merged findings
- deferred conflicts
- strong churn warnings
- work-unit order
- artifact paths

If `scopeMode=changes`, also report reviewed changed-file count and unchanged files cited as context.

## Ownership

| Step | Owner |
|---|---|
| setup, mode, dispatch, retries | orchestrator |
| section findings | subagents |
| validation, compile, parse, split, index | scripts |
| findings verification | orchestrator or verification subagents |
| conflict resolution | orchestrator or reconcile subagent |
| churn check | cheap verifier subagent or orchestrator |
| history append | orchestrator or script-fed append step |
| remediation plan and summary | orchestrator |

## Guardrails

- Runtime risk > cleanup or simplification
- Over-engineering > hygiene if cleanup adds abstraction or churn
- Hygiene > over-engineering if simplification harms clarity or searchability
- Strong churn warning requires human-visible note, not auto-drop
- Scripts stay deterministic
- Agents stay within declared output paths
