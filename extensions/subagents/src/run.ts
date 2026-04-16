import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { isSubagentDebugEnabled } from "./debug.js";
import type {
  AgentSpec,
  RunResult,
  ToolActivity,
  Usage,
  Workflow,
  WorkflowResult,
} from "./types.js";

type RunAgentOptions = {
  defaultCwd: string;
  agent: AgentSpec;
  prompt: string;
  task: string;
  receivedHandoff?: string;
  parentActiveTools?: string[];
  cwd?: string;
  signal?: AbortSignal;
  onUpdate?: (run: RunResult) => void;
};

type ExecuteWorkflowOptions = {
  defaultCwd: string;
  agents: AgentSpec[];
  workflow: Workflow;
  parentActiveTools?: string[];
  signal?: AbortSignal;
  onUpdate?: (result: WorkflowResult) => void;
};

type AssistantMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number };
  };
  model?: string;
  stopReason?: string;
  errorMessage?: string;
};

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;

function createUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function cloneActivities(items: ToolActivity[]): ToolActivity[] {
  return items.map((item) => ({ ...item }));
}

function cloneRun(run: RunResult): RunResult {
  return {
    ...run,
    usage: { ...run.usage },
    activeTools: cloneActivities(run.activeTools),
    events: cloneActivities(run.events),
    debug: run.debug ? { ...run.debug } : undefined,
  };
}

function truncatePreview(value: unknown, maxLength = 120): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return undefined;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function getAssistantText(message: AssistantMessage | undefined): string {
  if (message?.role !== "assistant") return "";
  for (const part of message.content ?? []) {
    if (part.type === "text" && typeof part.text === "string") return part.text;
  }
  return "";
}

function applyAssistantMessage(result: RunResult, message: AssistantMessage | undefined): void {
  if (message?.role !== "assistant") return;
  result.usage.turns += 1;
  if (message.usage) {
    result.usage.input += message.usage.input || 0;
    result.usage.output += message.usage.output || 0;
    result.usage.cacheRead += message.usage.cacheRead || 0;
    result.usage.cacheWrite += message.usage.cacheWrite || 0;
    result.usage.cost += message.usage.cost?.total || 0;
    result.usage.contextTokens = message.usage.totalTokens || result.usage.contextTokens;
  }
  if (!result.model && message.model) result.model = message.model;
  result.stopReason = message.stopReason;
  result.error = message.errorMessage;
  const text = getAssistantText(message);
  if (text) result.output = text;
}

function finalizeRun(session: AgentSession, result: RunResult): void {
  let latestAssistant: AssistantMessage | undefined;
  for (const message of session.messages as AssistantMessage[]) {
    if (message.role !== "assistant") continue;
    latestAssistant = message;
  }
  result.model = session.model?.id || result.model;
  result.output =
    getAssistantText(latestAssistant) || result.output || result.error || result.stderr.trim();
  if (latestAssistant) {
    if (!result.model && latestAssistant.model) result.model = latestAssistant.model;
    result.stopReason = latestAssistant.stopReason;
    result.error = latestAssistant.errorMessage;
  }
}

function resolveRequestedTools(
  agentTools: string[] | undefined,
  parentTools: string[] | undefined,
): string[] | undefined {
  if (agentTools) return [...agentTools];
  if (parentTools) return [...parentTools];
  return undefined;
}

function validateRequestedTools(requestedTools: string[], availableTools: string[]): void {
  const available = new Set(availableTools);
  const missing = requestedTools.filter((name) => !available.has(name));
  if (missing.length === 0) return;
  throw new Error(
    `Unknown requested tool${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Available tools: ${availableTools.join(", ") || "none"}`,
  );
}

function resolveModel(session: AgentSession, requested: string | undefined) {
  if (!requested) return undefined;
  if (requested.includes("/")) {
    const [provider, ...rest] = requested.split("/");
    const id = rest.join("/");
    if (provider && id) return session.modelRegistry.find(provider, id);
  }
  return session.modelRegistry.getAll().find((model) => model.id === requested);
}

function cloneActiveTools(activeTools: Map<string, ToolActivity>): ToolActivity[] {
  return [...activeTools.values()].map((item) => ({ ...item }));
}

function publishRun(
  result: RunResult,
  liveText: string,
  activeTools: Map<string, ToolActivity>,
  events: ToolActivity[],
  onUpdate: RunAgentOptions["onUpdate"],
): void {
  result.liveText = liveText.trim() || undefined;
  result.activeTools = cloneActiveTools(activeTools);
  result.events = cloneActivities(events);
  if (result.liveText) result.output = result.liveText;
  onUpdate?.(cloneRun(result));
}

function buildDebugInfo(
  session: AgentSession,
  loader: DefaultResourceLoader,
  task: string,
  providerPayload: unknown,
): Record<string, unknown> {
  const allTools = session.getAllTools();
  const activeTools = session.getActiveToolNames();
  const activeToolSet = new Set(activeTools);
  return {
    model: session.model?.id,
    thinkingLevel: session.thinkingLevel,
    task,
    systemPrompt: session.agent.state.systemPrompt,
    appendSystemPromptParts: loader.getAppendSystemPrompt(),
    activeTools,
    availableTools: allTools.map((tool) => tool.name),
    activeToolInfos: allTools
      .filter((tool) => activeToolSet.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        source: tool.sourceInfo.source,
      })),
    agentsFiles: loader.getAgentsFiles().agentsFiles,
    providerPayload,
  };
}

async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const cwd = options.cwd ?? options.defaultCwd;
  const result: RunResult = {
    agent: options.agent.name,
    source: options.agent.source,
    prompt: options.prompt,
    receivedHandoff: options.receivedHandoff,
    task: options.task,
    cwd,
    output: "",
    stderr: "",
    exitCode: 0,
    usage: createUsage(),
    model: options.agent.model,
    done: false,
    activeTools: [],
    events: [],
  };
  const startedAt = Date.now();
  let session: AgentSession | undefined;
  let unsubscribe = () => {};
  let abortListener: (() => void) | undefined;
  let aborted = false;
  let providerPayload: unknown;
  let liveText = "";
  const activeTools = new Map<string, ToolActivity>();
  const events: ToolActivity[] = [];
  const loader = new DefaultResourceLoader({
    cwd,
    extensionFactories: isSubagentDebugEnabled()
      ? [
          (pi) => {
            pi.on("before_provider_request", (event) => {
              providerPayload = event.payload;
            });
          },
        ]
      : [],
    appendSystemPromptOverride: (base) =>
      options.agent.promptText.trim() ? [...base, options.agent.promptText] : base,
  });

  try {
    await loader.reload();
    const created = await createAgentSession({
      cwd,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
    });
    session = created.session;

    const model = resolveModel(session, options.agent.model);
    if (model) await session.setModel(model);
    if (options.agent.thinkingLevel) session.setThinkingLevel(options.agent.thinkingLevel);
    result.model = session.model?.id || result.model;

    const requestedTools = resolveRequestedTools(options.agent.tools, options.parentActiveTools);
    const availableTools = session.getAllTools().map((tool) => tool.name);
    if (requestedTools) {
      validateRequestedTools(requestedTools, availableTools);
      session.setActiveToolsByName(requestedTools);
    }

    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        liveText += event.assistantMessageEvent.delta;
        publishRun(result, liveText, activeTools, events, options.onUpdate);
        return;
      }

      if (event.type === "tool_execution_start") {
        activeTools.set(event.toolCallId, {
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          args: truncatePreview(event.args),
        });
        publishRun(result, liveText, activeTools, events, options.onUpdate);
        return;
      }

      if (event.type === "tool_execution_update") {
        const existing = activeTools.get(event.toolCallId);
        if (!existing) return;
        activeTools.set(event.toolCallId, {
          ...existing,
          preview: truncatePreview(event.partialResult),
        });
        publishRun(result, liveText, activeTools, events, options.onUpdate);
        return;
      }

      if (event.type === "tool_execution_end") {
        const existing = activeTools.get(event.toolCallId);
        const finished: ToolActivity = {
          id: event.toolCallId,
          name: event.toolName,
          status: event.isError ? "error" : "done",
          args: existing?.args,
          preview: truncatePreview(event.result),
        };
        activeTools.delete(event.toolCallId);
        events.push(finished);
        publishRun(result, liveText, activeTools, events, options.onUpdate);
        return;
      }

      if (event.type === "message_end") {
        applyAssistantMessage(result, event.message as AssistantMessage);
        liveText = "";
        publishRun(result, liveText, activeTools, events, options.onUpdate);
        return;
      }

      if (event.type === "agent_end") {
        liveText = "";
        publishRun(result, liveText, activeTools, events, options.onUpdate);
      }
    });

    const abort = () => {
      aborted = true;
      void session?.abort().catch(() => {});
    };
    abortListener = abort;
    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }

    if (aborted) throw new Error("Subagent was aborted");
    await session.prompt(options.task);
    if (aborted) throw new Error("Subagent was aborted");

    if (isSubagentDebugEnabled()) {
      result.debug = buildDebugInfo(session, loader, options.task, providerPayload);
    }

    finalizeRun(session, result);
    result.done = true;
    result.durationMs = Date.now() - startedAt;
    publishRun(result, "", activeTools, events, options.onUpdate);
    return cloneRun(result);
  } catch (error) {
    if (session) finalizeRun(session, result);
    if (isSubagentDebugEnabled() && session) {
      result.debug = buildDebugInfo(session, loader, options.task, providerPayload);
    }
    result.error = error instanceof Error ? error.message : String(error);
    result.exitCode = 1;
    result.done = true;
    result.durationMs = Date.now() - startedAt;
    if (aborted) throw new Error("Subagent was aborted");
    return cloneRun(result);
  } finally {
    unsubscribe();
    if (options.signal && abortListener) options.signal.removeEventListener("abort", abortListener);
    try {
      session?.dispose();
    } catch {}
  }
}

function resolveAgent(agents: AgentSpec[], name: string): AgentSpec {
  const agent = agents.find((item) => item.name === name);
  if (agent) return agent;
  throw new Error(
    `Unknown agent: "${name}". Available agents: ${agents.map((item) => item.name).join(", ") || "none"}.`,
  );
}

function buildTaskPrompt(task: string): string {
  return ["Task:", task.trim()].join("\n");
}

function buildChainPrompt(task: string, handoff?: string): string {
  if (!handoff) return buildTaskPrompt(task);
  return ["Task:", task.trim(), "", "Received handoff:", "```text", handoff, "```"].join("\n");
}

function sumUsage(runs: RunResult[]): Usage {
  const usage = createUsage();
  for (const run of runs) {
    usage.input += run.usage.input;
    usage.output += run.usage.output;
    usage.cacheRead += run.usage.cacheRead;
    usage.cacheWrite += run.usage.cacheWrite;
    usage.cost += run.usage.cost;
    usage.contextTokens += run.usage.contextTokens;
    usage.turns += run.usage.turns;
  }
  return usage;
}

function buildWorkflowOutput(mode: WorkflowResult["mode"], runs: RunResult[]): string {
  if (runs.length === 0) return "";
  if (mode !== "parallel") return runs.at(-1)?.output || "";
  return runs
    .map((run, index) =>
      [
        `[${index + 1}] ${run.agent}`,
        run.output || run.error || run.stderr.trim() || "(no output)",
      ].join("\n"),
    )
    .join("\n\n");
}

function cloneRuns(runs: RunResult[]): RunResult[] {
  return runs.map(cloneRun);
}

async function mapWithConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await fn(items[index], index);
      }
    }),
  );
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<WorkflowResult> {
  const startedAt = Date.now();
  const items =
    options.workflow.mode === "single"
      ? [{ agent: options.workflow.agent, prompt: options.workflow.task }]
      : options.workflow.mode === "chain"
        ? options.workflow.chain.map((item) => ({ agent: item.agent, prompt: item.task }))
        : options.workflow.tasks.map((item) => ({ agent: item.agent, prompt: item.task }));
  const debugProgress: Record<string, unknown>[] = [];
  let seq = 0;
  const recordDebugProgress = (result: WorkflowResult): WorkflowResult => {
    if (!isSubagentDebugEnabled()) return result;
    const active = result.runs.at(-1);
    debugProgress.push({
      seq: ++seq,
      done: result.done ?? 0,
      total: result.total ?? 0,
      mode: result.mode,
      activeAgent: active?.agent,
      activeTools: active?.activeTools.map((item) => item.name) ?? [],
      recentTools: active?.events.slice(-5).map((item) => item.name) ?? [],
      liveText: active?.liveText,
      outputPreview: active?.output,
    });
    return { ...result, debug: { progress: debugProgress.map((item) => ({ ...item })) } };
  };

  const emit = (mode: WorkflowResult["mode"], runs: RunResult[], done: number, total: number) => {
    if (!options.onUpdate) return;
    const result: WorkflowResult = {
      mode,
      items,
      runs: cloneRuns(runs),
      output: buildWorkflowOutput(mode, runs),
      usage: sumUsage(runs),
      done,
      total,
      durationMs: Date.now() - startedAt,
    };
    options.onUpdate(recordDebugProgress(result));
  };

  if (options.workflow.mode !== "parallel") {
    const tasks =
      options.workflow.mode === "single"
        ? [
            {
              agent: options.workflow.agent,
              task: options.workflow.task,
              cwd: options.workflow.cwd,
            },
          ]
        : options.workflow.chain;
    const runs: RunResult[] = [];
    let handoff = "";
    for (const [index, task] of tasks.entries()) {
      const agent = resolveAgent(options.agents, task.agent);
      const prompt = task.task;
      const receivedHandoff = options.workflow.mode === "chain" ? handoff || undefined : undefined;
      const effectiveTask =
        options.workflow.mode === "chain"
          ? buildChainPrompt(prompt, receivedHandoff)
          : buildTaskPrompt(prompt);
      const run = await runAgent({
        defaultCwd: options.defaultCwd,
        agent,
        prompt,
        receivedHandoff,
        task: effectiveTask,
        cwd: task.cwd,
        parentActiveTools: options.parentActiveTools,
        signal: options.signal,
        onUpdate: (update) => emit(options.workflow.mode, [...runs, update], index, tasks.length),
      });
      runs.push(run);
      handoff = run.output;
      emit(options.workflow.mode, runs, index + 1, tasks.length);
      if (
        options.workflow.mode === "chain" &&
        (run.exitCode !== 0 || run.stopReason === "error" || run.stopReason === "aborted")
      ) {
        break;
      }
    }
    return recordDebugProgress({
      mode: options.workflow.mode,
      items,
      runs,
      output: buildWorkflowOutput(options.workflow.mode, runs),
      usage: sumUsage(runs),
      done: runs.length,
      total: tasks.length,
      durationMs: Date.now() - startedAt,
    });
  }

  const total = options.workflow.tasks.length;
  if (total === 0) throw new Error("Parallel workflow requires at least 1 task.");
  if (total > MAX_PARALLEL_TASKS) {
    throw new Error(`Parallel task limit exceeded: ${total}. Max: ${MAX_PARALLEL_TASKS}.`);
  }
  const concurrency = Math.max(
    1,
    Math.min(options.workflow.concurrency ?? Math.min(total, MAX_CONCURRENCY), MAX_CONCURRENCY),
  );
  const slots = Array<RunResult | undefined>(total).fill(undefined);
  let done = 0;

  await mapWithConcurrencyLimit(options.workflow.tasks, concurrency, async (task, index) => {
    const run = await runAgent({
      defaultCwd: options.defaultCwd,
      agent: resolveAgent(options.agents, task.agent),
      prompt: task.task,
      task: buildTaskPrompt(task.task),
      cwd: task.cwd,
      parentActiveTools: options.parentActiveTools,
      signal: options.signal,
      onUpdate: (update) => {
        slots[index] = update;
        emit(
          "parallel",
          slots.filter((item): item is RunResult => Boolean(item)),
          done,
          total,
        );
      },
    });
    slots[index] = run;
    done += 1;
    emit(
      "parallel",
      slots.filter((item): item is RunResult => Boolean(item)),
      done,
      total,
    );
  });

  const runs = slots.filter((item): item is RunResult => Boolean(item));
  return recordDebugProgress({
    mode: "parallel",
    items,
    runs,
    output: buildWorkflowOutput("parallel", runs),
    usage: sumUsage(runs),
    done,
    total,
    durationMs: Date.now() - startedAt,
  });
}
