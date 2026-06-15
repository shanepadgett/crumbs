import { readFile } from "node:fs/promises";
import {
  SessionManager,
  type SessionEntry,
  type SessionHeader,
  type SessionInfo,
  type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type {
  CostReport,
  CostReportSummary,
  ModelAggregate,
  ReportRange,
  ReportScope,
  SessionSummary,
  TimeAggregate,
  TurnSummary,
  UsageTotals,
} from "./types.js";

interface BuildCostReportOptions {
  cwd: string;
  includePrompts: boolean;
  onProgress?: (loaded: number, total: number) => void;
  range: ReportRange;
  scope: ReportScope;
}

interface BucketAccumulator {
  key: string;
  label: string;
  sessions: Set<string>;
  turns: number;
  usage: UsageTotals;
}

interface ModelAccumulator {
  key: string;
  provider: string;
  model: string;
  sessions: Set<string>;
  turns: number;
  usage: UsageTotals;
}

interface AnalyzedSession {
  session: SessionSummary;
  turns: TurnSummary[];
}

const EMPTY_USAGE: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export async function buildCostReport(options: BuildCostReportOptions): Promise<CostReport> {
  const infos = await listSessionInfos(options);
  const analyzedSessions: AnalyzedSession[] = [];
  let skippedSessions = 0;

  for (const info of infos) {
    try {
      const analyzedSession = await analyzeSession(info, options.range, options.includePrompts);
      if (analyzedSession) analyzedSessions.push(analyzedSession);
    } catch {
      skippedSessions += 1;
    }
  }

  const sessions = analyzedSessions.map((entry) => entry.session);
  const turns = analyzedSessions.flatMap((entry) => entry.turns);
  const usage = sessions.reduce((total, session) => addUsage(total, session.usage), zeroUsage());

  const summary: CostReportSummary = {
    scannedSessions: infos.length,
    includedSessions: sessions.length,
    skippedSessions,
    turns: turns.length,
    usage,
  };

  return {
    generatedAtMs: Date.now(),
    cwd: options.cwd,
    scope: options.scope,
    includePrompts: options.includePrompts,
    range: options.range,
    summary,
    daily: buildTimeAggregates(turns, "day", options.range),
    weekly: buildTimeAggregates(turns, "week", options.range),
    monthly: buildTimeAggregates(turns, "month", options.range),
    models: buildModelAggregates(turns),
    sessions: [...sessions].sort(compareCostDesc),
    topTurns: [...turns].sort(compareCostDesc).slice(0, 20),
  };
}

function listSessionInfos(options: BuildCostReportOptions): Promise<SessionInfo[]> {
  if (options.scope === "project") {
    return SessionManager.list(options.cwd, undefined, options.onProgress);
  }
  return SessionManager.listAll(options.onProgress);
}

async function analyzeSession(
  info: SessionInfo,
  range: ReportRange,
  includePrompts: boolean,
): Promise<AnalyzedSession | undefined> {
  const fileEntries = await readSessionFile(info.path);
  const header = fileEntries.find(isSessionHeader);
  const entries = fileEntries.filter(isSessionEntry);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const name = latestSessionName(entries) ?? info.name;
  const cwd = header?.cwd || info.cwd;
  const sessionId = header?.id || info.id;
  const firstPrompt = includePrompts ? findFirstUserPrompt(entries) || info.firstMessage || "" : "";

  const turns = entries
    .map((entry) =>
      assistantTurnFromEntry(entry, byId, {
        cwd,
        includePrompts,
        name,
        range,
        sessionId,
        sessionPath: info.path,
      }),
    )
    .filter((turn): turn is TurnSummary => Boolean(turn));

  if (turns.length === 0) return undefined;

  const usage = turns.reduce((total, turn) => addUsage(total, turn.usage), zeroUsage());
  const models = [...new Set(turns.map((turn) => turn.modelKey))].sort();
  const timestamps = turns.map((turn) => turn.timestampMs);

  return {
    session: {
      id: sessionId,
      path: info.path,
      cwd,
      name,
      firstPrompt,
      startedAtMs: Math.min(...timestamps),
      lastTurnAtMs: Math.max(...timestamps),
      messageCount: info.messageCount,
      turns: turns.length,
      models,
      usage,
    },
    turns,
  };
}

function assistantTurnFromEntry(
  entry: SessionEntry,
  byId: Map<string, SessionEntry>,
  session: {
    cwd: string;
    includePrompts: boolean;
    name?: string;
    range: ReportRange;
    sessionId: string;
    sessionPath: string;
  },
): TurnSummary | undefined {
  if (!isMessageEntry(entry)) return undefined;
  const message = asRecord(entry.message);
  if (message?.role !== "assistant") return undefined;

  const timestampMs = numberOrUndefined(message.timestamp) ?? Date.parse(entry.timestamp);
  if (!Number.isFinite(timestampMs)) return undefined;
  if (!isInRange(timestampMs, session.range)) return undefined;

  const provider = stringOrFallback(message.provider, "unknown");
  const model = stringOrFallback(message.model, "unknown");
  const usage = normalizeUsage(message.usage);
  const promptExcerpt = session.includePrompts
    ? cleanExcerpt(findNearestUserPrompt(entry, byId) ?? "")
    : "";
  return {
    id: entry.id,
    sessionId: session.sessionId,
    sessionPath: session.sessionPath,
    sessionName: session.name,
    cwd: session.cwd,
    timestampMs,
    dateKey: toLocalDateKey(timestampMs),
    provider,
    model,
    modelKey: `${provider}/${model}`,
    promptExcerpt,
    usage,
  };
}

function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

async function readSessionFile(path: string): Promise<Array<SessionHeader | SessionEntry>> {
  const raw = await readFile(path, "utf8");
  const entries: Array<SessionHeader | SessionEntry> = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isFileEntry(parsed)) entries.push(parsed);
    } catch {
      // Skip malformed JSONL rows so one bad line does not kill whole report.
    }
  }

  return entries;
}

function isFileEntry(value: unknown): value is SessionHeader | SessionEntry {
  const record = asRecord(value);
  if (!record || typeof record.type !== "string" || typeof record.timestamp !== "string")
    return false;
  if (record.type === "session") return typeof record.id === "string";
  return (
    typeof record.id === "string" &&
    (typeof record.parentId === "string" || record.parentId === null)
  );
}

function isSessionHeader(entry: SessionHeader | SessionEntry): entry is SessionHeader {
  return entry.type === "session";
}

function isSessionEntry(entry: SessionHeader | SessionEntry): entry is SessionEntry {
  return entry.type !== "session";
}

function latestSessionName(entries: SessionEntry[]): string | undefined {
  let name: string | undefined;
  for (const entry of entries) {
    if (entry.type === "session_info") name = entry.name;
  }
  return name;
}

function findFirstUserPrompt(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (!isMessageEntry(entry)) continue;
    const message = asRecord(entry.message);
    if (message?.role === "user") return cleanExcerpt(contentToText(message.content));
  }
  return "";
}

function findNearestUserPrompt(
  entry: SessionEntry,
  byId: Map<string, SessionEntry>,
): string | undefined {
  let parentId = entry.parentId;
  let depth = 0;

  while (parentId && depth < 10_000) {
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (isMessageEntry(parent)) {
      const message = asRecord(parent.message);
      if (message?.role === "user") return contentToText(message.content);
    }
    parentId = parent.parentId;
    depth += 1;
  }

  return undefined;
}

function buildModelAggregates(turns: TurnSummary[]): ModelAggregate[] {
  const byModel = new Map<string, ModelAccumulator>();

  for (const turn of turns) {
    const existing = byModel.get(turn.modelKey) ?? {
      key: turn.modelKey,
      provider: turn.provider,
      model: turn.model,
      sessions: new Set<string>(),
      turns: 0,
      usage: zeroUsage(),
    };
    existing.sessions.add(turn.sessionId);
    existing.turns += 1;
    existing.usage = addUsage(existing.usage, turn.usage);
    byModel.set(turn.modelKey, existing);
  }

  return [...byModel.values()]
    .map((item) => ({ ...item, sessions: item.sessions.size }))
    .sort(compareCostDesc);
}

function buildTimeAggregates(
  turns: TurnSummary[],
  grain: "day" | "week" | "month",
  range: ReportRange,
): TimeAggregate[] {
  const byTime = new Map<string, BucketAccumulator>();

  if (grain === "day") seedEmptyDays(byTime, range);

  for (const turn of turns) {
    const key = timeKey(turn.timestampMs, grain);
    const existing = byTime.get(key) ?? {
      key,
      label: timeLabel(key, grain),
      sessions: new Set<string>(),
      turns: 0,
      usage: zeroUsage(),
    };
    existing.sessions.add(turn.sessionId);
    existing.turns += 1;
    existing.usage = addUsage(existing.usage, turn.usage);
    byTime.set(key, existing);
  }

  return [...byTime.values()]
    .map((item) => ({
      key: item.key,
      label: item.label,
      sessions: item.sessions.size,
      turns: item.turns,
      usage: item.usage,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function seedEmptyDays(byTime: Map<string, BucketAccumulator>, range: ReportRange): void {
  if (range.startMs === undefined || range.endMs === undefined) return;
  const dayCount = Math.round((range.endMs - range.startMs) / 86_400_000);
  if (dayCount < 1 || dayCount > 370) return;

  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(range.startMs);
    date.setDate(date.getDate() + index);
    const key = toLocalDateKey(date.getTime());
    byTime.set(key, {
      key,
      label: timeLabel(key, "day"),
      sessions: new Set(),
      turns: 0,
      usage: zeroUsage(),
    });
  }
}

function timeKey(timestampMs: number, grain: "day" | "week" | "month"): string {
  if (grain === "day") return toLocalDateKey(timestampMs);
  const date = new Date(timestampMs);
  if (grain === "month") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return toLocalDateKey(start.getTime());
}

function timeLabel(key: string, grain: "day" | "week" | "month"): string {
  if (grain === "month") {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(
      new Date(year!, month! - 1, 1),
    );
  }

  const date = dateFromKey(key);
  if (grain === "week") {
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return `${formatShortDate(date)}–${formatShortDate(end)}`;
  }

  return formatShortDate(date);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((block) => {
      const record = asRecord(block);
      if (!record) return "";
      if (record.type === "text" && typeof record.text === "string") return record.text;
      if (record.type === "image") return "[image]";
      return "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function normalizeUsage(value: unknown): UsageTotals {
  const record = asRecord(value);
  const cost = asRecord(record?.cost);
  const input = numberOrZero(record?.input);
  const output = numberOrZero(record?.output);
  const cacheRead = numberOrZero(record?.cacheRead);
  const cacheWrite = numberOrZero(record?.cacheWrite);
  const costTotal = numberOrZero(cost?.total);
  const costPartsTotal =
    numberOrZero(cost?.input) +
    numberOrZero(cost?.output) +
    numberOrZero(cost?.cacheRead) +
    numberOrZero(cost?.cacheWrite);
  const tokenPartsTotal = input + output + cacheRead + cacheWrite;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: numberOrZero(record?.totalTokens) || tokenPartsTotal,
    cost: {
      input: numberOrZero(cost?.input),
      output: numberOrZero(cost?.output),
      cacheRead: numberOrZero(cost?.cacheRead),
      cacheWrite: numberOrZero(cost?.cacheWrite),
      total: costTotal || costPartsTotal,
    },
  };
}

function zeroUsage(): UsageTotals {
  return structuredClone(EMPTY_USAGE);
}

function addUsage(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

function compareCostDesc(left: { usage: UsageTotals }, right: { usage: UsageTotals }): number {
  return right.usage.cost.total - left.usage.cost.total;
}

function isInRange(timestampMs: number, range: ReportRange): boolean {
  if (range.startMs !== undefined && timestampMs < range.startMs) return false;
  if (range.endMs !== undefined && timestampMs >= range.endMs) return false;
  return true;
}

function toLocalDateKey(timestampMs: number): string {
  const date = new Date(timestampMs);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function cleanExcerpt(text: string, maxLength = 420): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
