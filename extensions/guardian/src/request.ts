import { isToolCallEventType, type ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { parseApplyPatchTargets } from "./patch.js";
import { resolveCanonicalWorkspace, resolveTargetPath } from "./paths.js";
import type { GateRequest, GuardianConfig, MutationOperation, ToolKind } from "./types.js";

const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "websearch",
  "webfetch",
  "codesearch",
  "view_image",
]);
const MUTATION_TOOLS = new Set(["write", "edit", "apply_patch"]);

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function countByOperation(paths: readonly { operation?: MutationOperation }[]): string {
  const counts = new Map<MutationOperation, number>();
  for (const path of paths) {
    if (!path.operation) continue;
    counts.set(path.operation, (counts.get(path.operation) ?? 0) + 1);
  }
  return [...counts.entries()].map(([operation, count]) => `${count} ${operation}`).join(", ");
}

function summarizePatch(
  paths: readonly { raw: string; operation?: MutationOperation }[],
  unparseable: boolean,
): string {
  if (unparseable) return "apply_patch: unparseable patch";
  const fileCount = new Set(paths.map((path) => path.raw)).size;
  const operationSummary = countByOperation(paths);
  return `apply_patch: ${fileCount} file${fileCount === 1 ? "" : "s"}${operationSummary ? ` (${operationSummary})` : ""}`;
}

function toolKind(toolName: string): ToolKind {
  if (READ_ONLY_TOOLS.has(toolName)) return "read_only";
  if (toolName === "bash") return "bash";
  if (MUTATION_TOOLS.has(toolName)) return "file_mutation";
  return "unknown";
}

async function resolveSinglePathRequest(
  cwd: string,
  config: GuardianConfig,
  rawPath: string,
  operation: MutationOperation,
  byteSize?: number,
) {
  const canonicalWorkspace = await resolveCanonicalWorkspace(cwd);
  return resolveTargetPath(cwd, canonicalWorkspace, rawPath, config.mutation.blockPathRules, {
    operation,
    byteSize,
  });
}

export function createFallbackRequest(
  event: ToolCallEvent,
  cwd: string,
  reason: string,
): GateRequest {
  return {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    kind: "unknown",
    cwd,
    inputSummary: `${event.toolName}: ${reason}`,
  };
}

export async function buildGateRequest(
  event: ToolCallEvent,
  cwd: string,
  config: GuardianConfig,
): Promise<GateRequest> {
  const kind = toolKind(event.toolName);

  if (kind === "read_only") {
    return {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      kind,
      cwd,
      inputSummary: `${event.toolName}: read-only`,
    };
  }

  if (isToolCallEventType("bash", event)) {
    return {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      kind: "bash",
      cwd,
      command: event.input.command,
      inputSummary: `bash: ${truncate(event.input.command.replace(/\s+/g, " ").trim(), 120)}`,
    };
  }

  if (isToolCallEventType("write", event)) {
    const path = await resolveSinglePathRequest(
      cwd,
      config,
      event.input.path,
      "replace",
      byteLength(event.input.content),
    );
    return {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      kind: "file_mutation",
      cwd,
      paths: [path],
      inputSummary: `write: ${path.raw}`,
    };
  }

  if (isToolCallEventType("edit", event)) {
    const path = await resolveSinglePathRequest(
      cwd,
      config,
      event.input.path,
      "update",
      event.input.edits.reduce((sum, edit) => sum + byteLength(edit.newText), 0),
    );
    return {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      kind: "file_mutation",
      cwd,
      paths: [path],
      inputSummary: `edit: ${path.raw}`,
    };
  }

  if (isToolCallEventType<"apply_patch", { input: string }>("apply_patch", event)) {
    const parsed = parseApplyPatchTargets(event.input.input);
    const canonicalWorkspace = await resolveCanonicalWorkspace(cwd);
    const paths = await Promise.all(
      parsed.targets.map((target) =>
        resolveTargetPath(cwd, canonicalWorkspace, target.path, config.mutation.blockPathRules, {
          operation: target.operation,
          byteSize: target.byteSize,
        }),
      ),
    );

    return {
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      kind: "file_mutation",
      cwd,
      paths,
      inputSummary: summarizePatch(paths, parsed.unparseable),
      unparseablePatch: parsed.unparseable,
    };
  }

  return {
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    kind,
    cwd,
    inputSummary: `${event.toolName}: custom tool`,
  };
}
