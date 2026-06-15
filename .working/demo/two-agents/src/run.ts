/**
 * Session data + cost model. One source of truth: stage cards, meter values,
 * and prose numbers all derive from here.
 */

export type CardStatus = "capsule" | "stale" | "superseded" | "tombstone" | "validator";

export type Card =
  | { id: string; kind: "user"; text: string; tok: number; lean?: boolean }
  | { id: string; kind: "assistant"; text: string; tok: number; out?: number; lean?: boolean }
  | {
      id: string;
      kind: "tool";
      call: string;
      result: string;
      tok: number;
      out?: number;
      lean?: boolean;
      status?: CardStatus;
    };

/* Claude Opus 4.8 list pricing, $ per 1M tokens */
const M = 1e6;
const PRICE = { cachedIn: 0.5, cacheWrite: 6.25, out: 25 };
const OUT_ALLOWANCE = 150; // output tokens per turn, both agents

export const SYS_TOK = 3000;

/* ---------- run 1: the default agent ---------- */
export const RUN1: Card[] = [
  {
    id: "u1",
    kind: "user",
    text: "Customers with saved cards aren't getting payment retries when a charge fails. Track down why, fix it, and update the docs.",
    tok: 180,
  },
  {
    id: "g1",
    kind: "tool",
    call: 'bash  grep -rn "retry" src/',
    result: "184 matching lines across 41 files — all returned",
    tok: 3400,
  },
  {
    id: "r1",
    kind: "tool",
    call: "read  src/checkout.ts",
    result: "812 lines — entire file loaded into context",
    tok: 8200,
  },
  {
    id: "r2",
    kind: "tool",
    call: "read  src/payment/gateway.ts",
    result: "640 lines — entire file",
    tok: 6400,
  },
  {
    id: "r3",
    kind: "tool",
    call: "read  src/payment/types.ts",
    result: "210 lines — entire file",
    tok: 2100,
  },
  {
    id: "r4",
    kind: "tool",
    call: "read  src/checkout.test.ts",
    result: "488 lines — checking existing coverage",
    tok: 6100,
  },
  {
    id: "r5",
    kind: "tool",
    call: "read  docs/payments.md",
    result: "300 lines — retry docs loaded for update",
    tok: 2800,
  },
  {
    id: "e1",
    kind: "tool",
    call: "edit  src/checkout.ts",
    result: "quoted oldText/newText; maxRetries now passed to retry path",
    tok: 460,
    out: 460,
  },
  {
    id: "e2",
    kind: "tool",
    call: "edit  src/payment/gateway.ts",
    result: "saved-card charge path accepts retry options",
    tok: 450,
    out: 450,
  },
  {
    id: "e3",
    kind: "tool",
    call: "edit  src/checkout.test.ts",
    result: "regression test covers saved-card retry failure",
    tok: 470,
    out: 470,
  },
  {
    id: "e4",
    kind: "tool",
    call: "edit  docs/payments.md",
    result: "docs now describe saved-card retry behavior",
    tok: 420,
    out: 420,
  },
  {
    id: "r6",
    kind: "tool",
    call: "read  src/checkout.ts",
    result: "812 lines — second full copy; first copy still in context",
    tok: 8200,
  },
  {
    id: "v1",
    kind: "tool",
    call: "bunx tsc --noEmit",
    result: "passes; minimal output",
    tok: 120,
  },
  {
    id: "v2",
    kind: "tool",
    call: "markdownlint docs/payments.md",
    result: "passes with unrelated warning chatter",
    tok: 600,
  },
  {
    id: "v3",
    kind: "tool",
    call: "prettier --check .",
    result: "all matched files use prettier formatting",
    tok: 300,
  },
  {
    id: "v4",
    kind: "tool",
    call: "npm test",
    result: "214 passing tests; 4,180-line success log",
    tok: 24600,
  },
  {
    id: "a1",
    kind: "assistant",
    text: "Fixed the saved-card retry path, added regression coverage, updated the payment docs, and validated with typecheck, lint, format, and the full test suite.",
    tok: 250,
    out: 250,
  },
];

export type Run2Step = {
  cards: Card[];
  cache: "cold" | "hit" | "miss";
  out?: number;
};

const user2: Card = {
  id: "u2",
  kind: "user",
  lean: true,
  text: "Customers with saved cards aren't getting payment retries when a charge fails. Track down why, fix it, and update the docs.",
  tok: 180,
};

const searchFull: Card = {
  id: "s2",
  kind: "tool",
  lean: true,
  call: 'search  "saved card retry"',
  result: "top matches returned; long tail stored as artifact search_a71",
  tok: 420,
};
const searchCapsule: Card = {
  ...searchFull,
  result: "capsule: useful hits + handle search_a71",
  tok: 120,
  status: "capsule",
};
const searchTombstone: Card = {
  ...searchFull,
  result: "tombstone: search led to reads; artifact retained",
  tok: 60,
  status: "tombstone",
};

const checkoutRead: Card = {
  id: "c2",
  kind: "tool",
  lean: true,
  call: "read.smart  src/checkout.ts",
  result: "outline + retry ranges + hash chk_92fd",
  tok: 1800,
};
const checkoutStale: Card = {
  ...checkoutRead,
  result: "stale after patch; original hash chk_92fd retained",
  tok: 90,
  status: "stale",
};
const checkoutSuperseded: Card = {
  ...checkoutRead,
  result: "superseded by post-edit read; artifact retained",
  tok: 60,
  status: "superseded",
};

const gatewayRead: Card = {
  id: "g2",
  kind: "tool",
  lean: true,
  call: "read.range  src/payment/gateway.ts:112-220",
  result: "charge path ranges + hash pay_41ac",
  tok: 1500,
};
const gatewayStale: Card = {
  ...gatewayRead,
  result: "stale after patch; original hash pay_41ac retained",
  tok: 90,
  status: "stale",
};
const gatewayTombstone: Card = {
  ...gatewayRead,
  result: "tombstone: no longer active evidence",
  tok: 60,
  status: "tombstone",
};

const typesRead: Card = {
  id: "t2",
  kind: "tool",
  lean: true,
  call: "read  src/payment/types.ts",
  result: "210 lines — small file returned whole",
  tok: 2100,
};
const testRead: Card = {
  id: "x2",
  kind: "tool",
  lean: true,
  call: "read.smart  src/checkout.test.ts",
  result: "outline + saved-card describe block + hash tst_80bf",
  tok: 900,
};
const testCapsule: Card = {
  ...testRead,
  result: "capsule: relevant describe block + handle tst_80bf",
  tok: 300,
  status: "capsule",
};
const docsRead: Card = {
  id: "d2",
  kind: "tool",
  lean: true,
  call: "read.smart  docs/payments.md",
  result: "retry section only + hash doc_7c12",
  tok: 700,
};
const docsCapsule: Card = {
  ...docsRead,
  result: "capsule: updated retry section + handle doc_7c12",
  tok: 300,
  status: "capsule",
};
const patch2: Card = {
  id: "p2",
  kind: "tool",
  lean: true,
  call: "patch.grounded  4 files",
  result: "line-anchored patch against hashes; one round trip",
  tok: 260,
  out: 260,
};
const confirm2: Card = {
  id: "q2",
  kind: "tool",
  lean: true,
  call: "read.diff  src/checkout.ts",
  result: "changed ranges only; new hash chk_b4e1",
  tok: 520,
};
const validators2: Card = {
  id: "v2q",
  kind: "tool",
  lean: true,
  status: "validator",
  call: "quiet validators",
  result: "typecheck, lint, format, tests all green; no logs enter context",
  tok: 0,
};
const sweep2: Card = {
  id: "sweep2",
  kind: "tool",
  lean: true,
  status: "tombstone",
  call: "harness.curation_sweep",
  result: "resolved, stale, and superseded context tombstoned",
  tok: 0,
};
const answer2: Card = {
  id: "a2",
  kind: "assistant",
  lean: true,
  text: "Fixed the saved-card retry path, added regression coverage, updated the docs, and validated through quiet validators. Full artifacts remain retrievable by handle.",
  tok: 250,
  out: 250,
};

export const RUN2_STEPS: Run2Step[] = [
  { cache: "cold", cards: [user2] },
  { cache: "hit", cards: [user2, searchFull] },
  { cache: "hit", cards: [user2, searchFull, checkoutRead] },
  { cache: "hit", cards: [user2, searchFull, checkoutRead, gatewayRead] },
  { cache: "hit", cards: [user2, searchFull, checkoutRead, gatewayRead, typesRead] },
  { cache: "miss", cards: [user2, searchCapsule, checkoutRead, gatewayRead, typesRead, testRead] },
  {
    cache: "hit",
    cards: [user2, searchCapsule, checkoutRead, gatewayRead, typesRead, testRead, docsRead],
  },
  {
    cache: "miss",
    cards: [
      user2,
      searchCapsule,
      checkoutStale,
      gatewayStale,
      typesRead,
      testRead,
      docsRead,
      patch2,
    ],
    out: 260,
  },
  {
    cache: "hit",
    cards: [
      user2,
      searchCapsule,
      checkoutSuperseded,
      gatewayStale,
      typesRead,
      testRead,
      docsRead,
      patch2,
      confirm2,
    ],
  },
  {
    cache: "hit",
    cards: [
      user2,
      searchCapsule,
      checkoutSuperseded,
      gatewayStale,
      typesRead,
      testRead,
      docsRead,
      patch2,
      confirm2,
      validators2,
    ],
  },
  {
    cache: "miss",
    cards: [
      user2,
      searchTombstone,
      checkoutSuperseded,
      gatewayTombstone,
      typesRead,
      testCapsule,
      docsCapsule,
      patch2,
      confirm2,
      validators2,
      sweep2,
    ],
  },
  {
    cache: "hit",
    cards: [
      user2,
      searchTombstone,
      checkoutSuperseded,
      gatewayTombstone,
      typesRead,
      testCapsule,
      docsCapsule,
      patch2,
      confirm2,
      validators2,
      sweep2,
      answer2,
    ],
    out: 250,
  },
];

export const RUN1_FINAL = tally(RUN1, RUN1.length);

export function tally(cards: Card[], upto: number) {
  let ctx = 0;
  let spend = 0;
  let resent = 0;
  for (let i = 0; i < upto && i < cards.length; i++) {
    const c = cards[i];
    const out = ("out" in c ? c.out : undefined) ?? OUT_ALLOWANCE;
    const added = c.tok + (i === 0 ? SYS_TOK : 0);
    resent = ctx;
    spend += (ctx / M) * PRICE.cachedIn + (added / M) * PRICE.cacheWrite + (out / M) * PRICE.out;
    ctx += added;
  }
  return { ctx, spend, resent, cache: "hit" as const };
}

export function tallyRun2(upto: number) {
  let prevCtx = 0;
  let spend = 0;
  let resent = 0;
  let cache: Run2Step["cache"] = "cold";
  for (let i = 0; i < upto && i < RUN2_STEPS.length; i++) {
    const step = RUN2_STEPS[i];
    const ctx = SYS_TOK + step.cards.reduce((sum, c) => sum + c.tok, 0);
    const grewBy = Math.max(0, ctx - prevCtx);
    const out = step.out ?? OUT_ALLOWANCE;
    cache = step.cache;
    resent = cache === "miss" ? 0 : prevCtx;
    const prefixRate = cache === "hit" ? PRICE.cachedIn : PRICE.cacheWrite;
    spend += (prevCtx / M) * prefixRate + (grewBy / M) * PRICE.cacheWrite + (out / M) * PRICE.out;
    prevCtx = ctx;
  }
  return { ctx: prevCtx, spend, resent, cache };
}

export function run2Cards(upto: number) {
  return RUN2_STEPS[Math.min(Math.max(upto, 1), RUN2_STEPS.length) - 1]?.cards ?? [];
}
