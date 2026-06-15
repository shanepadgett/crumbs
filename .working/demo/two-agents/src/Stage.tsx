import { useEffect, useRef, useState } from "react";
import { type Card, RUN1, RUN1_FINAL, SYS_TOK, run2Cards, tally, tallyRun2 } from "./run";

/**
 * The stage: persistent agent-run UI in the left pane.
 * Meters pinned top-center; transcript cards animate into a centered column.
 * State = { phase, upto }: how much of the run is visible.
 */
export type StageState =
  | { phase: "hero" }
  | { phase: "loop" }
  | { phase: "run1"; upto: number }
  | { phase: "turn" }
  | { phase: "run2"; upto: number }
  | { phase: "payoff"; turns: number }
  | { phase: "sawtooth" }
  | { phase: "business" };

function useCountUp(target: number, ms = 700) {
  const [val, setVal] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const begin = from.current;
    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setVal(begin + (target - begin) * (1 - (1 - t) ** 3));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

function Meter({
  label,
  value,
  format,
  money,
  idle,
}: {
  label: string;
  value: number;
  format: "tok" | "usd" | "pct";
  money?: boolean;
  idle?: boolean;
}) {
  const v = useCountUp(value);
  const text = idle
    ? "\u2014"
    : format === "usd"
      ? `$${v.toFixed(2)}`
      : format === "pct"
        ? `${v.toFixed(1)}%`
        : Math.round(v).toLocaleString();
  return (
    <div className="meter-unit text-center">
      <div
        className={`font-mono font-semibold tracking-tight text-[clamp(32px,3vw,52px)] leading-none ${
          money ? "text-money" : "text-ink"
        }`}
      >
        {text}
      </div>
      <div className="font-sans text-[12.5px] text-faint mt-2 max-w-[22ch] mx-auto leading-snug">
        {label}
      </div>
    </div>
  );
}

function TranscriptCard({ c, delay = 0 }: { c: Card; delay?: number }) {
  const statusClass =
    c.kind === "tool" && c.status
      ? {
          capsule: "border-conscious-dim/80 bg-conscious-dim/25",
          stale: "opacity-55 border-money/35 bg-panel line-through decoration-money/60",
          superseded: "opacity-55 border-baseline-dim bg-panel line-through decoration-baseline",
          tombstone: "opacity-45 border-dashed border-baseline-dim bg-transparent",
          validator: "border-conscious-dim bg-transparent",
        }[c.status]
      : "";
  return (
    <div
      className={`stage-block shrink-0 rounded-md border border-hairline bg-panel px-5 ${statusClass} ${
        c.kind === "tool" ? "py-3" : "py-3.5"
      }`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {c.kind === "user" ? (
        <>
          <div className="font-sans text-[12px] text-faint mb-1.5">User</div>
          <div className="font-serif text-[15.5px] leading-relaxed text-ink">{c.text}</div>
        </>
      ) : c.kind === "assistant" ? (
        <>
          <div className="font-sans text-[12px] text-faint mb-1.5">Agent</div>
          <div className="font-serif text-[14.5px] leading-relaxed text-ink-2">{c.text}</div>
        </>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-6">
            <span className={`font-mono text-[13.5px] ${c.lean ? "text-conscious" : "text-ink"}`}>
              {c.call}
            </span>
            <span className="font-mono text-[12px] text-faint shrink-0">
              {c.tok.toLocaleString()} tok
            </span>
          </div>
          <div className="font-sans text-[13px] text-ink-2 mt-1.5">
            {c.status && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-conscious mr-2">
                {c.status}
              </span>
            )}
            {c.result}
          </div>
        </>
      )}
    </div>
  );
}

function Run1Ghost({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-md border border-baseline-dim/70 bg-baseline-dim/20 px-4 py-4 font-sans text-baseline ${
        compact ? "w-[132px] shrink-0" : "w-full max-w-[360px] mx-auto mt-[18vh]"
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.16em] text-faint">run 1</div>
      <div className="font-mono text-[22px] text-ink mt-2">{RUN1_FINAL.ctx.toLocaleString()}</div>
      <div className="text-[12px] text-faint">tokens on final turn</div>
      <div className="font-mono text-[20px] text-money mt-4">${RUN1_FINAL.spend.toFixed(2)}</div>
      <div className="text-[12px] text-faint">modeled session spend</div>
    </div>
  );
}

function ResendLoopModel() {
  const chunksK = [6, 3, 8, 5, 7, 4, 9, 3, 6, 5];
  const turns = chunksK.map((_, i) => i + 1);
  return (
    <div className="loop-model relative w-full max-w-[980px] mx-auto h-full min-h-0">
      <div className="absolute inset-x-0 top-[47%] -translate-y-1/2 flex flex-col gap-[1.35vh]">
        {turns.map((turn) => (
          <div
            key={turn}
            className="loop-model-row grid grid-cols-[68px_1fr_150px] items-center gap-5"
            style={{ animationDelay: `${(turn - 1) * 1050}ms` }}
          >
            <span className="font-mono text-[13px] text-faint">turn {turn}</span>
            <span className="grid grid-cols-10 gap-1.5 h-[clamp(26px,3.6vh,46px)]">
              {chunksK.map((chunk, cellIndex) => {
                const cell = cellIndex + 1;
                return (
                  <span
                    key={cell}
                    className={`loop-model-cell rounded-sm font-mono text-[10px] leading-none flex items-center justify-center ${
                      cell > turn ? "bg-transparent" : cell === turn ? "bg-ink" : "bg-baseline-dim"
                    }`}
                  >
                    {cell <= turn ? `${cell === turn ? "+" : ""}${chunk}k` : ""}
                  </span>
                );
              })}
            </span>
            <span className="font-mono leading-none text-right">
              <span className="block text-[17px] text-ink-2">
                {chunksK.slice(0, turn).reduce((sum, n) => sum + n, 0)}k sent
              </span>
              <span className="block text-[11px] text-faint mt-1.5">
                {chunksK.slice(0, turn - 1).reduce((sum, n) => sum + n, 0)}k hit ·{" "}
                {chunksK[turn - 1]}k new
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-9 font-sans text-[15px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="block h-4 w-4 rounded-sm bg-ink" /> new this turn
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="block h-4 w-4 rounded-sm bg-baseline-dim" /> cache-hit prefix re-sent
        </span>
      </div>
    </div>
  );
}

function PayoffModel({ turns }: { turns: number }) {
  const bigCtx = 120_000;
  const smallCtx = 30_000;
  const cachedRate = 0.5;
  const writeRate = 6.25;
  const keep = (turns * bigCtx * cachedRate) / 1_000_000;
  const rewrite = (smallCtx * writeRate + turns * smallCtx * cachedRate) / 1_000_000;
  const max = (30 * bigCtx * cachedRate) / 1_000_000;
  const delta = keep - rewrite;
  const breakEven = 5;
  const ticks = Array.from({ length: 30 }, (_, i) => i + 1);

  return (
    <div className="payoff-model h-full w-full max-w-[980px] mx-auto flex flex-col justify-center pb-12">
      <div className="grid grid-cols-[1fr_auto] gap-8 items-end mb-[6vh]">
        <div>
          <div className="font-sans text-[13px] uppercase tracking-[0.18em] text-faint mb-3">
            turns left after rewrite
          </div>
          <div className="font-mono text-[clamp(64px,9vw,132px)] leading-none text-ink">
            {turns}
          </div>
        </div>
        <div className="text-right font-sans pb-3">
          <div className={`font-mono text-[30px] ${delta >= 0 ? "text-conscious" : "text-money"}`}>
            {delta >= 0 ? `+$${delta.toFixed(2)}` : `-$${Math.abs(delta).toFixed(2)}`}
          </div>
          <div className="text-[13px] text-faint">
            {delta >= 0 ? "rewrite is ahead" : "rewrite is still behind"}
          </div>
        </div>
      </div>

      <div className="space-y-7">
        <div>
          <div className="flex justify-between font-sans text-[14px] text-baseline mb-2">
            <span>keep 120k, perfect cache hits</span>
            <span className="font-mono text-ink-2">${keep.toFixed(2)}</span>
          </div>
          <div className="h-[34px] rounded-sm bg-baseline-dim/45 overflow-hidden">
            <div
              className="h-full bg-baseline transition-[width] duration-700 ease-out"
              style={{ width: `${(keep / max) * 100}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between font-sans text-[14px] text-conscious mb-2">
            <span>rewrite to 30k, eat one full-price turn</span>
            <span className="font-mono text-ink-2">${rewrite.toFixed(2)}</span>
          </div>
          <div className="h-[34px] rounded-sm bg-conscious-dim/60 overflow-hidden relative">
            <div
              className="h-full bg-conscious transition-[width] duration-700 ease-out"
              style={{ width: `${(rewrite / max) * 100}%` }}
            />
            <div
              className="absolute left-0 top-0 h-full bg-money/85 transition-[width] duration-700 ease-out"
              style={{ width: `${((smallCtx * writeRate) / 1_000_000 / max) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="relative mt-[6vh]">
        <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(30, minmax(0, 1fr))" }}>
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`h-10 rounded-sm transition-colors duration-500 ${
                tick <= turns ? "bg-conscious-dim" : "bg-baseline-dim/35"
              } ${tick === breakEven ? "ring-1 ring-money" : ""}`}
            />
          ))}
        </div>
        <div
          className="absolute -top-7 font-mono text-[12px] text-money"
          style={{ left: `${((breakEven - 1) / 29) * 100}%` }}
        >
          pays off ~turn 5
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-8 font-sans text-[14px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="block h-4 w-4 rounded-sm bg-money" /> one cache-busting rewrite
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="block h-4 w-4 rounded-sm bg-conscious" /> smaller cached prefix afterward
        </span>
      </div>
    </div>
  );
}

function SawtoothModel() {
  const base =
    "M70 58 C165 82 238 136 300 218 L314 232 L314 106 C396 128 468 176 540 224 L554 238 L554 116 C640 136 725 178 830 226";
  const lean = "M70 76 C230 90 390 94 550 88 C680 82 760 78 830 80";
  return (
    <div className="h-full w-full max-w-[980px] mx-auto flex flex-col justify-center">
      <svg viewBox="0 0 900 300" className="w-full h-[48vh] overflow-visible">
        <defs>
          <linearGradient id="qualityFade" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-baseline)" stopOpacity="0.95" />
            <stop offset="1" stopColor="var(--color-money)" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <line x1="70" y1="250" x2="840" y2="250" stroke="var(--color-hairline)" />
        <line x1="70" y1="42" x2="70" y2="250" stroke="var(--color-hairline)" />
        <text x="70" y="28" fill="var(--color-faint)" fontSize="13" fontFamily="var(--font-sans)">
          effective quality
        </text>
        <text x="760" y="278" fill="var(--color-faint)" fontSize="13" fontFamily="var(--font-sans)">
          session time
        </text>
        <path
          d={base}
          fill="none"
          stroke="url(#qualityFade)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d={lean}
          fill="none"
          stroke="var(--color-conscious)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        {[300, 540].map((x) => (
          <g key={x}>
            <line
              x1={x}
              y1="88"
              x2={x}
              y2="248"
              stroke="var(--color-money)"
              strokeDasharray="5 7"
              opacity="0.7"
            />
            <text
              x={x + 12}
              y="104"
              fill="var(--color-money)"
              fontSize="13"
              fontFamily="var(--font-mono)"
            >
              forced compaction
            </text>
          </g>
        ))}
        <text
          x="118"
          y="204"
          fill="var(--color-baseline)"
          fontSize="15"
          fontFamily="var(--font-sans)"
        >
          full window, then lossy summary
        </text>
        <text
          x="570"
          y="74"
          fill="var(--color-conscious)"
          fontSize="15"
          fontFamily="var(--font-sans)"
        >
          curated working set
        </text>
      </svg>
      <div className="grid grid-cols-2 gap-8 font-sans text-[14px] text-ink-2">
        <p>
          Default harnesses let context fill, then compact. That drop is where agents forget
          evidence and spend turns re-reading.
        </p>
        <p>
          A curated harness avoids the cliff. If it must compact, it writes a structured dossier
          with artifact handles, not a vague memory of the afternoon.
        </p>
      </div>
    </div>
  );
}

function BusinessModel() {
  const rows = [
    { model: "GPT-5.5", base: "$10.0M", lean: "$4.8M", save: "$5.2M" },
    { model: "Opus 4.8", base: "$10.5M", lean: "$5.3M", save: "$5.3M" },
    { model: "Fable 5", base: "$21.0M", lean: "$10.5M", save: "$10.5M" },
  ];
  return (
    <div className="h-full w-full max-w-[900px] mx-auto flex flex-col justify-center font-sans">
      <div className="mb-8">
        <div className="font-mono text-[clamp(46px,6.2vw,88px)] leading-none text-ink">1,800</div>
        <div className="text-faint text-[15px] mt-2">
          engineers · 6 sessions/day · 220 workdays · modeled from published list pricing
        </div>
      </div>
      <div className="border-y border-hairline divide-y divide-hairline">
        <div className="grid grid-cols-[1fr_1fr_1fr_1fr] py-3 text-[12px] uppercase tracking-[0.14em] text-faint">
          <span>model</span>
          <span>default</span>
          <span>conscious</span>
          <span>gap</span>
        </div>
        {rows.map((r) => (
          <div key={r.model} className="grid grid-cols-[1fr_1fr_1fr_1fr] py-5 items-baseline">
            <span className="text-ink text-[18px]">{r.model}</span>
            <span className="font-mono text-[24px] text-baseline">{r.base}</span>
            <span className="font-mono text-[24px] text-conscious">{r.lean}</span>
            <span className="font-mono text-[28px] text-money">{r.save}</span>
          </div>
        ))}
      </div>
      <p className="mt-8 text-[14px] leading-relaxed text-ink-2 max-w-[720px]">
        Assumes 40-turn sessions, perfect cache hits for the default harness, and no rework penalty
        from compaction. Read the gap as a floor, not a victory lap.
      </p>
    </div>
  );
}

export default function Stage({ state }: { state: StageState }) {
  const upto = state.phase === "run1" || state.phase === "run2" ? state.upto : 0;
  const isRun2 = state.phase === "run2";
  const cards = isRun2 ? run2Cards(upto) : RUN1.slice(0, upto);
  const metrics = isRun2 ? tallyRun2(upto) : tally(RUN1, upto);
  const { ctx, spend, resent } = metrics;

  /* Stagger entry animation for cards added in the same step. */
  const prevUpto = useRef(upto);
  const firstNew = prevUpto.current < upto ? prevUpto.current : upto;
  useEffect(() => {
    prevUpto.current = upto;
  }, [upto]);

  /* Keep the newest card in view as the stack outgrows the pane. */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [upto]);

  /* Cached prefix share of current context. The newly added card is not cached yet. */
  const started = (state.phase === "run1" || state.phase === "run2") && upto > 0;
  const cachePct = started && metrics.cache !== "miss" ? (resent / ctx) * 100 : 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {started && (
        <div className="meter-pane border-b border-hairline">
          <div className="flex justify-center gap-[4.5vw] px-[4.5vw] py-[3vh]">
            <Meter label="context tokens — re-sent every turn" value={ctx} format="tok" />
            <Meter
              label="cached prefix share — new tokens are full price"
              value={cachePct}
              format="pct"
            />
            <Meter label="session spend" value={spend} format="usd" money />
          </div>
        </div>
      )}

      <div
        className={`flex-1 min-h-0 ${started ? "px-[4.5vw] pt-[4vh] pb-10" : "px-[3vw] py-[5vh]"}`}
      >
        {state.phase === "loop" && <ResendLoopModel />}
        {state.phase === "turn" && <Run1Ghost />}
        {state.phase === "payoff" && <PayoffModel turns={state.turns} />}
        {state.phase === "sawtooth" && <SawtoothModel />}
        {state.phase === "business" && <BusinessModel />}

        {started ? (
          <div
            className={`w-full mx-auto h-full min-h-0 ${
              isRun2 ? "max-w-[900px] grid grid-cols-[132px_1fr] gap-4" : "max-w-[760px]"
            }`}
          >
            {isRun2 && (
              <div className="pt-1">
                <Run1Ghost compact />
              </div>
            )}
            <div
              ref={listRef}
              className={`transcript-scroll relative overflow-hidden h-full min-h-0 flex flex-col gap-2 ${
                isRun2 ? "min-w-0" : ""
              }`}
            >
              <div className="stage-block shrink-0 rounded-md border border-hairline px-5 py-3 font-sans text-[12.5px] text-faint flex justify-between">
                <span>system prompt + tool schemas</span>
                <span className="font-mono text-[12px]">{SYS_TOK.toLocaleString()} tok</span>
              </div>
              {cards.map((c, i) => (
                <TranscriptCard key={c.id} c={c} delay={i >= firstNew ? (i - firstNew) * 130 : 0} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
