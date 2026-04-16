import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { renderCollapsibleTextResult } from "../../shared/ui/collapsible-text-result.js";
import { notifyForSessionStart } from "../../shared/ui/notify.js";
import {
  collectRegistryDiagnostics,
  formatDiagnosticSummary,
  renderDoctorReport,
  renderListReport,
  resolveRunnableAgents,
  clearAgentRegistryCache,
  discoverAgents,
} from "./agents.js";
import { isSubagentDebugEnabled, setSubagentDebugEnabled } from "./debug.js";
import {
  renderDetails,
  formatWorkflowLabel,
  getResultColor,
  renderWorkflowBlock,
  renderWorkflowSummary,
  renderWorkflow,
} from "./render.js";
import { executeWorkflow } from "./run.js";
import type { AgentIssue, Workflow, WorkflowResult } from "./types.js";

const WORKFLOW_MODE_SCHEMA = StringEnum(["single", "chain", "parallel"] as const, {
  description: "Execution mode. Exactly one of single/chain/parallel shapes must be provided.",
});

const STEP_SCHEMA = Type.Object({
  agent: Type.String({ description: "Agent name" }),
  task: Type.String({ description: "Task to delegate" }),
  cwd: Type.Optional(Type.String({ description: "Optional working directory override" })),
});

const TOOL_PARAMS = Type.Object({
  mode: Type.Optional(WORKFLOW_MODE_SCHEMA),
  agent: Type.Optional(Type.String({ description: "Agent name for single mode" })),
  task: Type.Optional(Type.String({ description: "Task for single mode" })),
  cwd: Type.Optional(
    Type.String({ description: "Optional working directory override for single mode" }),
  ),
  chain: Type.Optional(Type.Array(STEP_SCHEMA, { description: "Sequential chain steps" })),
  tasks: Type.Optional(Type.Array(STEP_SCHEMA, { description: "Parallel task list" })),
  concurrency: Type.Optional(Type.Number({ description: "Parallel concurrency override" })),
});

function resolveWorkflow(params: Record<string, unknown>): Workflow {
  const chain = Array.isArray(params.chain) ? params.chain : undefined;
  const tasks = Array.isArray(params.tasks) ? params.tasks : undefined;
  const agent = typeof params.agent === "string" ? params.agent : undefined;
  const task = typeof params.task === "string" ? params.task : undefined;
  const hasSingle = Boolean(agent && task);
  const hasChain = Boolean(chain?.length);
  const hasTasks = Boolean(tasks?.length);
  if (Number(hasSingle) + Number(hasChain) + Number(hasTasks) !== 1) {
    throw new Error("Provide exactly one workflow shape: single, chain, or parallel.");
  }
  const mode = hasSingle ? "single" : hasChain ? "chain" : "parallel";
  if (typeof params.mode === "string" && params.mode !== mode) {
    throw new Error(`mode does not match provided shape: ${params.mode}`);
  }
  if (mode === "single") {
    return {
      mode,
      agent: agent as string,
      task: task as string,
      cwd: typeof params.cwd === "string" ? params.cwd : undefined,
    };
  }
  const parseItems = (items: unknown[], label: string) =>
    items.map((item, index) => {
      if (!item || typeof item !== "object")
        throw new Error(`${label}[${index}] must be object with agent and task strings.`);
      const record = item as Record<string, unknown>;
      if (typeof record.agent !== "string" || typeof record.task !== "string") {
        throw new Error(`${label}[${index}] must include string agent and task fields.`);
      }
      if (record.cwd !== undefined && typeof record.cwd !== "string") {
        throw new Error(`${label}[${index}].cwd must be string when provided.`);
      }
      return { agent: record.agent, task: record.task, cwd: record.cwd as string | undefined };
    });
  if (mode === "chain") return { mode, chain: parseItems(chain as unknown[], "chain") };
  if (
    params.concurrency !== undefined &&
    (typeof params.concurrency !== "number" || !Number.isFinite(params.concurrency))
  ) {
    throw new Error("concurrency must be finite number when provided.");
  }
  return {
    mode,
    tasks: parseItems(tasks as unknown[], "tasks"),
    concurrency: params.concurrency as number | undefined,
  };
}

function formatRegistryIssueNotice(
  diagnostics: AgentIssue[],
  phase: "startup" | "reload",
): { message: string; level: "warning" | "error" } | null {
  const errors = diagnostics.filter((item) => item.level === "error").length;
  const warnings = diagnostics.filter((item) => item.level === "warning").length;
  if (!errors && !warnings) return null;
  return {
    message: `subagents: found ${errors + warnings} agent issue(s) during ${phase}. Run /subagent doctor.`,
    level: errors ? "error" : "warning",
  };
}

function renderDebugModeStatus(): string {
  return `subagent debug: ${isSubagentDebugEnabled() ? "on" : "off"}`;
}

function workflowHasFailures(result: WorkflowResult): boolean {
  return result.runs.some(
    (run) => run.exitCode !== 0 || run.stopReason === "error" || run.stopReason === "aborted",
  );
}

export default function subagentsExtension(pi: ExtensionAPI): void {
  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup" && event.reason !== "reload") return;
    try {
      const { diagnostics } = await collectRegistryDiagnostics(ctx.cwd, {
        modelRegistry: ctx.modelRegistry,
        allTools: pi.getAllTools(),
      });
      const notice = formatRegistryIssueNotice(diagnostics, event.reason);
      if (notice) notifyForSessionStart(ctx, event.reason, notice.message, notice.level);
    } catch (error) {
      notifyForSessionStart(
        ctx,
        event.reason,
        `subagents: failed during ${event.reason}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async () => {
    clearAgentRegistryCache();
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run isolated subagent workflows. Supports single, chain, and parallel modes.",
    promptSnippet: "Delegate focused work to isolated subagents",
    promptGuidelines: [
      "Use subagent when context isolation or role specialization helps.",
      "Use single mode for one specialist, chain for sequential handoff, parallel for independent tasks.",
      "Keep task text explicit. Chain forwards prior step output automatically as received handoff.",
      "Run /subagent doctor when agent definitions seem broken.",
    ],
    parameters: TOOL_PARAMS,
    renderCall(args, theme) {
      return new Text(
        theme.fg(
          "toolTitle",
          theme.bold(
            formatWorkflowLabel({
              mode:
                Array.isArray(args.chain) && args.chain.length
                  ? "chain"
                  : Array.isArray(args.tasks) && args.tasks.length
                    ? "parallel"
                    : "single",
              chain: Array.isArray(args.chain) ? args.chain : undefined,
              tasks: Array.isArray(args.tasks) ? args.tasks : undefined,
              agent: typeof args.agent === "string" ? args.agent : undefined,
              task: typeof args.task === "string" ? args.task : undefined,
            }),
          ),
        ),
        0,
        0,
      );
    },
    renderResult(result, { expanded }, theme) {
      const typed = result as {
        details?: WorkflowResult | { diagnostics: AgentIssue[] };
        isError?: boolean;
      };
      const details = typed.details;
      const color = getResultColor(details, typed.isError);
      if (!details || "diagnostics" in details) {
        return new Text(theme.fg(color, renderDetails(details, expanded)), 0, 0);
      }
      const block = renderWorkflowBlock(details);
      return renderCollapsibleTextResult(theme, {
        expanded,
        collapsedText: block.collapsedText,
        expandedText: block.expandedText,
        footer: block.footer,
      });
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const workflow = resolveWorkflow(params as Record<string, unknown>);
      const { agents, diagnostics } = await resolveRunnableAgents(ctx.cwd, workflow, {
        modelRegistry: ctx.modelRegistry,
        allTools: pi.getAllTools(),
      });
      const blocking = diagnostics.filter((item) => item.level === "error");
      if (blocking.length > 0) throw new Error(formatDiagnosticSummary(blocking));
      if (agents.length === 0) throw new Error("No agents found. Run /subagent list.");

      const result = await executeWorkflow({
        defaultCwd: ctx.cwd,
        agents,
        workflow,
        parentActiveTools: pi.getActiveTools(),
        signal,
        onUpdate: (update) =>
          onUpdate?.({
            content: [{ type: "text", text: renderWorkflowSummary(update) }],
            details: update,
          }),
      });

      if (workflowHasFailures(result)) {
        throw new Error(renderWorkflow(result, true));
      }

      return {
        content: [{ type: "text", text: renderWorkflow(result, true) }],
        details: result,
      };
    },
  });

  pi.registerCommand("subagent", {
    description: "Subagent utilities. Usage: /subagent [list|doctor|debug on|off|status]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim().toLowerCase();
      const options = ["list", "doctor", "debug on", "debug off", "debug status"];
      const filtered = options.filter((option) => option.startsWith(value));
      return filtered.length ? filtered.map((option) => ({ value: option, label: option })) : null;
    },
    handler: async (args, ctx) => {
      const [command = "", subcommand = ""] = args.trim().split(/\s+/, 2);
      if (command === "list") {
        const registry = await discoverAgents(ctx.cwd, { refresh: true });
        if (ctx.hasUI) ctx.ui.notify(renderListReport(registry), "info");
        return;
      }
      if (command === "doctor") {
        const { registry, runtimeDiagnostics, diagnostics } = await collectRegistryDiagnostics(
          ctx.cwd,
          {
            modelRegistry: ctx.modelRegistry,
            allTools: pi.getAllTools(),
          },
        );
        if (ctx.hasUI)
          ctx.ui.notify(
            renderDoctorReport(registry, runtimeDiagnostics),
            diagnostics.some((item) => item.level === "error") ? "warning" : "info",
          );
        return;
      }
      if (command === "debug") {
        if (!subcommand || subcommand === "status") {
          if (ctx.hasUI) ctx.ui.notify(renderDebugModeStatus(), "info");
          return;
        }
        if (subcommand === "on") {
          setSubagentDebugEnabled(true);
          if (ctx.hasUI) ctx.ui.notify(renderDebugModeStatus(), "info");
          return;
        }
        if (subcommand === "off") {
          setSubagentDebugEnabled(false);
          if (ctx.hasUI) ctx.ui.notify(renderDebugModeStatus(), "info");
          return;
        }
      }
      if (ctx.hasUI) ctx.ui.notify("Usage: /subagent [list|doctor|debug on|off|status]", "warning");
    },
  });
}
