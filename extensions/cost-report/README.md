# Cost Report Extension

Generates static HTML cost reports from Pi session files.

## Surface

Run `/cost-report` in Pi:

```text
/cost-report month
/cost-report week project
/cost-report 2026-06-01..2026-06-15 open
/cost-report today private
```

Reports are written outside the repository under `~/.pi/agent/reports/cost-report/`.

## How it works

The extension reads Pi JSONL sessions, totals assistant message `usage` and `usage.cost`, groups spend by day/model/session, and renders a standalone HTML report with native accordions for session detail. Costs come from Pi's stored model pricing estimates; no provider billing APIs are queried.
