import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Workflow, WorkflowResult } from "./types.js";

export const WORKFLOW_MODE_SCHEMA = StringEnum(["single", "chain", "parallel"] as const, {
  description: "Execution mode. Exactly one of single/chain/parallel shapes must be provided.",
});

export const STEP_SCHEMA = Type.Object({
  agent: Type.String({ description: "Agent name" }),
  task: Type.String({ description: "Task to delegate" }),
  cwd: Type.Optional(Type.String({ description: "Optional working directory override" })),
});

export const TOOL_PARAMS = Type.Object({
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

export function resolveWorkflow(params: Record<string, unknown>): Workflow {
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
      if (!item || typeof item !== "object") {
        throw new Error(`${label}[${index}] must be object with agent and task strings.`);
      }
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

export function workflowHasFailures(result: WorkflowResult): boolean {
  return result.runs.some(
    (run) => run.exitCode !== 0 || run.stopReason === "error" || run.stopReason === "aborted",
  );
}
