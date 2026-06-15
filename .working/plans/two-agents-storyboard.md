# Two agents — scrollytelling storyboard

Working script for `.working/demo/two-agents/`. Edit freely; numbers are rough
and get computed exactly from the cost model at build time.

## The task (same prompt, both runs)

> "Customers with saved cards aren't getting payment retries when a charge
> fails. Track down why, fix it, and update the docs."

No failing test exists — the bug shipped because nothing covered it. Both
agents must discover the code, trace the logic, fix it, add a regression test,
and update docs. This keeps the run realistic: search first, read, trace, fix,
verify.

## Repo fiction (synthetic)

- `src/checkout.ts` — 812 lines, checkout orchestration
- `src/payment/gateway.ts` — 640 lines, charge/retry logic
- `src/payment/types.ts` — 210 lines, small file
- `src/checkout.test.ts` — 488 lines
- `docs/payments.md` — 300 lines
- The bug: saved-card charges take a different code path that drops
  `maxRetries`, so retries silently default to 0.

---

## Act 0 — Hero

- **Right:** Title + lede. Two agents, same model, same task, same outcome.
  Only the harness differs. Modeled costs, list pricing, stated assumptions.
- **Stage:** Empty window. System prompt row. Meters: 3,000 tok / ~$0.02.

## Act 1 — The loop (2 beats)

- **Right:** The resend mechanic. A model keeps no memory; every turn
  re-uploads everything before it. Input volume dominates agent bills.
- **Stage:** Teaching device that recurs all run: when a turn happens, a sweep
  ripple over the stack + transient `+N re-sent` flash under the context meter.

## Act 2 — Run 1: the default agent

One beat = one prose paragraph right + one card lands on stage + meters tick.

| #   | Card on stage                    | Tok (rough) | Right column explains                                                                                           |
| --- | -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | User prompt                      | 180         | The ask arrives. Realistic, slightly underspecified, like real tickets.                                         |
| 2   | `bash grep -rn "retry"`          | 3,400       | Discovery. 184 matching lines; a handful matter. Modest as greps go — and all of it re-bills every turn after.  |
| 3   | `read src/checkout.ts`           | 8,200       | Naive read = whole file, all 812 lines, no matter what the agent needed.                                        |
| 4   | `read src/payment/gateway.ts`    | 6,400       | Tracing the charge path. Another whole file.                                                                    |
| 5   | `read src/payment/types.ts`      | 2,100       | Small file, read whole — fine, actually. Seed for the honesty beat in run 2.                                    |
| 6   | `read src/checkout.test.ts`      | 6,100       | Checking existing coverage before writing the regression test.                                                  |
| 7   | `read docs/payments.md`          | 2,800       | The docs it was asked to update.                                                                                |
| 8   | `edit checkout.ts` (quoted)      | ~420 out    | **Showpiece.** Right renders the real `oldText`/`newText` payload — duplicated unchanged lines visible.         |
| 9   | `edit gateway.ts` (quoted)       | ~410 out    | Call 2 — and the entire ~40k context re-uploaded before it. Spend meter lurches.                                |
| 10  | `edit checkout.test.ts` (quoted) | ~430 out    | Call 3: regression test added. Third full re-send.                                                              |
| 11  | `edit docs/payments.md` (quoted) | ~380 out    | Call 4. Four calls for one logical change.                                                                      |
| 12  | `read src/checkout.ts` again     | 8,200       | Repeat read after edit. Default harness stacks the second full file beside the first instead of superseding it. |
| 13  | `bash npx tsc --noEmit`          | 120         | Validation gauntlet begins. Passes, prints almost nothing, still costs a full-context turn.                     |
| 14  | `bash npx markdownlint docs/`    | 600         | Passes with warning noise the agent must carry anyway.                                                          |
| 15  | `bash npx prettier --check .`    | 300         | Another turn, another full re-send.                                                                             |
| 16  | `bash npm test`                  | 24,600      | Full suite. PASS — 4,180-line victory lap that now rides along forever. One useful bit: green.                  |
| 17  | Final answer to user             | ~250 out    | Done. Correct outcome. Nothing here malfunctioned — this is intended default-harness behavior.                  |

- **End-of-run beat:** meters freeze. Final context ≈ 68k, spend ≈ $0.77
  (exact numbers computed at build). Prose: the bill came from the harness,
  not the model.

## Act 3 — The turn

- **Right:** "Same afternoon again. Same model, same bug, same fix. The only
  change is a harness that treats the context window like a budget."
- **Stage:** Run 1 stack collapses into a dim ghost summary pinned left
  (final tokens + spend in baseline gray). Meters reset. Run 2 builds in the
  center beside the ghost. _(Pending decision: ghost column vs full split.)_

## Act 4 — Run 2: the token-conscious agent (teal accents)

The story is not "same agent, fewer tokens." The story is a harness where
every tool call is designed around context.

Run 2 should feel like the agent is still doing normal engineering work, but
the stage keeps reorienting around what is still useful. Search results become
handles after they lead to files. File reads carry content hashes. Later reads
can **supersede** earlier reads of the same file instead of stacking beside
them. Edits mark pre-edit reads **stale**. Passing validators stay silent.
Resolved evidence gets **tombstoned**. The context window is not a chat
transcript; it is a working set.

Lifecycle vocabulary on stage:

- **Capsule:** full bytes live in artifact store; model keeps summary + handle.
- **Superseded:** newer read covers same file/range/hash; older read is struck
  and shrunk because it no longer orients the agent.
- **Stale:** an edit changed the file after a read; old snapshot remains
  retrievable, but the model must not reason from it as current truth.
- **Tombstone:** resolved evidence leaves active context; future re-read gets
  `unchanged since hash ...` or a focused diff, not the old full payload.

The cache story is honest. Most turns hit the prompt cache because the prefix
is stable. A few turns deliberately bust cache because the harness rewrites the
working set. The stage should make that visible as an investment: one turn gets
more expensive, then every later turn gets cheaper and cleaner because the
model is no longer dragging dead evidence around.

| #   | Card / stage event                     | Tok (rough) | Cache state | Stage behavior                                                               | Right column story                                                                                                                                     |
| --- | -------------------------------------- | ----------- | ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | User prompt                            | 180         | cold        | Same ask enters; system prompt appears.                                      | Same bug, same repo. The only thing changing is the harness around the model.                                                                          |
| 2   | Context-aware search                   | 420         | hit         | Search card shows top matches plus a retrieval handle for the rest.          | The search tool is not a dumb text dump. It gives enough evidence to choose the next read, and keeps the long tail retrievable by id.                  |
| 3   | Smart read: `checkout.ts`              | 1,800       | hit         | Card shows outline, matched ranges, and file hash.                           | The read tool returns the parts that orient the agent: symbols, relevant ranges, and a hash that proves what version was read.                         |
| 4   | Ranged read: `gateway.ts`              | 1,500       | hit         | Agent asks for ranges the outline pointed at.                                | The second read is not smaller because of magic. It is smaller because the first tool call gave the agent a map.                                       |
| 5   | Whole read: `types.ts`                 | 2,100       | hit         | Small file comes back whole.                                                 | Honesty beat: a good harness does not try to compress what is already small. The tool is bespoke, not performative.                                    |
| 6   | Smart read: `checkout.test.ts`         | 900         | **miss**    | Search card collapses to capsule stub with handle.                           | The search result has done its job. The harness rewrites it into a capsule. This busts cache once, but the next turns carry a smaller prefix.          |
| 7   | Smart read: `docs/payments.md`         | 700         | hit         | Docs card shows only retry section plus doc hash.                            | The agent has enough context to update the right paragraph without carrying the whole document.                                                        |
| 8   | Grounded patch: 4 files, 1 call        | ~260 out    | **miss**    | Patch lands; edited file reads flip to stale hash stubs.                     | This is the counterexample to quoted edits. The patch is line-anchored against hashes, one round trip. Stale marking prevents reasoning from old code. |
| 9   | Confirm read: `checkout.ts` after edit | 520         | hit         | New hash/diff card **supersedes** stale checkout read.                       | Agents often re-read after edits. The default harness stacks another file read. This harness answers with changed ranges and retires the old snapshot. |
| 10  | Quiet validators                       | 0           | hit         | Validator rail appears outside context; all green means silence.             | Tests, lint, format, and typecheck still run. They just do not pour passing logs into the model. Failures would arrive as focused packets.             |
| 11  | Curation sweep                         | −~4k        | **miss**    | Resolved cards tombstone; superseded/stale stubs drop; working set compacts. | This is the cache-bust beat. The harness pays full price to rewrite the prefix because the next several turns are cheaper, smaller, and safer.         |
| 12  | Final answer                           | ~250 out    | hit         | Clean working set remains; ghost of run 1 stays beside it.                   | Same outcome. The difference is what the model had to carry to get there.                                                                              |

- **End-of-run beat:** 7,090 context, $0.31 modeled spend with three intentional
  cache rewrites. Prose should say: cache hits matter, but only on context worth
  caching. The conscious harness sometimes spends money to rewrite memory so the
  following turns do not keep buying irrelevant state.

## Act 5 — Cache rewrite payoff

Built as a scrolly-driven slider rather than manual input. Stage shows two
lanes:

- keep 120k context with perfect cache hits
- rewrite once to 30k, pay full price once, then cache the smaller prefix

Scroll beats set turns remaining to 3, 5, 12, 30. At 3 turns rewrite can still
be behind. Around turn 5 it breaks even. At 12 and 30 the long tail shows why
cache misses are sometimes worth buying: the miss is one-time, but the smaller
prefix benefits every future turn.

## Act 6 — The bill

1. **Meters morph to comparison:** tokens 68,050 vs 7,090, spend $0.77 vs
   $0.31, round-trips 17 vs 12. Then multiply out on stage: × 6 sessions ×
   2,000 engineers × 220 days → modeled annual gap in big money numerals.
   _(Pending decision: interactive sliders vs static numbers.)_
2. **Honesty close** (prose-heavy, stage quiet): modeled not measured;
   assumptions printed; cache objection answered in two sentences (rewrite
   breaks cache, pays for itself in ~5 turns); solve rate gates everything;
   vendors won't build this because every wasted token is revenue. Closing
   line: pay the model to think, stop paying it to re-read its own inbox.

---

## Open decisions

1. Context-rot: folded into bill close or own beat?
2. Act 3 stage: ghost column (recommended) vs full split-screen.
3. Act 5: interactive calculator (sliders + model toggle, recommended
   simplified) vs static numbers.

## Cost model notes (for build time)

- Opus 4.8 list: $5/M in, $0.50/M cached, $6.25/M cache write, $25/M out.
- Spend meter accumulates per turn: cached prefix + new tokens at write rate +
  output allowance. Same model both runs.
- Default-agent edit turns re-send full context (the 3 extra calls are the
  expensive part, not the quoted text itself).
- All file/log/search sizes synthetic but typical; final numbers recomputed
  in code, prose references kept consistent.
- Run 2 engine shape: step = { adds, muts, cacheMiss? }. Muts transform
  earlier cards (capsule / stale / tombstone) with new token sizes. On a
  mutation turn the rewritten prefix bills at the cache-write rate (miss);
  otherwise prefix bills at the cached rate (hit). Cache readout under the
  meters reflects this per turn in both runs.
