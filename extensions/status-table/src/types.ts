import type { ThemeColor } from "@mariozechner/pi-coding-agent";

export type GitSummary = {
  branch: string;
  summary: string;
};

export type StatusTableMode = "full" | "minimal";

export type StatusTablePrefs = {
  enabled: boolean;
  mode: StatusTableMode;
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
  contextSummary: string;
  tokenSummary: string;
  contextPercent: number | undefined;
};

export type SessionTokenTotals = {
  input: number;
  output: number;
};

export type StatusFlags = {
  fastEnabled: boolean;
  cavemanEnabled: boolean;
};

export type Cell = {
  label: string;
  value: string;
  valueColor?: ThemeColor;
  renderedValue?: string;
};

export type SettingsObject = Record<string, unknown>;
