import { isAbsolute, relative } from "node:path";
import { renderBlockingDiagnostics } from "./agents.js";
import type { AgentIssue, RunResult, ToolActivity, Workflow, WorkflowResult } from "./types.js";

const PREVIEW_KEYS = [
  "command",
  "query",
  "pattern",
  "url",
  "path",
  "input",
  "task",
  "agent",
] as const;

type CollapsibleBlock = {
  collapsedText: string;
  expandedText?: string;
  footer?: string;
};

type WorkflowShape =
  | Workflow
  | {
      mode: Workflow["mode"];
      runs?: Array<{ agent: string; prompt?: string }>;
      items?: Array<{ agent: string; prompt: string }>;
      chain?: Array<{ agent: string; task?: string }>;
      tasks?: Array<{ agent: string; task?: string }>;
      agent?: string;
      task?: string;
    };

type WorkflowPromptItem = { agent: string; prompt: string };
type WorkflowAgentItem = { agent: string; prompt?: string };
type WorkflowTaskItem = { agent: string; task?: string };

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateMultilineText(value: string, maxLines: number, maxWidth: number): string {
  const lines = value
    .trim()
    .split("\n")
    .map((line) => normalizeInline(line));
  const visible = lines.slice(0, maxLines).map((line) => truncateText(line, maxWidth));
  if (lines.length <= maxLines) return visible.join("\n");
  const last = visible[maxLines - 1] || "";
  visible[maxLines - 1] = truncateText(last, Math.max(1, maxWidth - 1));
  return `${visible.join("\n")}…`;
}

function subtitleFromTask(task: string | undefined): string | undefined {
  if (!task) return undefined;
  const normalized = normalizeInline(task);
  return normalized ? truncateText(normalized, 48) : undefined;
}

function getWorkflowItems(workflow: WorkflowShape): WorkflowPromptItem[] | undefined {
  return "items" in workflow ? workflow.items : undefined;
}

function getWorkflowRuns(workflow: WorkflowShape): WorkflowAgentItem[] | undefined {
  return "runs" in workflow ? workflow.runs : undefined;
}

function getWorkflowChain(workflow: WorkflowShape): WorkflowTaskItem[] | undefined {
  return "chain" in workflow ? workflow.chain : undefined;
}

function getWorkflowTasks(workflow: WorkflowShape): WorkflowTaskItem[] | undefined {
  return "tasks" in workflow ? workflow.tasks : undefined;
}

export function formatWorkflowLabel(workflow: WorkflowShape): string {
  const items = getWorkflowItems(workflow);
  const runs = getWorkflowRuns(workflow);
  const chain = getWorkflowChain(workflow);
  const tasks = getWorkflowTasks(workflow);
  const subtitle =
    workflow.mode === "single"
      ? subtitleFromTask("task" in workflow ? workflow.task : items?.[0]?.prompt)
      : workflow.mode === "chain"
        ? subtitleFromTask(chain?.length ? chain[0]?.task : items?.[0]?.prompt)
        : subtitleFromTask(tasks?.length ? tasks[0]?.task : items?.[0]?.prompt);
  if (workflow.mode === "single") {
    const name = "agent" in workflow ? workflow.agent : runs?.[0]?.agent;
    const base = name ? `subagent · ${name}` : "subagent";
    return subtitle ? `${base} (${subtitle})` : base;
  }
  if (workflow.mode === "chain") {
    const names =
      chain?.map((item) => item.agent) ??
      items?.map((item) => item.agent) ??
      runs?.map((item) => item.agent) ??
      [];
    const base = names.length ? `subagent · ${truncateText(names.join(" → "), 72)}` : "subagent";
    return subtitle ? `${base} (${subtitle})` : base;
  }
  const count = tasks?.length ?? items?.length ?? runs?.length ?? 0;
  const base = `subagent · ${count} task${count === 1 ? "" : "s"}`;
  return subtitle ? `${base} (${subtitle})` : base;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "0ms";
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function getRunStatus(run: RunResult): "ok" | "failed" {
  return run.exitCode === 0 && run.stopReason !== "error" && run.stopReason !== "aborted"
    ? "ok"
    : "failed";
}

function relativizePath(value: string, cwd: string): string {
  if (!value || !isAbsolute(value)) return value;
  const relativePath = relative(cwd, value);
  return relativePath && !relativePath.startsWith("..") ? relativePath || "." : value;
}

function parsePreviewValue(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstString(object: Record<string, unknown>): string | undefined {
  for (const key of PREVIEW_KEYS) {
    const value = object[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readQuotedValue(text: string, key: string): string | undefined {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex === -1) return undefined;
  const colonIndex = text.indexOf(":", keyIndex + key.length + 2);
  if (colonIndex === -1) return undefined;
  let valueIndex = colonIndex + 1;
  while (valueIndex < text.length && /\s/.test(text[valueIndex] || "")) valueIndex += 1;
  if (text[valueIndex] !== '"') return undefined;
  let escaped = false;
  let value = "";
  for (let index = valueIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') return value;
    value += char;
  }
  return undefined;
}

function formatPreview(value: string, cwd: string): string {
  return (isAbsolute(value) ? relativizePath(value, cwd) : value).replace(/\s+/g, " ").trim();
}

export function renderToolAction(name: string, args: string | undefined, cwd: string): string {
  const title = name
    .split(/[_-]/g)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join("");
  const parsed = parsePreviewValue(args);
  if (typeof parsed === "string") {
    const preview = PREVIEW_KEYS.map((key) => readQuotedValue(parsed, key)).find(Boolean) || parsed;
    return `${title}(${truncateText(formatPreview(preview, cwd), 80)})`;
  }
  if (!parsed || typeof parsed !== "object") return `${title}(...)`;
  const preview = firstString(parsed as Record<string, unknown>);
  return preview ? `${title}(${truncateText(formatPreview(preview, cwd), 80)})` : `${title}(...)`;
}

function renderActivity(item: ToolActivity, cwd: string): string {
  const action = renderToolAction(item.name, item.args, cwd);
  return item.status === "error"
    ? `${action} · error: ${truncateText(item.preview || "failed", 100)}`
    : action;
}

function renderDebug(debug: Record<string, unknown> | undefined): string {
  if (!debug) return "";
  return [
    "Debug:",
    ...JSON.stringify(debug, null, 2)
      .split("\n")
      .map((line) => `  ${line}`),
  ].join("\n");
}

function isRunning(result: WorkflowResult): boolean {
  return (result.done ?? 0) < (result.total ?? result.items.length);
}

function countToolUses(result: WorkflowResult): number {
  return result.runs.reduce((count, run) => count + run.events.length, 0);
}

function formatToolUses(count: number): string {
  return `${count} tool use${count === 1 ? "" : "s"}`;
}

function formatFooter(result: WorkflowResult): string | undefined {
  if (result.runs.length === 0) return "Starting";
  if (isRunning(result)) {
    const hasActivity = result.runs.some(
      (run) => run.events.length > 0 || run.activeTools.length > 0 || Boolean(run.liveText?.trim()),
    );
    return hasActivity ? "Running..." : "Starting";
  }
  const prefix = hasFailedRun(result) ? "Failed" : "Done";
  const primaryCount = `${result.items.length} ${result.mode === "single" ? "run" : result.mode === "chain" ? "step" : "task"}${result.items.length === 1 ? "" : "s"}`;
  return `${prefix} · ${primaryCount} · ${formatToolUses(countToolUses(result))} · ${formatDuration(result.durationMs)}`;
}

function joinBodyFooter(body: string, footer?: string): string {
  return [body.trimEnd(), footer].filter(Boolean).join("\n");
}

function pushBlock(lines: string[], title: string, body?: string, indent = ""): void {
  if (!body?.trim()) return;
  lines.push(`${indent}${title}:`);
  lines.push(
    ...body
      .trimEnd()
      .split("\n")
      .map((line) => `${indent}  ${line}`),
  );
}

function latestActivity(run: RunResult): string | undefined {
  const active = run.activeTools.at(-1);
  if (active) return renderActivity(active, run.cwd);
  const recent = run.events.at(-1);
  if (recent) return renderActivity(recent, run.cwd);
  if (run.liveText?.trim()) return truncateMultilineText(run.liveText, 1, 80);
  return undefined;
}

function visibleActivities(run: RunResult, limit: number): string[] {
  const active = run.activeTools.map((item) => renderActivity(item, run.cwd));
  const recent = run.events.slice(-limit).map((item) => renderActivity(item, run.cwd));
  const merged = [...active, ...recent];
  return merged.slice(0, limit);
}

function renderSingleCollapsed(result: WorkflowResult): string {
  const run = result.runs[0];
  if (!run) return "";
  if (
    !run.done &&
    run.events.length === 0 &&
    run.activeTools.length === 0 &&
    !run.liveText?.trim()
  ) {
    return "";
  }
  if (run.done && getRunStatus(run) === "failed") {
    return run.events.length > 0
      ? run.events
          .slice(-1)
          .map((item) => renderActivity(item, run.cwd))
          .join("\n")
      : truncateMultilineText(run.error || run.stderr.trim() || "failed", 2, 120);
  }
  const lines = visibleActivities(run, 3);
  const hiddenCount = run.events.length + run.activeTools.length - lines.length;
  if (hiddenCount > 0) lines.push(`+${hiddenCount} more tool use${hiddenCount === 1 ? "" : "s"}`);
  if (lines.length === 0 && run.output.trim())
    lines.push(truncateMultilineText(run.output, 3, 120));
  return lines.join("\n");
}

function renderSingleExpanded(result: WorkflowResult): string {
  const run = result.runs[0];
  if (!run) return "";
  const lines: string[] = [];
  pushBlock(lines, "Prompt", run.prompt);
  if (run.events.length > 0 || run.activeTools.length > 0) {
    if (lines.length) lines.push("");
    for (const item of run.events) lines.push(renderActivity(item, run.cwd));
    for (const item of run.activeTools) lines.push(renderActivity(item, run.cwd));
  }
  if (run.done && getRunStatus(run) === "ok") {
    if (lines.length) lines.push("");
    pushBlock(lines, "Response", run.output);
  }
  if (run.error || run.stderr.trim()) {
    if (lines.length) lines.push("");
    pushBlock(lines, "Error", run.error || run.stderr.trim());
  }
  if (run.debug) {
    if (lines.length) lines.push("");
    lines.push(renderDebug(run.debug));
  }
  return lines.join("\n").trimEnd();
}

function rowLabel(result: WorkflowResult, index: number): string {
  const item = result.items[index];
  if (!item) return `${index + 1}. task`;
  const repeated = result.items.filter((candidate) => candidate.agent === item.agent).length > 1;
  return repeated || result.mode === "parallel" ? `${index + 1}. ${item.agent}` : item.agent;
}

function renderStatusRow(label: string, run: RunResult | undefined): string {
  if (!run) return `${label} · Waiting`;
  if (!run.done) {
    const activity = latestActivity(run);
    return `${label} · ${activity || "Starting"}`;
  }
  if (getRunStatus(run) === "failed") return `${label} · Failed`;
  return `${label} · Done`;
}

function renderRowsCollapsed(result: WorkflowResult): string {
  return result.items
    .map((_, index) => renderStatusRow(rowLabel(result, index), result.runs[index]))
    .join("\n");
}

function pushTranscriptSection(
  lines: string[],
  heading: string,
  options: {
    prompt?: string;
    responseLabel?: "Response" | "Handoff";
    responseText?: string;
    errorText?: string;
    waiting?: boolean;
    activities?: string[];
  },
): void {
  lines.push(heading);
  if (options.waiting) {
    lines.push("  Waiting");
    return;
  }
  pushBlock(lines, "Prompt", options.prompt, "  ");
  if (options.activities?.length) {
    if (lines.at(-1) !== heading) lines.push("");
    for (const item of options.activities) lines.push(`  ${item}`);
  }
  if (options.responseLabel && options.responseText?.trim()) {
    if (lines.at(-1) !== heading) lines.push("");
    pushBlock(lines, options.responseLabel, options.responseText, "  ");
  }
  if (options.errorText?.trim()) {
    if (lines.at(-1) !== heading) lines.push("");
    pushBlock(lines, "Error", options.errorText, "  ");
  }
}

function renderChainExpanded(result: WorkflowResult): string {
  const lines: string[] = [];
  for (let index = 0; index < result.items.length; index += 1) {
    const item = result.items[index];
    const run = result.runs[index];
    if (index > 0) lines.push("");
    if (!item) continue;
    if (!run) {
      pushTranscriptSection(lines, `Step ${index + 1} · ${item.agent}`, {
        waiting: true,
      });
      continue;
    }
    pushTranscriptSection(lines, `Step ${index + 1} · ${item.agent}`, {
      prompt: run.prompt,
      activities: [
        ...run.events.map((event) => renderActivity(event, run.cwd)),
        ...run.activeTools.map((event) => renderActivity(event, run.cwd)),
      ],
      responseLabel: run.done && getRunStatus(run) === "ok" ? "Handoff" : undefined,
      responseText: run.done && getRunStatus(run) === "ok" ? run.output : undefined,
      errorText: getRunStatus(run) === "failed" ? run.error || run.stderr.trim() : undefined,
    });
  }
  return lines.join("\n").trimEnd();
}

function renderParallelExpanded(result: WorkflowResult): string {
  const lines: string[] = [];
  for (let index = 0; index < result.items.length; index += 1) {
    const item = result.items[index];
    const run = result.runs[index];
    if (index > 0) lines.push("");
    if (!item) continue;
    if (!run) {
      pushTranscriptSection(lines, `Task ${index + 1} · ${item.agent}`, {
        prompt: item.prompt,
        waiting: true,
      });
      continue;
    }
    pushTranscriptSection(lines, `Task ${index + 1} · ${item.agent}`, {
      prompt: run.prompt,
      activities: [
        ...run.events.map((event) => renderActivity(event, run.cwd)),
        ...run.activeTools.map((event) => renderActivity(event, run.cwd)),
      ],
      responseLabel: run.done && getRunStatus(run) === "ok" ? "Response" : undefined,
      responseText: run.done && getRunStatus(run) === "ok" ? run.output : undefined,
      errorText: getRunStatus(run) === "failed" ? run.error || run.stderr.trim() : undefined,
      waiting: false,
    });
  }
  return lines.join("\n").trimEnd();
}

export function renderWorkflowBlock(result: WorkflowResult): CollapsibleBlock {
  const footer = formatFooter(result);
  if (result.mode === "single") {
    return {
      collapsedText: renderSingleCollapsed(result),
      expandedText: renderSingleExpanded(result),
      footer,
    };
  }
  if (result.mode === "chain") {
    return {
      collapsedText: renderRowsCollapsed(result),
      expandedText: renderChainExpanded(result),
      footer,
    };
  }
  return {
    collapsedText: renderRowsCollapsed(result),
    expandedText: renderParallelExpanded(result),
    footer,
  };
}

function hasFailedRun(result: WorkflowResult): boolean {
  return result.runs.some((run) => getRunStatus(run) === "failed");
}

export function renderWorkflow(result: WorkflowResult, expanded: boolean): string {
  const block = renderWorkflowBlock(result);
  return joinBodyFooter(
    expanded ? (block.expandedText ?? block.collapsedText) : block.collapsedText,
    block.footer,
  );
}

export function renderWorkflowSummary(result: WorkflowResult): string {
  const block = renderWorkflowBlock(result);
  return joinBodyFooter(block.collapsedText, block.footer);
}

export function hasExpandableContent(result: WorkflowResult): boolean {
  const block = renderWorkflowBlock(result);
  return Boolean(
    block.expandedText?.trim() && block.expandedText.trim() !== block.collapsedText.trim(),
  );
}

export function renderDetails(
  details: WorkflowResult | { diagnostics: AgentIssue[] } | undefined,
  expanded: boolean,
): string {
  if (!details) return "";
  return "diagnostics" in details
    ? renderBlockingDiagnostics(details.diagnostics)
    : renderWorkflow(details, expanded);
}

export function getResultColor(
  details: WorkflowResult | { diagnostics: AgentIssue[] } | undefined,
  isError?: boolean,
): "error" | "warning" | "toolOutput" {
  if (isError) return "error";
  if (!details) return "toolOutput";
  if ("diagnostics" in details) {
    return details.diagnostics.some((item) => item.level === "error") ? "error" : "warning";
  }
  return hasFailedRun(details) ? "error" : "toolOutput";
}
