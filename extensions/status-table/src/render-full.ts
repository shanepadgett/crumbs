import type { Theme } from "@mariozechner/pi-coding-agent";
import {
  computeSharedLayout,
  renderDivider,
  renderLine,
  renderMiddleDivider,
} from "./render-shared.js";
import { renderContextValue } from "./snapshot.js";
import type { Cell, StatusSnapshot } from "./types.js";

export function renderFullTable(theme: Theme, width: number, snapshot: StatusSnapshot): string[] {
  const topRow: Cell[] = [
    { label: "provider", value: snapshot.provider },
    { label: "model", value: snapshot.model },
    { label: "thinking", value: snapshot.thinking },
    { label: "fast", value: snapshot.fast },
    { label: "caveman", value: snapshot.caveman },
    {
      label: "context",
      value: `${snapshot.contextSummary} | ${snapshot.tokenSummary}`,
      renderedValue: renderContextValue(
        theme,
        `${snapshot.contextSummary} | ${snapshot.tokenSummary}`,
        snapshot.contextPercent,
      ),
    },
  ];

  const bottomRow: Cell[] = [
    {
      label: "git",
      value: snapshot.git,
      valueColor:
        snapshot.git === "clean" ? "success" : snapshot.git === "no git" ? "dim" : "warning",
    },
    { label: "branch", value: snapshot.branch },
    { label: "path", value: snapshot.path },
  ];

  const { top, bottom } = computeSharedLayout(width, topRow, bottomRow);

  return [
    renderLine(theme, topRow, top, "label"),
    renderLine(theme, topRow, top, "value"),
    renderMiddleDivider(theme, top, bottom),
    renderLine(theme, bottomRow, bottom, "label"),
    renderLine(theme, bottomRow, bottom, "value"),
    renderDivider(theme, bottom),
  ];
}
