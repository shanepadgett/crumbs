import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  CELL_SEPARATOR,
  DIVIDER_BOTTOM,
  SHARED_COLUMN_ONE_WIDTH,
  SHARED_COLUMN_TWO_WIDTH,
} from "./constants.js";
import type { Cell } from "./types.js";

export function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width, "");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function truncateFromStart(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return "…";

  const chars = Array.from(text);
  let suffix = "";

  for (let index = chars.length - 1; index >= 0; index--) {
    const candidate = chars[index] + suffix;
    if (visibleWidth(candidate) > width - 1) break;
    suffix = candidate;
  }

  return `…${suffix}`;
}

export function renderDivider(
  theme: Theme,
  widths: number[],
  connector: string = DIVIDER_BOTTOM,
): string {
  return widths
    .map((cellWidth) => theme.fg("dim", "─".repeat(cellWidth)))
    .join(theme.fg("dim", connector));
}

export function renderMiddleDivider(
  theme: Theme,
  topWidths: number[],
  bottomWidths: number[],
): string {
  let line = "";

  for (let index = 0; index < topWidths.length; index++) {
    line += theme.fg("dim", "─".repeat(topWidths[index]));
    if (index >= topWidths.length - 1) continue;
    line += theme.fg("dim", index < bottomWidths.length - 1 ? "─┼─" : "─┴─");
  }

  return line;
}

export function computeSharedLayout(
  width: number,
  topRow: Cell[],
  bottomRow: Cell[],
): { top: number[]; bottom: number[] } {
  const safeWidth = Math.max(40, width);
  const separatorWidth = visibleWidth(CELL_SEPARATOR);
  const remainderCells = topRow.slice(2);

  let sharedOne = SHARED_COLUMN_ONE_WIDTH;
  let sharedTwo = SHARED_COLUMN_TWO_WIDTH;

  const topSeparatorCount = Math.max(0, topRow.length - 1);
  const remainingWidth = Math.max(
    remainderCells.length * 4,
    safeWidth - sharedOne - sharedTwo - separatorWidth * topSeparatorCount,
  );
  const evenWidth = Math.floor(remainingWidth / Math.max(1, remainderCells.length));
  const remainder = remainderCells.map((_cell, index) =>
    index === remainderCells.length - 1
      ? remainingWidth - evenWidth * Math.max(0, remainderCells.length - 1)
      : evenWidth,
  );

  const minimumSharedTotal =
    sharedOne +
    sharedTwo +
    separatorWidth * topSeparatorCount +
    remainder.reduce((sum, value) => sum + value, 0);
  if (minimumSharedTotal > safeWidth) {
    const overflow = minimumSharedTotal - safeWidth;
    const reduceSharedTwo = Math.min(Math.max(0, sharedTwo - 12), overflow);
    sharedTwo -= reduceSharedTwo;
    const remainingOverflow = overflow - reduceSharedTwo;
    if (remainingOverflow > 0) sharedOne = Math.max(8, sharedOne - remainingOverflow);
  }

  return {
    top: [sharedOne, sharedTwo, ...remainder],
    bottom: [
      sharedOne,
      sharedTwo,
      Math.max(
        8,
        safeWidth - sharedOne - sharedTwo - separatorWidth * Math.max(0, bottomRow.length - 1),
      ),
    ],
  };
}

export function renderLine(
  theme: Theme,
  cells: Cell[],
  widths: number[],
  kind: "label" | "value",
): string {
  return cells
    .map((cell, index) => {
      const base = kind === "label" ? cell.label : (cell.renderedValue ?? cell.value);
      const text = pad(base, widths[index]);
      const output = index === cells.length - 1 ? text.trimEnd() : text;
      if (kind === "label") return theme.bold(theme.fg("dim", output));
      if (cell.renderedValue) return output;
      return theme.fg(cell.valueColor ?? "dim", output);
    })
    .join(theme.fg("dim", CELL_SEPARATOR));
}
