import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { renderDivider, truncateFromStart } from "./render-shared.js";
import { renderContextValue } from "./snapshot.js";
import type { StatusBlockId, StatusSnapshot } from "./types.js";

type BlockDefinition = {
  id: StatusBlockId;
  placement: "left" | "right";
  build: (theme: Theme, snapshot: StatusSnapshot) => { rendered: string; plain: string } | null;
};

function enhancementIcon(enhancement: StatusSnapshot["cavemanEnhancements"][number]): string {
  if (enhancement === "improve") return "🔨";
  if (enhancement === "design") return "🎨";
  if (enhancement === "architecture") return "🏛️";
  if (enhancement === "swiftui") return "🍎";
  return "📘";
}

function compactMinimalPath(path: string): string {
  if (path === "~") return path;

  const normalized = path.replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("~/") && parts.length <= 2) return normalized;
  if (parts.length <= 2) return normalized || path;

  return `…/${parts.slice(-2).join("/")}`;
}

function abbreviateThinking(value: string): string {
  if (value === "medium") return "med";
  if (value === "high") return "high";
  if (value === "low") return "low";
  if (value === "off") return "off";
  return value;
}

function buildModelSuffix(snapshot: StatusSnapshot): string {
  const parts = [abbreviateThinking(snapshot.thinking)];
  if (snapshot.fast === "on") parts.push("⚡");
  return parts.join(", ");
}

function buildTextPair(
  rendered: string,
  plain: string = rendered,
): { rendered: string; plain: string } {
  return { rendered, plain };
}

function dim(theme: Theme, value: string): string {
  return theme.fg("dim", value);
}

function joinSegments(theme: Theme, segments: string[]): string {
  return segments.join(dim(theme, " │ "));
}

function joinMutedSegments(theme: Theme, segments: string[]): string {
  return segments.map((segment) => dim(theme, segment)).join(dim(theme, " │ "));
}

const BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  {
    id: "path",
    placement: "left",
    build: (_theme, snapshot) => {
      const value = compactMinimalPath(snapshot.path);
      return buildTextPair(value);
    },
  },
  {
    id: "git",
    placement: "left",
    build: (_theme, snapshot) => {
      const value = `${snapshot.branch} (${snapshot.git})`;
      return buildTextPair(value);
    },
  },
  {
    id: "provider",
    placement: "left",
    build: (_theme, snapshot) => buildTextPair(snapshot.provider),
  },
  {
    id: "model",
    placement: "left",
    build: (_theme, snapshot) => {
      const suffix = buildModelSuffix(snapshot);
      if (!suffix) return buildTextPair(snapshot.model);
      return buildTextPair(`${snapshot.model} (${suffix})`, `${snapshot.model} (${suffix})`);
    },
  },
  {
    id: "caveman",
    placement: "right",
    build: (theme, snapshot) => {
      if (!snapshot.cavemanEnabled) return null;

      const renderedSegments = [theme.fg("accent", `🗿(${snapshot.cavemanName})`)];
      const plainSegments = [`🗿(${snapshot.cavemanName})`];
      for (const enhancement of snapshot.cavemanEnhancements) {
        const icon = enhancementIcon(enhancement);
        renderedSegments.push(theme.fg("accent", icon));
        plainSegments.push(icon);
      }
      return buildTextPair(
        renderedSegments.join(theme.fg("dim", " · ")),
        plainSegments.join(" · "),
      );
    },
  },
  {
    id: "context",
    placement: "right",
    build: (theme, snapshot) =>
      buildTextPair(
        renderContextValue(theme, snapshot.contextSummary, snapshot.contextPercent),
        snapshot.contextSummary,
      ),
  },
  {
    id: "tokens",
    placement: "right",
    build: (theme, snapshot) =>
      buildTextPair(dim(theme, snapshot.tokenSummary), snapshot.tokenSummary),
  },
] as const;

function getBlockDefinition(id: StatusBlockId): BlockDefinition | undefined {
  return BLOCK_DEFINITIONS.find((block) => block.id === id);
}

function fitLeftSegments(theme: Theme, segments: string[], availableWidth: number): string {
  if (segments.length === 0 || availableWidth <= 0) return "";

  const separator = " │ ";
  const separatorWidth = visibleWidth(separator);
  const minWidths = segments.map((segment, index) => {
    if (index === 0) return 8;
    if (index === 1) return 12;
    if (index === 2) return 6;
    if (index === 3) return 10;
    return 5;
  });

  const widths = segments.map((segment, index) =>
    Math.max(minWidths[index], visibleWidth(segment)),
  );
  const totalNaturalWidth =
    widths.reduce((sum, width) => sum + width, 0) + separatorWidth * (segments.length - 1);
  if (totalNaturalWidth <= availableWidth) return joinMutedSegments(theme, segments);

  const shrinkOrder = [3, 1, 0, 2, 4];
  let overflow = totalNaturalWidth - availableWidth;

  for (const index of shrinkOrder) {
    if (overflow <= 0 || index >= widths.length) continue;
    const nextWidth = Math.max(minWidths[index], widths[index] - overflow);
    const reducedBy = widths[index] - nextWidth;
    widths[index] = nextWidth;
    overflow -= reducedBy;
  }

  const fitted = segments.map((segment, index) => {
    if (visibleWidth(segment) <= widths[index]) return segment;
    return index === 0
      ? truncateFromStart(segment, widths[index])
      : truncateToWidth(segment, widths[index], widths[index] > 1 ? "…" : "");
  });

  return joinMutedSegments(theme, fitted);
}

export function renderMinimalTable(
  theme: Theme,
  width: number,
  snapshot: StatusSnapshot,
  visibleBlocks: readonly StatusBlockId[],
): string[] {
  const leftSegments: string[] = [];
  const rightTextSegments: string[] = [];
  const rightPlainSegments: string[] = [];

  for (const blockId of visibleBlocks) {
    const block = getBlockDefinition(blockId);
    if (!block) continue;
    const text = block.build(theme, snapshot);
    if (!text) continue;

    if (block.placement === "left") {
      leftSegments.push(text.plain);
      continue;
    }

    rightTextSegments.push(text.rendered);
    rightPlainSegments.push(text.plain);
  }

  const rightText = joinSegments(theme, rightTextSegments);
  const rightWidth = visibleWidth(joinSegments(theme, rightPlainSegments));
  const safeWidth = Math.max(20, width);
  const leftAvailable = Math.max(0, safeWidth - rightWidth - 1);
  const leftText = fitLeftSegments(theme, leftSegments, leftAvailable);
  const leftWidth = visibleWidth(leftText);
  const spacerWidth = Math.max(1, safeWidth - leftWidth - rightWidth);
  const line = leftText + " ".repeat(spacerWidth) + rightText;

  return [line, renderDivider(theme, [safeWidth], "")];
}
