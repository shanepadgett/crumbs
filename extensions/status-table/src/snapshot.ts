import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@mariozechner/pi-coding-agent";
import type { GitSummary, SessionTokenTotals, StatusFlags, StatusSnapshot } from "./types.js";

function enhancementIcon(enhancement: StatusFlags["cavemanEnhancements"][number]): string {
  if (enhancement === "improve") return "🔨";
  if (enhancement === "design") return "🎨";
  if (enhancement === "architecture") return "🏛️";
  if (enhancement === "swiftui") return "🍎";
  return "📘";
}

function getCavemanDisplay(flags: StatusFlags): {
  label: string;
  enabled: boolean;
  enhancements: StatusSnapshot["cavemanEnhancements"];
} {
  if (!flags.cavemanEnabled) {
    return { label: "off", enabled: false, enhancements: [] };
  }

  const suffix = flags.cavemanEnhancements
    .map((enhancement) => enhancementIcon(enhancement))
    .join("");

  return {
    label: suffix ? `${flags.cavemanName} ${suffix}` : flags.cavemanName,
    enabled: true,
    enhancements: [...flags.cavemanEnhancements],
  };
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export function getContextPercent(ctx: ExtensionContext): number | undefined {
  const usage = ctx.getContextUsage();
  if (!usage || usage.contextWindow <= 0) return undefined;

  const usedTokens = usage.tokens ?? 0;
  if (typeof usage.percent === "number" && Number.isFinite(usage.percent)) {
    return Math.round(usage.percent);
  }

  return Math.round((usedTokens / usage.contextWindow) * 100);
}

type SessionEntryUsage = {
  input?: number;
  output?: number;
};

type SessionEntryMessage = {
  role?: string;
  usage?: SessionEntryUsage;
};

type SessionEntryLike = {
  type?: string;
  message?: SessionEntryMessage;
};

function isSessionEntryLike(value: unknown): value is SessionEntryLike {
  if (!value || typeof value !== "object") return false;

  const entry = value as Record<string, unknown>;
  if (entry.type !== undefined && typeof entry.type !== "string") return false;

  if (entry.message !== undefined) {
    if (!entry.message || typeof entry.message !== "object") return false;

    const message = entry.message as Record<string, unknown>;
    if (message.role !== undefined && typeof message.role !== "string") return false;

    if (message.usage !== undefined) {
      if (!message.usage || typeof message.usage !== "object") return false;

      const usage = message.usage as Record<string, unknown>;
      if (usage.input !== undefined && typeof usage.input !== "number") return false;
      if (usage.output !== undefined && typeof usage.output !== "number") return false;
    }
  }

  return true;
}

export function getSessionTokenTotals(ctx: ExtensionContext): SessionTokenTotals {
  const entries = ctx.sessionManager.getEntries();

  let input = 0;
  let output = 0;

  for (const entry of entries) {
    if (!isSessionEntryLike(entry)) continue;
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    input += entry.message.usage?.input ?? 0;
    output += entry.message.usage?.output ?? 0;
  }

  return { input, output };
}

function formatContextUsage(
  ctx: ExtensionContext,
  totals: SessionTokenTotals,
): {
  contextSummary: string;
  tokenSummary: string;
  percent: number | undefined;
} {
  const usage = ctx.getContextUsage();
  if (!usage || usage.contextWindow <= 0) {
    return { contextSummary: "—", tokenSummary: "—", percent: undefined };
  }

  const percent = getContextPercent(ctx);
  const percentText = typeof percent === "number" ? `${percent}%` : "?";

  return {
    contextSummary: `${percentText}/${formatCompactNumber(usage.contextWindow)}`,
    tokenSummary: `↑${formatCompactNumber(totals.input)} ↓${formatCompactNumber(totals.output)}`,
    percent,
  };
}

export function getContextPercentColor(percent: number | undefined): ThemeColor | undefined {
  if (typeof percent !== "number") return undefined;
  if (percent >= 70) return "error";
  if (percent >= 50) return "warning";
  return undefined;
}

export function renderContextValue(
  theme: Theme,
  usageDisplay: string,
  percent: number | undefined,
): string {
  const slashIndex = usageDisplay.indexOf("/");
  if (slashIndex < 0) return theme.fg(getContextPercentColor(percent) ?? "dim", usageDisplay);

  const percentPart = usageDisplay.slice(0, slashIndex);
  const totalPart = usageDisplay.slice(slashIndex);
  return (
    theme.fg(getContextPercentColor(percent) ?? "dim", percentPart) + theme.fg("dim", totalPart)
  );
}

export function shortenPath(cwd: string): string {
  const home = process.env.HOME;
  if (home && cwd === home) return "~";
  if (home && cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return cwd;
}

export function buildSnapshot(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  git: GitSummary,
  totals: SessionTokenTotals,
  flags: StatusFlags,
): StatusSnapshot {
  const { contextSummary, tokenSummary, percent: contextPercent } = formatContextUsage(ctx, totals);
  const caveman = getCavemanDisplay(flags);

  return {
    git: git.summary,
    branch: git.branch,
    path: shortenPath(ctx.cwd),
    provider: ctx.model?.provider ?? "none",
    model: ctx.model?.id ?? "none",
    thinking: pi.getThinkingLevel(),
    fast: flags.fastEnabled ? "on" : "off",
    caveman: caveman.label,
    cavemanName: flags.cavemanName,
    cavemanEnabled: caveman.enabled,
    cavemanEnhancements: caveman.enhancements,
    cavemanPowerSource: flags.cavemanPowerSource,
    cavemanHasSessionOverride: flags.cavemanHasSessionOverride,
    contextSummary,
    tokenSummary,
    contextPercent,
  };
}
