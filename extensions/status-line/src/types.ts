import type { CavemanEnhancement } from "../../caveman/src/system-prompt.js";

export type { CavemanEnhancement };

export type StatusLinePrefs = {
  enabled: boolean;
};

export type StatusFlags = {
  fastEnabled: boolean;
  cavemanName: string;
  cavemanEnabled: boolean;
  cavemanEnhancements: CavemanEnhancement[];
  cavemanPowerSource: "session" | "project" | "global" | "none";
  cavemanHasSessionOverride: boolean;
};

export type TokenTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  latestCacheHitRate?: number;
};

export type GitSummary = {
  branch: string;
  summary: string;
};
