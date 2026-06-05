---
name: nuclear-review
description: Severe git-status-driven review of current changes for maintainability, architecture, and AI-slop risk. Use for ruthless review, nuclear review, pre-merge quality gate, or when local changes may deserve broader refactoring instead of small patch acceptance.
---

# Nuclear Review

Review current git changes as if **current implementation is guilty until structure proves innocent**.

This is a review skill, not an edit skill. Do not change code unless user explicitly asks after review.

## Mission

- Protect repo from AI slop: scattered glue, shallow wrappers, vague types, special-case branches, and fake modularity.
- Ask whether current diff should exist in this shape at all.
- Prefer larger refactor that deletes need for patch over small patch that preserves bad structure.
- Be willing to recommend refactoring whole app sections when current change exposes bad ownership, bad state model, or accumulated design debt.
- Keep recommendations tied to current change or direct blast radius. No random repo cleanup hunt.

Correct behavior is not enough. Passing tests is not enough. If change makes codebase harder to reason about, say so and block it.

## Target Selection

Start from git status.

1. Run `git status --short`.
1. If staged or unstaged changes exist, review all non-deleted changed files, including untracked files.
1. Inspect both staged and unstaged diffs when present:
   - `git diff --name-status`
   - `git diff --cached --name-status`
   - `git diff --stat`
   - `git diff --cached --stat`
1. If working tree is clean, ask user for base/target before reviewing branch diff. Do not guess when branch target is ambiguous.
1. Ignore generated files, vendored files, and lockfiles as primary review targets unless source changes depend on them or their change is suspicious.

Changed files are entry points, not prison walls. Follow direct blast radius when needed: callers, owners, state model, tests, shared helpers, import direction, and nearby conventions.

## Inspection Standard

Before judging architecture, inspect enough context to know local truth.

- Read changed files and surrounding owner modules.
- If changed area depends on domain language or recorded decisions, read nearby `CONTEXT.md` and relevant `docs/adr/` entries before proposing ownership changes.
- Find existing canonical helpers, seams, patterns, and naming before suggesting new ones.
- Check whether logic sits with concept owner or leaks into generic/shared flow.
- Check whether new state, flags, modes, optional fields, casts, or wrappers make callers learn more concepts.
- Check whether tests exercise useful interfaces or only prop up extracted internals.
- Check file growth when files get large or mixed-purpose. Crossing 1000 lines is a presumptive smell, not automatic guilt.

Do not claim wrong layer, missing abstraction, or duplicate helper without evidence from repository structure.

## Nuclear Questions

Ask these for every meaningful change:

- Should this change be solved by reshaping existing module/app section instead of patching around it?
- What concept is current diff fighting?
- Could a better state model delete these conditionals?
- Could moving logic to real owner make feature natural?
- Did this add feature-specific checks to generic code?
- Did this introduce mode flags, nullable state, optional bags, or boolean combinations that encode hidden variants?
- Did this create pass-through helpers, identity wrappers, or abstractions with no leverage?
- Did this duplicate an invariant already owned elsewhere?
- Did this make a cohesive file/module less cohesive?
- Did this make data flow, error flow, ordering, or persistence harder to reason about?
- If we deleted this new layer/helper/branch, would complexity disappear or merely move to callers?

## Deep Module Checks

Use depth as review language when current change adds or exposes shallow structure.

- A module is deep when callers get meaningful behavior behind a small interface.
- Interface means everything caller must know: types, invariants, ordering, error modes, configuration, and performance expectations.
- Shallow modules make caller knowledge nearly as complex as implementation. Pass-through helpers, thin managers, and wrapper-only services are guilty until proven useful.
- Apply deletion test: if deleting module makes complexity vanish, delete it; if deleting it spreads complexity across callers, module probably earns its keep.
- The interface is test surface. Tests should protect behavior through caller-facing seam, not internal extraction details.

## Seam Discipline

- One adapter means hypothetical seam. Two adapters means real seam.
- Do not introduce port/interface/adapter structure unless production vs test substitution, multiple adapters, dependency-direction repair, or ownership boundary needs it now.
- Internal seams may exist inside implementation for clarity or test setup, but do not leak them into external interface unless callers need them.
- Prefer one resolved policy/state/model crossing a seam over repeated feature checks across call sites.

## Block AI-Slop Patterns

Treat these as presumptive blockers when tied to current change:

- Scattered special-case branches across unrelated flows.
- Feature checks leaking into shared/generic modules.
- New flags or modes that force unrelated code to know feature state.
- `any`, broad `unknown`, cast chains, or optional fields hiding real contract.
- Shallow wrappers, manager/service shells, pass-through helpers, or fake seams.
- Duplicate parsing, validation, policy, or state-transition logic.
- Generic magic that hides simple domain shape.
- “Temporary” branches likely to become permanent debt.
- Large-file growth that mixes distinct ownership or makes navigation worse.
- Sequential orchestration or partial updates that make consistency/error handling harder when simpler structure is obvious.
- Tests coupled to internals while public behavior seam stays unprotected.
- Single-adapter ports or interfaces that create ceremony without real variation.

Presume blocker does not mean automatic blocker. Waive only with concrete repo evidence and explain why.

## Remedy Hierarchy

Prefer fixes in this order:

1. Delete unnecessary concept, branch, helper, wrapper, mode, or layer.
1. Simplify state model so invalid combinations disappear.
1. Move behavior to module that already owns concept.
1. Reuse canonical helper or existing seam.
1. Extract cohesive helper/module when it improves locality.
1. Add new abstraction/seam only when current change needs multiple adapters, test substitution, dependency-direction repair, or clear ownership boundary.

Do not recommend abstraction by reflex. Nuclear review should delete complexity before organizing it.

## Finding Standard

Every finding must include:

- **Evidence**: exact file/path and concrete code behavior. Line numbers when available.
- **Impact**: why maintainability, architecture, or future change gets worse.
- **Nuclear fix**: concrete better shape, including what moves/deletes/collapses.
- **Fallback**: smaller acceptable fix only when nuclear fix is risky or too large for current change.

Bad finding: “Consider cleaning this up.”

Good finding: “`src/foo.ts` adds another feature branch to generic request routing. Move feature selection into `FeaturePolicy` and make router consume one resolved policy so three branches disappear.”

## Severity

- **Blocker**: should not merge in current shape; structure regression, wrong ownership, hidden state contract, or AI-slop pattern with clear better path.
- **Major**: significant maintainability issue worth fixing before/near merge, but not clearly merge-blocking.
- **Minor**: local readability issue; include only when no larger issue dominates.
- **Follow-up**: real improvement outside current change blast radius; keep short.

Do not flood review with nits. Inspect thoroughly, report high-conviction issues.

## Output

Start with verdict:

- `BLOCK` — structural issue should be fixed before merge.
- `CHANGES REQUESTED` — important maintainability fixes needed.
- `PASS WITH CONCERNS` — acceptable now, but important follow-up exists.
- `PASS` — no meaningful structural regression found.

Then output findings in priority order:

```markdown
## Verdict: BLOCK

### Blockers

1. **Finding title** — `path/to/file.ts:123`
   - Evidence: ...
   - Impact: ...
   - Nuclear fix: ...
   - Fallback: ...

### Major

...

### Follow-up

...
```

If no findings, say what you inspected and why structure is acceptable. Do not say “looks good” without evidence.

## Tone

Be direct and demanding. Do not be rude. Do not soften structural damage into preference language.

Use phrases like:

- “This works, but it hardens the wrong shape.”
- “This is AI-slop glue: it adds feature knowledge to code that should not know this feature exists.”
- “This patch should probably disappear behind a state-model refactor.”
- “This abstraction does not earn its keep; delete it and keep direct flow.”
- “This needs a nuclear fix, not another branch.”

Avoid vague words like “nice”, “cleaner”, “maybe”, “consider”, and “could possibly”. If confidence is low, inspect more or mark uncertainty explicitly.
