import type { RangePreset, ReportRange, ReportScope } from "./types.js";

export interface CostReportCommandOptions {
  help: boolean;
  includePrompts: boolean;
  open: boolean;
  range: ReportRange;
  scope: ReportScope;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.\.|:)(\d{4}-\d{2}-\d{2})$/;

export const COST_REPORT_USAGE = [
  "Usage: /cost-report [today|week|month|year|all|YYYY-MM-DD|YYYY-MM-DD..YYYY-MM-DD] [project|all-projects] [open] [private]",
  "Examples: /cost-report month open | /cost-report week project | /cost-report 2026-06-01..2026-06-15 private",
].join("\n");

export function parseCostReportArgs(args: string, now = new Date()): CostReportCommandOptions {
  const options: CostReportCommandOptions = {
    help: false,
    includePrompts: true,
    open: false,
    range: currentMonthRange(now),
    scope: "all",
  };

  const tokens = args
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();

    if (token === "help" || token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "open" || token === "--open") {
      options.open = true;
      continue;
    }

    if (token === "private" || token === "redact" || token === "no-prompts") {
      options.includePrompts = false;
      continue;
    }

    if (token === "project" || token === "current" || token === "cwd") {
      options.scope = "project";
      continue;
    }

    if (token === "all-projects" || token === "global") {
      options.scope = "all";
      continue;
    }

    const preset = rangePresetFromToken(token);
    if (preset) {
      options.range = rangeForPreset(preset, now);
      continue;
    }

    const rangeMatch = RANGE_PATTERN.exec(token);
    if (rangeMatch) {
      options.range = customRange(rangeMatch[1]!, rangeMatch[2]!);
      continue;
    }

    if (DATE_PATTERN.test(token)) {
      options.range = customRange(token, token);
      continue;
    }

    throw new Error(`Unknown cost-report argument: ${rawToken}\n${COST_REPORT_USAGE}`);
  }

  return options;
}

function rangePresetFromToken(token: string): RangePreset | undefined {
  switch (token) {
    case "today":
    case "day":
    case "daily":
      return "today";
    case "week":
    case "weekly":
      return "week";
    case "month":
    case "monthly":
      return "month";
    case "year":
    case "yearly":
      return "year";
    case "all":
    case "all-time":
      return "all";
    default:
      return undefined;
  }
}

function rangeForPreset(preset: RangePreset, now: Date): ReportRange {
  switch (preset) {
    case "today":
      return todayRange(now);
    case "week":
      return currentWeekRange(now);
    case "month":
      return currentMonthRange(now);
    case "year":
      return currentYearRange(now);
    case "all":
      return { preset, label: "All time", slug: "all-time" };
    case "custom":
      throw new Error("custom preset requires explicit dates");
  }
}

function todayRange(now: Date): ReportRange {
  const start = startOfLocalDay(now);
  const end = addDays(start, 1);
  const key = dateKey(start);
  return {
    preset: "today",
    label: `Today · ${formatDateLabel(start)}`,
    slug: key,
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function currentWeekRange(now: Date): ReportRange {
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = addDays(start, 7);
  return {
    preset: "week",
    label: `Week of ${formatDateLabel(start)}`,
    slug: `week-${dateKey(start)}`,
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function currentMonthRange(now: Date): ReportRange {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    preset: "month",
    label: formatMonthLabel(start),
    slug: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function currentYearRange(now: Date): ReportRange {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear() + 1, 0, 1);
  return {
    preset: "year",
    label: String(now.getFullYear()),
    slug: String(now.getFullYear()),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function customRange(startKey: string, endKey: string): ReportRange {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end || start.getTime() > end.getTime()) {
    throw new Error(`Invalid date range: ${startKey}..${endKey}\n${COST_REPORT_USAGE}`);
  }

  const exclusiveEnd = addDays(end, 1);
  return {
    preset: "custom",
    label:
      startKey === endKey
        ? formatDateLabel(start)
        : `${formatDateLabel(start)} – ${formatDateLabel(end)}`,
    slug: startKey === endKey ? startKey : `${startKey}_to_${endKey}`,
    startMs: start.getTime(),
    endMs: exclusiveEnd.getTime(),
  };
}

function parseDateKey(value: string): Date | undefined {
  const match = DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}
