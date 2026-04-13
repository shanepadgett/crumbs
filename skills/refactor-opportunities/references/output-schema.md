# Output Schema

All review files must match this schema. Scripts depend on it.

## 1. Section findings file

One file per section reviewer. No prose between findings. If none, write `None.` under `## Findings`. Summary counts must match. One output file only.

```markdown
# <Lens>: <Section>

## Findings

### <lens>-<section-slug>-<NNN>
- **Severity:** high | medium | low
- **File:** <path>:<line>
- **Symbol:** <type/function/property name or `none`>
- **Pattern:** <criteria check>
- **Finding:** <one line>
- **Evidence:** `<short snippet>`
- **Suggested Direction:** <one line>

## Summary
- High: <N>
- Medium: <N>
- Low: <N>
```

## 2. Reconciled findings file

```markdown
# Reconciled Findings

## Findings

### <canonical-id>
- **Disposition:** merge | keep-separate | defer
- **Primary Lens:** hygiene | over-engineering | runtime | mixed
- **Source Findings:** <id1>, <id2>
- **Severity:** high | medium | low
- **Files:** <path1>, <path2>
- **Symbols:** <symbol1>, <symbol2>
- **Problem:** <one line>
- **Recommended Action:** <one line>
- **Tradeoffs:** <one line>
- **Why This Wins:** <one line>
- **Churn Risk:** none | weak | strong
- **Churn Refs:** <history-id1>, <history-id2> | none

## Summary
- Merged: <N>
- Kept Separate: <N>
- Deferred: <N>
```

`Churn Risk` and `Churn Refs` are required. Use `none` and `none` when no churn signal exists.

## 3. Churn report

```markdown
# Churn Report

## Findings

### <canonical-id>
- **Churn Risk:** none | weak | strong
- **History Refs:** <history-id1>, <history-id2> | none
- **Reason:** <one line>
- **Recommended Handling:** ignore | note-only | escalate

## Summary
- None: <N>
- Weak: <N>
- Strong: <N>
```

## 4. Remediation plan

```markdown
# Refactor Opportunities — Remediation Plan

Generated: <timestamp>

## Work Units

### WU-001
- **Title:** <short title>
- **Priority:** high | medium | low
- **Depends On:** <WU-000> | none
- **Source Findings:** <canonical-id>, <canonical-id>
- **Primary Lens:** hygiene | over-engineering | runtime | mixed
- **Files:** <path1>, <path2>
- **Goal:** <one line>
- **Non-Goals:** <one line>
- **Risks:** <one line>
- **Why Not Conflicting:** <one line>

#### Steps
1. ...

#### Validation
- ...
```

## 5. Run manifest

```json
{
  "runId": "2026-04-12T10-00-00Z",
  "artifactRoot": ".agents/reviews/refactor-opportunities",
  "runDir": ".agents/reviews/refactor-opportunities/runs/2026-04-12T10-00-00Z",
  "historyPath": ".agents/reviews/refactor-opportunities/history.jsonl",
  "scopeMode": "changes",
  "target": ".",
  "mode": "full",
  "effort": "medium",
  "changedFiles": [
    {
      "path": "src/feature/foo.ts",
      "status": "M",
      "staged": false,
      "unstaged": true,
      "renamedFrom": null
    }
  ],
  "reviewedChangedFiles": [
    "src/feature/foo.ts"
  ],
  "excludedFiles": [
    {
      "path": "package-lock.json",
      "reason": "lockfile"
    }
  ],
  "contextRule": "unchanged files are support evidence only",
  "detected": [
    { "stack": "swift-swiftui", "files": 120 }
  ],
  "activeOverlays": [
    "references/languages/swift-swiftui.md"
  ],
  "lenses": {
    "hygiene": ["1-naming", "2-indirection"],
    "over-engineering": ["1-one-use-abstractions"],
    "runtime": ["1-correctness"]
  },
  "paths": {
    "findings": ".agents/reviews/refactor-opportunities/runs/.../findings",
    "compiled": ".agents/reviews/refactor-opportunities/runs/.../compiled",
    "normalized": ".agents/reviews/refactor-opportunities/runs/.../normalized",
    "reconciled": ".agents/reviews/refactor-opportunities/runs/.../reconciled-findings.md",
    "churn": ".agents/reviews/refactor-opportunities/runs/.../churn-report.md",
    "plan": ".agents/reviews/refactor-opportunities/runs/.../remediation-plan.md",
    "plans": ".agents/reviews/refactor-opportunities/runs/.../plans"
  }
}
```

## 6. History entry

One JSON object per line in `history.jsonl`.

```json
{
  "historyId": "hist-2026-04-12T10-00-00Z-001",
  "runId": "2026-04-12T10-00-00Z",
  "timestamp": "2026-04-12T10:00:00Z",
  "scopeMode": "changes",
  "target": ".",
  "findingId": "runtime-correctness-001",
  "findingTitle": "Collapse duplicate retry wrapper",
  "lens": "over-engineering",
  "decision": "accepted",
  "workUnit": "WU-002",
  "paths": ["src/feature/foo.ts"],
  "symbols": ["fetchFoo"],
  "theme": "retry-boundary",
  "direction": "simplify into local helper",
  "rationale": "One use site. Shared layer adds indirection."
}
```
