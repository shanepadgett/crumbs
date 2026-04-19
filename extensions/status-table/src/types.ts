import type { ThemeColor } from "@mariozechner/pi-coding-agent";
export type { CavemanEnhancement } from "../../caveman/src/system-prompt.js";
import type { CavemanEnhancement } from "../../caveman/src/system-prompt.js";

export type GitSummary = {
  branch: string;
  summary: string;
};

export type StatusBlockId =
  | "path"
  | "git"
  | "provider"
  | "model"
  | "thinking"
  | "focus"
  | "fast"
  | "caveman"
  | "context"
  | "tokens";

export type StatusTablePrefs = {
  enabled: boolean;
  visibleBlocks: StatusBlockId[];
};

export type StatusSnapshot = {
  git: string;
  branch: string;
  path: string;
  provider: string;
  model: string;
  thinking: string;
  fast: string;
  caveman: string;
  cavemanName: string;
  cavemanEnabled: boolean;
  cavemanEnhancements: CavemanEnhancement[];
  cavemanPowerSource: "session" | "project" | "global" | "none";
  cavemanHasSessionOverride: boolean;
  focus: string;
  focusMode: "off" | FocusMode;
  contextSummary: string;
  tokenSummary: string;
  contextPercent: number | undefined;
};

export type SessionTokenTotals = {
  input: number;
  output: number;
};

export type FocusMode = "soft" | "hidden" | "hard";

export type StatusFlags = {
  fastEnabled: boolean;
  cavemanName: string;
  cavemanEnabled: boolean;
  cavemanEnhancements: CavemanEnhancement[];
  cavemanPowerSource: "session" | "project" | "global" | "none";
  cavemanHasSessionOverride: boolean;
  focusEnabled: boolean;
  focusMode: FocusMode;
};

export type Cell = {
  label: string;
  value: string;
  valueColor?: ThemeColor;
  renderedValue?: string;
};
