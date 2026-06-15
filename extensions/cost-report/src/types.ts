export type ReportScope = "all" | "project";

export type RangePreset = "today" | "week" | "month" | "year" | "all" | "custom";

export interface ReportRange {
  preset: RangePreset;
  label: string;
  slug: string;
  startMs?: number;
  endMs?: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: CostBreakdown;
}

export interface TurnSummary {
  id: string;
  sessionId: string;
  sessionPath: string;
  sessionName?: string;
  cwd: string;
  timestampMs: number;
  dateKey: string;
  provider: string;
  model: string;
  modelKey: string;
  promptExcerpt: string;
  usage: UsageTotals;
}

export interface ModelAggregate {
  key: string;
  provider: string;
  model: string;
  turns: number;
  sessions: number;
  usage: UsageTotals;
}

export interface TimeAggregate {
  key: string;
  label: string;
  turns: number;
  sessions: number;
  usage: UsageTotals;
}

export interface SessionSummary {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  firstPrompt: string;
  startedAtMs: number;
  lastTurnAtMs: number;
  messageCount: number;
  turns: number;
  models: string[];
  usage: UsageTotals;
}

export interface CostReportSummary {
  scannedSessions: number;
  includedSessions: number;
  skippedSessions: number;
  turns: number;
  usage: UsageTotals;
}

export interface CostReport {
  generatedAtMs: number;
  cwd: string;
  scope: ReportScope;
  includePrompts: boolean;
  range: ReportRange;
  summary: CostReportSummary;
  daily: TimeAggregate[];
  weekly: TimeAggregate[];
  monthly: TimeAggregate[];
  models: ModelAggregate[];
  sessions: SessionSummary[];
  topTurns: TurnSummary[];
}
