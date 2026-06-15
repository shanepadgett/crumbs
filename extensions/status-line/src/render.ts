import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GitSummary, StatusFlags, TokenTotals } from "./types.js";

type RenderState = {
  ctx: ExtensionContext;
  footerData: ReadonlyFooterDataProvider;
  flags: StatusFlags;
  git: GitSummary;
};

type RenderedText = {
  rendered: string;
  plain: string;
};

type UsageLike = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

function formatTokens(count: number): string {
  if (count < 1000) return `${Math.round(count)}`;
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function dim(theme: Theme, text: string): string {
  return theme.fg("dim", text);
}

function pair(rendered: string, plain = rendered): RenderedText {
  return { rendered, plain };
}

function getUsage(value: unknown): UsageLike | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const cost = usage.cost as Record<string, unknown> | undefined;
  return {
    input: typeof usage.input === "number" ? usage.input : undefined,
    output: typeof usage.output === "number" ? usage.output : undefined,
    cacheRead: typeof usage.cacheRead === "number" ? usage.cacheRead : undefined,
    cacheWrite: typeof usage.cacheWrite === "number" ? usage.cacheWrite : undefined,
    cost:
      cost && typeof cost === "object"
        ? { total: typeof cost.total === "number" ? cost.total : undefined }
        : undefined,
  };
}

export function getTokenTotals(ctx: ExtensionContext): TokenTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let latestCacheHitRate: number | undefined;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = getUsage(entry.message.usage);
    if (!usage) continue;

    input += usage.input ?? 0;
    output += usage.output ?? 0;
    cacheRead += usage.cacheRead ?? 0;
    cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;

    const latestPromptTokens =
      (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    latestCacheHitRate =
      latestPromptTokens > 0 ? ((usage.cacheRead ?? 0) / latestPromptTokens) * 100 : undefined;
  }

  return { input, output, cacheRead, cacheWrite, cost, latestCacheHitRate };
}

function getContextPercentColor(percent: number | undefined): ThemeColor | undefined {
  if (typeof percent !== "number") return undefined;
  if (percent > 90) return "error";
  if (percent > 70) return "warning";
  return undefined;
}

function buildContextPart(theme: Theme, ctx: ExtensionContext): RenderedText {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  const percentValue = typeof usage?.percent === "number" ? usage.percent : undefined;
  const percent = typeof percentValue === "number" ? `${percentValue.toFixed(1)}%` : "?";
  const plain = `${percent}/${formatTokens(contextWindow)}`;
  const slashIndex = plain.indexOf("/");
  if (slashIndex < 0) return pair(dim(theme, plain));

  const color = getContextPercentColor(percentValue) ?? "dim";
  return pair(
    theme.fg(color, plain.slice(0, slashIndex)) + dim(theme, plain.slice(slashIndex)),
    plain,
  );
}

function buildStats(theme: Theme, ctx: ExtensionContext): RenderedText {
  const totals = getTokenTotals(ctx);
  const parts: RenderedText[] = [];

  if (totals.input) parts.push(pair(`↑${formatTokens(totals.input)}`));
  if (totals.output) parts.push(pair(`↓${formatTokens(totals.output)}`));
  if (totals.cacheRead) parts.push(pair(`R${formatTokens(totals.cacheRead)}`));
  if (totals.cacheWrite) parts.push(pair(`W${formatTokens(totals.cacheWrite)}`));
  if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && totals.latestCacheHitRate !== undefined) {
    parts.push(pair(`CH${totals.latestCacheHitRate.toFixed(1)}%`));
  }

  const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
  if (totals.cost || usingSubscription) {
    parts.push(pair(`$${totals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`));
  }

  parts.push(buildContextPart(theme, ctx));

  return {
    rendered: parts.map((part) => part.rendered).join(dim(theme, " ")),
    plain: parts.map((part) => part.plain).join(" "),
  };
}

function buildModelText(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): string {
  const model = ctx.model?.id ?? "no-model";
  return footerData.getAvailableProviderCount() > 1 && ctx.model
    ? `(${ctx.model.provider}) ${model}`
    : model;
}

function buildTopLeft(state: RenderState, piThinkingLevel: string | undefined): string {
  const branch = state.git.branch || state.footerData.getGitBranch();
  const branchText = branch
    ? [branch, state.git.summary ? `(${state.git.summary})` : ""].filter(Boolean).join(" ")
    : "";
  const modelParts = [buildModelText(state.ctx, state.footerData)];
  if (state.ctx.model?.reasoning && piThinkingLevel) modelParts.push(piThinkingLevel);
  if (state.flags.fastEnabled) modelParts.push("⚡");
  const model = modelParts.filter(Boolean).join(" • ");
  return [branchText, model].filter(Boolean).join(" • ");
}

function shortenPath(cwd: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return cwd;
  if (cwd === home) return "~";
  return cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
}

function enhancementIcon(enhancement: StatusFlags["cavemanEnhancements"][number]): string {
  if (enhancement === "improve") return "🔨";
  if (enhancement === "design") return "🎨";
  if (enhancement === "architecture") return "🏛️";
  if (enhancement === "swiftui") return "🍎";
  return "📘";
}

function buildCaveman(theme: Theme, flags: StatusFlags): RenderedText {
  if (!flags.cavemanEnabled) return pair("");

  const rendered = [theme.fg("accent", `🗿(${flags.cavemanName})`)];
  const plain = [`🗿(${flags.cavemanName})`];
  for (const enhancement of flags.cavemanEnhancements) {
    const icon = enhancementIcon(enhancement);
    rendered.push(theme.fg("accent", icon));
    plain.push(icon);
  }

  return {
    rendered: rendered.join(dim(theme, " • ")),
    plain: plain.join(" • "),
  };
}

function splitLine(theme: Theme, width: number, left: RenderedText, right: RenderedText): string {
  if (width <= 0) return "";
  const rightWidth = visibleWidth(right.plain);
  if (rightWidth >= width) return truncateToWidth(right.rendered, width, dim(theme, "..."));

  const leftAvailable = Math.max(0, width - rightWidth - 2);
  const leftText = truncateToWidth(left.rendered, leftAvailable, dim(theme, "..."));
  const leftWidth = visibleWidth(leftText);
  const padding = " ".repeat(Math.max(1, width - leftWidth - rightWidth));
  return leftText + padding + right.rendered;
}

export function renderStatusLine(
  theme: Theme,
  width: number,
  state: RenderState,
  piThinkingLevel?: string,
): string[] {
  const safeWidth = Math.max(10, width);
  const sessionName = state.ctx.sessionManager.getSessionName();
  const cwd = shortenPath(state.ctx.cwd);
  const bottomLeft = sessionName ? `${cwd} • ${sessionName}` : cwd;
  const bottomLeftRendered = sessionName
    ? `${dim(theme, cwd)}${dim(theme, " • ")}${theme.fg("warning", theme.bold(sessionName))}`
    : dim(theme, cwd);
  const topLeft = buildTopLeft(state, piThinkingLevel);

  return [
    splitLine(theme, safeWidth, pair(dim(theme, topLeft), topLeft), buildStats(theme, state.ctx)),
    splitLine(
      theme,
      safeWidth,
      pair(bottomLeftRendered, bottomLeft),
      buildCaveman(theme, state.flags),
    ),
  ];
}
