import type {
  CostReport,
  ModelAggregate,
  SessionSummary,
  TimeAggregate,
  TurnSummary,
} from "./types.js";

const CURRENCY = new Intl.NumberFormat(undefined, {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const INTEGER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" });

// Category palette assigned to models in cost order; reused for dots, bars, chart series.
const PALETTE = [
  "#8b7bff",
  "#4ade80",
  "#f5a623",
  "#38bdf8",
  "#ff6b9d",
  "#facc15",
  "#34d399",
  "#fb7185",
  "#c084fc",
  "#22d3ee",
];
const FALLBACK_COLOR = "#5b6170";

type ModelColors = Map<string, string>;

export function renderCostReportHtml(report: CostReport): string {
  const modelColors: ModelColors = new Map(
    report.models.map((model, index) => [model.key, PALETTE[index % PALETTE.length]!]),
  );
  const periodView = periodViewFor(report);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pi cost report · ${escapeHtml(report.range.label)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="glow glow-a" aria-hidden="true"></div>
  <div class="glow glow-b" aria-hidden="true"></div>
  <main class="shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <span class="brand-text"><strong>Pi</strong><span>Cost report</span></span>
      </div>
      ${renderRangeTabs(report.range.preset)}
      <div class="topbar-meta">
        <span class="chip">${report.scope === "project" ? "Current project" : "All projects"}</span>
        <span class="chip ghost">${escapeHtml(report.range.label)}</span>
        <span class="chip ghost">Generated ${formatDateTime(report.generatedAtMs)}</span>
      </div>
    </header>

    <section class="card overview" aria-label="Spend overview">
      <div class="overview-head">
        <div class="overview-headline">
          <p class="eyebrow">Total spend</p>
          <strong class="hero-figure">${formatMoney(report.summary.usage.cost.total)}</strong>
          <p class="hero-sub">${escapeHtml(report.range.label)} · ${formatTokenCount(report.summary.usage.totalTokens)} tokens · ${INTEGER.format(report.summary.includedSessions)} sessions · ${INTEGER.format(report.summary.turns)} turns</p>
        </div>
        <div class="overview-legend">
          <span class="chip">Daily spend</span>
          <span class="chip ghost">${plural(report.daily.length, "day")}</span>
        </div>
      </div>

      <div class="overview-chart-full">
        ${renderTrendChart(report.daily)}
      </div>

      <div class="overview-stats">
        ${statCell("Sessions", INTEGER.format(report.summary.includedSessions), `${INTEGER.format(report.summary.scannedSessions)} scanned`)}
        ${statCell("Assistant turns", INTEGER.format(report.summary.turns), `${INTEGER.format(report.models.length)} models`)}
        ${statCell("Tokens", formatTokenCount(report.summary.usage.totalTokens), `${formatTokenCount(report.summary.usage.output)} output`)}
        ${statCell("Cache reuse", formatPercent(cacheReuse(report)), `${formatTokenCount(report.summary.usage.cacheRead)} read`)}
      </div>
    </section>

    <div class="trio">
      <section class="card panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Mix</p>
            <h2>Model cost</h2>
          </div>
          <span class="chip ghost">${report.models.length} models</span>
        </div>
        ${renderModelMix(report.models, report.summary.usage.cost.total, modelColors)}
      </section>
      ${
        periodView
          ? `<section class="card panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Period</p>
            <h2>${escapeHtml(periodView.title)} breakdown</h2>
          </div>
          <span class="chip ghost">${plural(periodView.rows.length, escapeHtml(periodView.unit))}</span>
        </div>
        ${renderPeriodTable(periodView.rows)}
      </section>`
          : ""
      }
    </div>

    <div class="report-stack">
      <section class="card panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Ledger</p>
            <h2>Daily detail</h2>
          </div>
          <span class="chip ghost">${plural(report.daily.length, "day")}</span>
        </div>
        ${renderDailyLedger(report.daily)}
      </section>

      <section class="card panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Heavy hitters</p>
            <h2>Largest sessions</h2>
          </div>
          <span class="chip ghost">Top ${Math.min(report.sessions.length, 30)} · branches included</span>
        </div>
        ${renderSessions(report.sessions, report.includePrompts, modelColors)}
      </section>

      <section class="card panel">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Turns</p>
            <h2>Largest individual turns</h2>
          </div>
          <span class="chip ghost">Top ${report.topTurns.length}</span>
        </div>
        ${renderTurns(report.topTurns, report.includePrompts, modelColors)}
      </section>
    </div>

    <footer class="report-footnote">
      <p>Cost source: assistant message <code>usage.cost</code> from Pi session JSONL files. This report counts recorded usage, including alternate branches, because those calls were already made.</p>
      <p>${report.includePrompts ? "Prompt excerpts are included from local session files." : "Prompt excerpts are redacted for this report."}</p>
      <script type="application/json" id="pi-cost-report-data">${escapeScriptJson(JSON.stringify(report))}</script>
    </footer>
  </main>
</body>
</html>`;
}

const RANGE_TABS: ReadonlyArray<{ preset: string; label: string }> = [
  { preset: "today", label: "Today" },
  { preset: "week", label: "Week" },
  { preset: "month", label: "Month" },
  { preset: "year", label: "Year" },
  { preset: "all", label: "All" },
];

function renderRangeTabs(active: string): string {
  const known = RANGE_TABS.some((tab) => tab.preset === active);
  const tabs = RANGE_TABS.map(
    (tab) =>
      `<span class="seg ${tab.preset === active ? "seg-on" : ""}">${escapeHtml(tab.label)}</span>`,
  );
  if (!known) tabs.push(`<span class="seg seg-on">Custom</span>`);
  return `<nav class="segmented" aria-label="Report range">${tabs.join("")}</nav>`;
}

function renderTrendChart(days: TimeAggregate[]): string {
  if (days.length === 0) return emptyState("No daily usage to chart for this range.");
  const values = days.map((day) => day.usage.cost.total);
  const max = Math.max(0, ...values);
  // Round the y-axis up to a nice ceiling so peaks keep headroom and never crowd the labels.
  const ceiling = niceCeil(max);
  const peakIndex = values.reduce(
    (best, value, index) => (value > values[best]! ? index : best),
    0,
  );
  return `<div class="trend">
    <div class="trend-axis">
      <span>${formatMoney(ceiling)}</span>
      <span>${formatMoney(ceiling / 2)}</span>
      <span>${formatMoney(0)}</span>
    </div>
    <div class="trend-plot">
      ${svgArea(values, { width: 1000, height: 300, smooth: true, fillId: "trend", grid: true, peakIndex, domainMax: ceiling })}
      <div class="trend-labels">
        <span>${escapeHtml(days[0]!.label)}</span>
        <span class="trend-peak">Peak ${escapeHtml(days[peakIndex]!.label)} · ${formatMoney(values[peakIndex]!)}</span>
        <span>${escapeHtml(days.at(-1)!.label)}</span>
      </div>
    </div>
  </div>`;
}

interface AreaOptions {
  width: number;
  height: number;
  smooth: boolean;
  fillId: string;
  grid: boolean;
  peakIndex?: number;
  domainMax?: number;
}

// Smallest "nice" number (1/2/5 × 10^n) at or above value, for a clean axis ceiling.
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

// Self-contained SVG area+line for a numeric series. No external chart libs.
function svgArea(values: number[], opts: AreaOptions): string {
  const { width: w, height: h } = opts;
  const padTop = 18;
  const padBottom = 6;
  const padX = 6;
  const innerH = h - padTop - padBottom;
  const max = Math.max(0, opts.domainMax ?? 0, ...values);
  const n = values.length;
  const xAt = (index: number): number =>
    n <= 1 ? w / 2 : round(padX + (index / (n - 1)) * (w - padX * 2));
  const yAt = (value: number): number =>
    max <= 0 ? h - padBottom : round(padTop + innerH - (value / max) * innerH);

  const points = values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));
  const linePath = opts.smooth ? smoothPath(points) : polylinePath(points);
  const baseline = h - padBottom;
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points.at(-1)!.x} ${baseline} L ${points[0]!.x} ${baseline} Z`
      : "";

  const gridLines = opts.grid
    ? [0.25, 0.5, 0.75]
        .map((fraction) => {
          const y = round(padTop + innerH - fraction * innerH);
          return `<line x1="${padX}" y1="${y}" x2="${w - padX}" y2="${y}" class="grid-line" />`;
        })
        .join("")
    : "";

  const peak =
    opts.peakIndex !== undefined && points[opts.peakIndex] && max > 0
      ? `<circle cx="${points[opts.peakIndex]!.x}" cy="${points[opts.peakIndex]!.y}" r="4.5" class="peak-dot" />`
      : "";

  return `<svg class="area" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Spend trend">
    <defs>
      <linearGradient id="grad-${opts.fillId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.42" />
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${gridLines}
    ${areaPath ? `<path d="${areaPath}" fill="url(#grad-${opts.fillId})" />` : ""}
    ${linePath ? `<path d="${linePath}" class="area-line" />` : ""}
    ${peak}
  </svg>`;
}

function polylinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`;
}

// Catmull-Rom to cubic Bezier smoothing for a soft, designed curve.
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return polylinePath(points);
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = round(p1.x + (p2.x - p0.x) / 6);
    const c1y = round(p1.y + (p2.y - p0.y) / 6);
    const c2x = round(p2.x - (p3.x - p1.x) / 6);
    const c2y = round(p2.y - (p3.y - p1.y) / 6);
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return path;
}

function renderDailyLedger(days: TimeAggregate[]): string {
  if (days.length === 0) return emptyState("No daily usage found for this range.");

  return `<div class="daily-ledger" role="table" aria-label="Daily spend ledger">
    <div class="daily-row daily-row-head" role="row">
      <span role="columnheader">Day</span>
      <span role="columnheader">Cost</span>
      <span role="columnheader">Activity</span>
      <span role="columnheader">Avg / turn</span>
      <span role="columnheader">Change</span>
    </div>
    ${days
      .map((day, index) => {
        const previous = days[index - 1];
        const averageTurnCost = day.turns > 0 ? day.usage.cost.total / day.turns : 0;
        return `<div class="daily-row" role="row">
          <span class="daily-date" role="cell">${escapeHtml(day.label)}</span>
          <strong class="daily-cost" role="cell">${formatMoney(day.usage.cost.total)}</strong>
          <span class="daily-activity" role="cell">${INTEGER.format(day.turns)} turns · ${INTEGER.format(day.sessions)} sessions</span>
          <span role="cell">${formatMoney(averageTurnCost)}</span>
          <span class="daily-delta ${deltaClass(day, previous)}" role="cell">${formatDelta(day, previous)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function formatDelta(day: TimeAggregate, previous: TimeAggregate | undefined): string {
  if (!previous) return "—";
  const delta = day.usage.cost.total - previous.usage.cost.total;
  if (Math.abs(delta) < 0.005) return "No change";
  return `${delta > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(delta))}`;
}

function deltaClass(day: TimeAggregate, previous: TimeAggregate | undefined): string {
  if (!previous) return "neutral";
  const delta = day.usage.cost.total - previous.usage.cost.total;
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 ? "up" : "down";
}

// Stacked share-of-total-spend bar plus a legend: each model's cost, percent, and usage.
function renderModelMix(models: ModelAggregate[], totalCost: number, colors: ModelColors): string {
  if (models.length === 0) return emptyState("No model usage found for this range.");
  const total =
    totalCost > 0 ? totalCost : models.reduce((sum, model) => sum + model.usage.cost.total, 0);

  const segments = models
    .map((model) => {
      const color = colors.get(model.key) ?? FALLBACK_COLOR;
      const share = total > 0 ? model.usage.cost.total / total : 0;
      const title = `${model.key} · ${formatMoney(model.usage.cost.total)} · ${formatPercent(share)}`;
      return `<span class="mix-seg" style="--w:${model.usage.cost.total};--c:${color}" title="${escapeHtml(title)}"></span>`;
    })
    .join("");

  const legend = models
    .map((model) => {
      const color = colors.get(model.key) ?? FALLBACK_COLOR;
      const share = total > 0 ? model.usage.cost.total / total : 0;
      return `<li style="--c:${color}">
        <span class="mix-name dot-label"><span class="dot"></span>${escapeHtml(model.key)}</span>
        <strong class="mix-cost">${formatMoney(model.usage.cost.total)}</strong>
        <span class="mix-meta">${INTEGER.format(model.turns)} turns · ${INTEGER.format(model.sessions)} sessions · ${formatTokenCount(model.usage.totalTokens)} tokens</span>
        <span class="mix-pct">${formatPercent(share)} of spend</span>
      </li>`;
    })
    .join("");

  return `<div class="mix">
    <div class="mix-bar" role="img" aria-label="Share of total spend by model">${segments}</div>
    <ol class="mix-legend">${legend}</ol>
  </div>`;
}

interface PeriodView {
  title: string;
  unit: string;
  rows: TimeAggregate[];
}

function plural(count: number, word: string): string {
  return `${INTEGER.format(count)} ${word}${count === 1 ? "" : "s"}`;
}

// Pick the natural sub-rollup for the selected range; omit when the daily ledger already covers it.
function periodViewFor(report: CostReport): PeriodView | undefined {
  switch (report.range.preset) {
    case "today":
    case "week":
      return undefined;
    case "month":
      return periodView("Weekly", "week", report.weekly);
    case "year":
      return periodView("Monthly", "month", report.monthly);
    case "all":
      return periodView("Monthly", "month", report.monthly.slice(-12));
    case "custom": {
      const dayCount = report.daily.length;
      if (dayCount <= 8) return undefined;
      if (dayCount <= 70) return periodView("Weekly", "week", report.weekly);
      return periodView("Monthly", "month", report.monthly.slice(-12));
    }
    default:
      return undefined;
  }
}

function periodView(title: string, unit: string, rows: TimeAggregate[]): PeriodView | undefined {
  return rows.length > 0 ? { title, unit, rows } : undefined;
}

function renderPeriodTable(rows: TimeAggregate[]): string {
  return `<table class="small-table period-table">
    <thead><tr><th>Period</th><th>Cost</th><th>Turns</th></tr></thead>
    <tbody>${rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.label)}</td><td>${formatMoney(row.usage.cost.total)}</td><td>${INTEGER.format(row.turns)}</td></tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

function renderSessions(
  sessions: SessionSummary[],
  includePrompts: boolean,
  colors: ModelColors,
): string {
  if (sessions.length === 0) return emptyState("No sessions with usage found for this range.");

  return `<div class="session-stack">${sessions
    .slice(0, 30)
    .map((session) => {
      const color = colors.get(session.models[0] ?? "") ?? FALLBACK_COLOR;
      return `<details class="session-card" style="--c:${color}">
        <summary>
          <span class="session-title"><strong><span class="dot"></span>${escapeHtml(sessionTitle(session))}</strong><small>${escapeHtml(session.cwd)}</small></span>
          <span class="money">${formatMoney(session.usage.cost.total)}</span>
        </summary>
        <div class="session-body">
          <dl class="detail-grid">
            <div><dt>Turns</dt><dd>${INTEGER.format(session.turns)}</dd></div>
            <div><dt>Tokens</dt><dd>${formatTokenCount(session.usage.totalTokens)}</dd></div>
            <div><dt>Window</dt><dd>${formatDateRange(session.startedAtMs, session.lastTurnAtMs)}</dd></div>
            <div><dt>Models</dt><dd>${escapeHtml(session.models.join(", "))}</dd></div>
          </dl>
          ${includePrompts ? `<p class="prompt-excerpt">${escapeHtml(session.firstPrompt || "No initial prompt text captured.")}</p>` : `<p class="prompt-excerpt muted">Prompt excerpt redacted.</p>`}
          <p class="path-line">${escapeHtml(session.path)}</p>
        </div>
      </details>`;
    })
    .join("")}</div>`;
}

function renderTurns(turns: TurnSummary[], includePrompts: boolean, colors: ModelColors): string {
  if (turns.length === 0) return emptyState("No assistant turns found for this range.");

  return `<ol class="turn-list">${turns
    .map((turn) => {
      const color = colors.get(turn.modelKey) ?? FALLBACK_COLOR;
      return `<li class="turn-card" style="--c:${color}">
          <header class="turn-card-head">
            <div class="turn-price-block">
              <strong>${formatMoney(turn.usage.cost.total)}</strong>
              <span>${formatDateTime(turn.timestampMs)}</span>
            </div>
            <div class="turn-facts">
              <span class="dot-label"><span class="dot"></span>${escapeHtml(turn.modelKey)}</span>
              <span>${escapeHtml(turn.sessionName || basename(turn.cwd))}</span>
              <span>${formatTokenCount(turn.usage.totalTokens)} tokens</span>
            </div>
          </header>
          <p class="turn-prompt">${includePrompts ? escapeHtml(turn.promptExcerpt || "No prompt text captured.") : "Prompt redacted."}</p>
        </li>`;
    })
    .join("")}</ol>`;
}

function statCell(label: string, value: string, note: string): string {
  return `<div class="stat"><p>${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
}

function emptyState(message: string): string {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function sessionTitle(session: SessionSummary): string {
  return session.name || session.firstPrompt || basename(session.cwd) || "Untitled session";
}

function cacheReuse(report: CostReport): number {
  const usage = report.summary.usage;
  const reusable = usage.input + usage.cacheRead;
  return reusable > 0 ? usage.cacheRead / reusable : 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatMoney(value: number): string {
  return CURRENCY.format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTokenCount(value: number): string {
  return COMPACT.format(value);
}

function formatDateTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestampMs));
}

function formatDateRange(startMs: number, endMs: number): string {
  if (new Date(startMs).toDateString() === new Date(endMs).toDateString()) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(startMs));
  }
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(startMs))} – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(endMs))}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeScriptJson(value: string): string {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

const STYLES = `
:root {
  color-scheme: dark;
  --canvas: #0a0b0e;
  --surface: #14161c;
  --surface-2: #1a1d25;
  --surface-3: #20242e;
  --line: rgb(255 255 255 / 7%);
  --line-strong: rgb(255 255 255 / 13%);
  --ink: #f4f5f8;
  --muted: #9aa0ad;
  --faint: #6b7280;
  --accent: #8b7bff;
  --accent-2: #b9a6ff;
  --accent-deep: #5b46e0;
  --pos: #4ade80;
  --neg: #ff6b6b;
  --radius: 22px;
  --shadow: 0 24px 60px rgb(0 0 0 / 45%);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

body {
  position: relative;
  min-height: 100vh;
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  overflow-x: hidden;
}

.glow {
  position: fixed;
  z-index: 0;
  width: 720px;
  height: 720px;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.5;
  pointer-events: none;
}

.glow-a {
  top: -320px;
  right: -160px;
  background: radial-gradient(circle, rgb(139 123 255 / 38%), transparent 65%);
}

.glow-b {
  bottom: -360px;
  left: -200px;
  background: radial-gradient(circle, rgb(56 189 248 / 18%), transparent 65%);
}

.shell {
  position: relative;
  z-index: 1;
  width: min(1480px, calc(100% - 40px));
  margin: 0 auto;
  padding: 28px 0 64px;
}

.card {
  background: linear-gradient(180deg, rgb(255 255 255 / 3.5%), rgb(255 255 255 / 0%)), var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}

.brand {
  display: flex;
  gap: 12px;
  align-items: center;
}

.brand-mark {
  width: 34px;
  height: 34px;
  background: conic-gradient(from 140deg, var(--accent), var(--accent-deep), #38bdf8, var(--accent));
  border-radius: 11px;
  box-shadow: 0 0 22px rgb(139 123 255 / 45%);
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.brand-text strong { font-size: 1.05rem; letter-spacing: -0.01em; }
.brand-text span { color: var(--muted); font-size: 0.82rem; }

.segmented {
  display: flex;
  gap: 4px;
  padding: 5px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
}

.seg {
  padding: 7px 16px;
  color: var(--muted);
  border-radius: 999px;
  font-size: 0.82rem;
  font-weight: 650;
}

.seg-on {
  color: #0b0c10;
  background: linear-gradient(180deg, var(--accent-2), var(--accent));
  box-shadow: 0 6px 18px rgb(139 123 255 / 35%);
}

.topbar-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  padding: 7px 13px;
  background: rgb(139 123 255 / 14%);
  border: 1px solid rgb(139 123 255 / 30%);
  border-radius: 999px;
  color: var(--accent-2);
  font-size: 0.78rem;
  font-weight: 600;
}

.chip.ghost {
  background: var(--surface);
  border-color: var(--line-strong);
  color: var(--muted);
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--accent-2);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1, h2, h3, p { margin-top: 0; }

h2 {
  margin-bottom: 0;
  font-size: 1.22rem;
  letter-spacing: -0.02em;
}

h3 {
  margin-bottom: 12px;
  font-size: 0.95rem;
}

.overview {
  overflow: hidden;
  margin-bottom: 14px;
  padding: 0;
}

.overview-head {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 30px 30px 6px;
}

.overview-head::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(90% 160% at 0% 0%, rgb(139 123 255 / 20%), transparent 60%);
  pointer-events: none;
}

.overview-headline { position: relative; min-width: 0; }
.overview-legend { position: relative; display: flex; flex-wrap: wrap; gap: 8px; }

.overview-chart-full {
  padding: 14px 26px 20px;
}

.overview-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--line);
}

.stat {
  min-width: 0;
  padding: 20px 24px;
  border-left: 1px solid var(--line);
}

.stat:first-child { border-left: 0; }

.stat p {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.stat strong {
  display: block;
  overflow: hidden;
  font-size: clamp(1.5rem, 2.6vw, 2.1rem);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat span { color: var(--muted); font-size: 0.86rem; }

.hero-figure {
  display: block;
  font-size: clamp(3rem, 6vw, 4.6rem);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.05em;
  line-height: 1;
}

.hero-sub {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 0.94rem;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  margin-bottom: 18px;
}

.trend {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
}

.trend-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 14px 0 24px;
  color: var(--faint);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.trend-plot { min-width: 0; }

.area {
  display: block;
  width: 100%;
  height: 300px;
}

.area-line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 6px 14px rgb(139 123 255 / 35%));
}

.grid-line {
  stroke: var(--line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.peak-dot {
  fill: #fff;
  stroke: var(--accent);
  stroke-width: 3;
  vector-effect: non-scaling-stroke;
}

.trend-labels {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: var(--muted);
  font-size: 0.76rem;
}

.trend-peak { color: var(--accent-2); }

.trio {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}

.report-stack {
  display: grid;
  gap: 14px;
}

.panel { min-width: 0; padding: 24px; }

.money {
  display: block;
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.dot-label { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }

.dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--c, var(--accent));
  box-shadow: 0 0 8px var(--c, var(--accent));
}

.mix-bar {
  display: flex;
  gap: 3px;
  height: 18px;
  margin-bottom: 22px;
}

.mix-seg {
  flex-grow: var(--w, 1);
  flex-shrink: 1;
  flex-basis: 0;
  min-width: 7px;
  background: var(--c, var(--accent));
  border-radius: 5px;
}

.mix-legend {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mix-legend li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  grid-template-areas: "name cost" "meta pct";
  gap: 4px 14px;
  align-items: baseline;
}

.mix-name {
  grid-area: name;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mix-cost {
  grid-area: cost;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.mix-meta { grid-area: meta; color: var(--muted); font-size: 0.84rem; }

.mix-pct {
  grid-area: pct;
  color: var(--accent-2);
  font-size: 0.84rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

table { width: 100%; border-collapse: collapse; }

th {
  color: var(--faint);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
}

td, th {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  vertical-align: top;
}

tr:last-child td { border-bottom: 0; }

td { font-variant-numeric: tabular-nums; }

.small-table td:nth-child(2),
.small-table td:nth-child(3),
.small-table th:nth-child(2),
.small-table th:nth-child(3) { text-align: right; }

.session-stack { display: grid; gap: 10px; }

.session-card {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--c, var(--accent));
  border-radius: 16px;
}

.session-card summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  gap: 18px;
  align-items: center;
  padding: 15px 18px;
  cursor: pointer;
}

.session-card summary::-webkit-details-marker { display: none; }
.session-card[open] summary { border-bottom: 1px solid var(--line); }

.session-title { min-width: 0; }

.session-title strong {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card small {
  display: block;
  overflow: hidden;
  margin-top: 4px;
  color: var(--faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-body { padding: 16px 18px; }

.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0 0 14px;
}

.detail-grid div {
  min-width: 0;
  padding: 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 13px;
}

.detail-grid dt {
  margin: 0 0 5px;
  color: var(--faint);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.detail-grid dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }

.prompt-excerpt {
  margin-bottom: 12px;
  color: #cfd2da;
  line-height: 1.55;
}

.muted { color: var(--muted); }

.path-line {
  margin-bottom: 0;
  color: var(--faint);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.turn-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.turn-card {
  display: grid;
  gap: 14px;
  padding: 16px 18px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--c, var(--accent));
  border-radius: 16px;
}

.turn-card-head {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}

.turn-price-block { display: grid; gap: 4px; }

.turn-price-block strong {
  font-size: 1.4rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.turn-price-block span { color: var(--muted); font-size: 0.84rem; white-space: nowrap; }

.turn-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.turn-facts span {
  max-width: 100%;
  overflow: hidden;
  padding: 6px 11px;
  color: #cfd2da;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 999px;
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.turn-prompt {
  display: -webkit-box;
  max-width: 120ch;
  margin: 0;
  overflow: hidden;
  color: #c4c7d0;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.empty-state {
  padding: 22px;
  color: var(--muted);
  background: var(--surface-2);
  border: 1px dashed var(--line-strong);
  border-radius: 16px;
}

.report-footnote {
  display: grid;
  gap: 6px;
  margin-top: 22px;
  color: var(--faint);
  font-size: 0.86rem;
}

.report-footnote p { margin-bottom: 0; }

code {
  padding: 0.12rem 0.3rem;
  background: var(--surface-3);
  border-radius: 6px;
  font-size: 0.85em;
}

@media (max-width: 980px) {
  .detail-grid { grid-template-columns: 1fr; }

  .overview-stats { grid-template-columns: repeat(2, 1fr); }
  .stat:nth-child(3) { border-left: 0; }
  .stat:nth-child(n + 3) { border-top: 1px solid var(--line); }

  .daily-row { grid-template-columns: 1fr 1fr; }
  .daily-row-head { display: none; }
  .daily-cost, .daily-delta { text-align: right; }
  .daily-activity { white-space: normal; }

  .turn-card-head { grid-template-columns: 1fr; }
  .turn-facts { justify-content: flex-start; }
}

.daily-ledger {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface-2);
}

.daily-row {
  display: grid;
  grid-template-columns: minmax(150px, 1.1fr) minmax(110px, 0.7fr) minmax(170px, 1fr) minmax(110px, 0.7fr) minmax(120px, 0.7fr);
  gap: 16px;
  align-items: baseline;
  padding: 13px 18px;
  border-bottom: 1px solid var(--line);
}

.daily-row:last-child { border-bottom: 0; }

.daily-row-head {
  padding-block: 11px;
  background: var(--surface);
  color: var(--faint);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.daily-date, .daily-activity {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.daily-activity { color: var(--muted); }

.daily-cost {
  color: var(--ink);
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.daily-row span:nth-child(4) { color: var(--muted); font-variant-numeric: tabular-nums; }
.daily-delta { font-variant-numeric: tabular-nums; }
.daily-delta.neutral { color: var(--faint); }
.daily-delta.up { color: var(--neg); }
.daily-delta.down { color: var(--pos); }

@media print {
  body { background: #fff; color: #000; }
  .glow { display: none; }
  .shell { width: 100%; padding: 0; }
  .card { box-shadow: none; }
}
`;
