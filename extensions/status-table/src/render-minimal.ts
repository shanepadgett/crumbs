import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { renderDivider, truncateFromStart } from "./render-shared.js";
import { renderContextValue } from "./snapshot.js";
import type { StatusSnapshot } from "./types.js";

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

function getModeSegments(
  theme: Theme,
  snapshot: StatusSnapshot,
): {
  rendered: string[];
  plain: string[];
} {
  const rendered: string[] = [];
  const plain: string[] = [];
  const cavemanRendered: string[] = [];
  const cavemanPlain: string[] = [];

  if (snapshot.focusMode !== "off") {
    rendered.push(theme.fg("accent", `🎯 ${snapshot.focus}`));
    plain.push(`🎯 ${snapshot.focus}`);
  }

  if (snapshot.fast === "on") {
    rendered.push(theme.fg("accent", "⚡"));
    plain.push("⚡");
  }

  if (snapshot.cavemanEnabled) {
    const cavemanLabel = `🗿(${snapshot.cavemanName})`;
    cavemanRendered.push(theme.fg("accent", cavemanLabel));
    cavemanPlain.push(cavemanLabel);
  }

  for (const enhancement of snapshot.cavemanEnhancements) {
    const icon = enhancementIcon(enhancement);
    cavemanRendered.push(theme.fg("accent", icon));
    cavemanPlain.push(icon);
  }

  if (cavemanRendered.length > 0) {
    rendered.push(cavemanRendered.join(theme.fg("dim", " · ")));
    plain.push(cavemanPlain.join(" · "));
  }

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
): string[] {
  const pathValue = compactMinimalPath(snapshot.path);
  const branchValue = `${snapshot.branch} (${snapshot.git})`;
  const thinkingValue = abbreviateThinking(snapshot.thinking);
  const leftSegments = [pathValue, branchValue, snapshot.provider, snapshot.model, thinkingValue];

  const rightTextSegments: string[] = [];
  const rightPlainSegments: string[] = [];
  const modes = getModeSegments(theme, snapshot);

  rightTextSegments.push(...modes.rendered);
  rightPlainSegments.push(...modes.plain);

  rightTextSegments.push(
    renderContextValue(theme, snapshot.contextSummary, snapshot.contextPercent),
  );
  rightTextSegments.push(dim(theme, snapshot.tokenSummary));
  rightPlainSegments.push(snapshot.contextSummary, snapshot.tokenSummary);

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
