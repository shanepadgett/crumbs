# Reconcile Rules

After all findings are compiled and normalized.

## Priority

1. runtime risk
2. over-engineering simplification
3. hygiene clarity/searchability

## Rules

- Runtime > cleanup if cleanup adds crash, state, concurrency, or resilience risk
- Over-engineering > hygiene if hygiene adds abstraction, files, or ceremony with weak payoff
- Hygiene > over-engineering if simplification harms search, trace, or modify
- Same problem + same remedy -> merge
- Same problem + opposite remedy -> defer unless priority rule clearly wins
- Same file but different problems -> keep separate
- Prefer local simplification over framework-level structure
- Prefer deleting weak abstractions over renaming them
- Prefer explicit ownership over clever indirection
- Cross-run history is advisory, not law
- Strong churn signal requires explicit note in reconciliation
- Reverse prior accepted direction only with stronger current evidence
- Same area changing direction across recent runs is churn risk
- Churn overlap means same paths, same symbols, same theme, or same architectural direction

## Triage conflict candidates

Dismiss quickly when:

- Same file but different symbols, patterns, and code regions — independent findings sharing a file
- "similar language" reason with no structural signal (not same file/symbol/opposite direction) — coincidental wording
- Same lens, same pattern, unrelated code — pattern shared, instances not

Focus only on candidates where remedies touch same code or one remedy blocks/undoes another.

## Merge hints

- Same `File` + same `Symbol`
- Same `File` + similar `Pattern`
- Similar `Suggested Direction`
- One says remove layer, another says rename/modernize same layer
- Runtime finding blocks simplification of same code path

## Deferral cases

- Large refactor mixes persistence-contract and structure changes
- Simplification erases needed seam but evidence is weak
- Hygiene and over-engineering both valid, no clear winner
- Runtime evidence plausible but static evidence too weak to force change
- Current recommendation directly reverses recent accepted direction with weak new evidence
- Same area has repeated direction changes across recent runs with no stronger proof

## Churn triage

Use recent `history.jsonl` entries to classify churn risk:

- `none`: no overlapping prior direction or reversal is clearly justified
- `weak`: overlap exists, but prior decision is old, narrow, or only loosely related
- `strong`: same area or theme, opposite direction, recent prior decision, weak new justification

Escalate `strong` churn to reconciler. Mention `weak` churn only as context.

## Output

Every reconciled item: why chosen action wins, why it won't fight adjacent work.

If churn exists: state overlap, prior direction, current direction, and why reversal is or is not justified.
