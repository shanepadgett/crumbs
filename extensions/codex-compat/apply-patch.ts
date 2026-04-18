import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { applyPatch, type ApplyPatchSummary } from "./src/patch-executor.js";
import { getCodexCompatCapabilities } from "./src/capabilities.js";

const COMPAT_TOOL_NAMES = new Set(["apply_patch", "view_image"]);
const SUPPRESSED_BUILTINS = new Set(["edit", "write"]);
const KEPT_BUILTINS = ["read", "bash"] as const;

const APPLY_PATCH_PARAMS = Type.Object({
  input: Type.String({
    description:
      "Patch body or explicit apply_patch invocation. Patch bodies use *** Begin Patch / *** End Patch with Add/Update/Delete File sections, optional *** Move to, and optional *** End of File in update chunks.",
  }),
});

interface ToolInfo {
  name: string;
  sourceInfo: {
    source: string;
  };
}

function sameToolSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function buildCompatPromptDelta(): string {
  return [
    "Codex compatibility mode is active for this model.",
    "- Keep using builtin read and bash for file reads and command execution.",
    "- Prefer apply_patch for edits, file creation, file deletion, moves, and coordinated multi-file changes.",
    "- For apply_patch, send either a raw patch body or an explicit apply_patch/applypatch invocation.",
    "- Patch grammar: *** Begin Patch / *** End Patch with Add/Update/Delete File sections, optional *** Move to, optional *** End of File for EOF-sensitive update chunks.",
    "- For Add File sections, only lines prefixed with + are file content.",
    "- Prefer one coherent apply_patch call when related edits belong together.",
    '- Use view_image for local image inspection; pass detail: "original" only when the current model supports it.',
  ].join("\n");
}

function buildCompatToolSet(
  currentActiveTools: string[],
  allTools: ToolInfo[],
  includeViewImage: boolean,
) {
  const preservedCustomTools = currentActiveTools.filter((toolName) => {
    if (COMPAT_TOOL_NAMES.has(toolName)) return false;
    if (SUPPRESSED_BUILTINS.has(toolName)) return false;

    const tool = allTools.find((entry) => entry.name === toolName);
    if (!tool) return false;
    return tool.sourceInfo.source !== "builtin";
  });

  const keepBuiltins = KEPT_BUILTINS.filter((toolName) =>
    allTools.some((entry) => entry.name === toolName),
  );
  const next = [...preservedCustomTools, ...keepBuiltins, "apply_patch"];
  if (includeViewImage) next.push("view_image");
  return Array.from(new Set(next));
}

function stripCompatTools(activeTools: string[]): string[] {
  return activeTools.filter((toolName) => !COMPAT_TOOL_NAMES.has(toolName));
}

function countPatchSections(input: string | undefined): number {
  if (typeof input !== "string") return 0;
  const normalized = input.replace(/\r\n/g, "\n");
  return (normalized.match(/^\*\*\* (?:Add|Update|Delete) File: /gm) ?? []).length;
}

function formatBadge(summary: ApplyPatchSummary): string {
  const parts = [
    summary.linesAdded > 0 ? `+${summary.linesAdded}` : "",
    summary.linesRemoved > 0 ? `-${summary.linesRemoved}` : "",
    summary.updated.length > 0 ? `~${summary.updated.length}` : "",
    summary.moved.length > 0 ? `>${summary.moved.length}` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function stripRedundantPathTail(message: string, path?: string): string {
  if (!path) return message;
  return message
    .replace(new RegExp(`\\s+for ${path.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}$`), "")
    .trim();
}

function renderApplyPatchCall(args: any, theme: any) {
  const count = countPatchSections(args?.input);
  const label = `${count || 0} file${count === 1 ? "" : "s"}`;
  return new Text(
    `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${theme.fg("accent", label)}`,
    0,
    0,
  );
}

function renderApplyPatchResult(result: any, options: { expanded: boolean }, theme: any) {
  const summary = result.details as ApplyPatchSummary | undefined;
  if (!summary) return new Text("", 0, 0);

  const badge = formatBadge(summary);
  const header =
    summary.status === "failed"
      ? "No changes applied."
      : `${badge ? `[${badge}] ` : ""}Applied ${summary.completedOperations}/${summary.totalOperations} sections`;

  if (!options.expanded) {
    return new Text(theme.fg("muted", header), 0, 0);
  }

  const lines = [theme.fg("muted", header)];
  for (const path of summary.added) lines.push(theme.fg("toolOutput", `A ${path}`));
  for (const path of summary.updated) lines.push(theme.fg("toolOutput", `M ${path}`));
  for (const path of summary.deleted) lines.push(theme.fg("toolOutput", `D ${path}`));
  for (const move of summary.moved) {
    lines.push(theme.fg("toolOutput", `R ${move.from} -> ${move.to}`));
  }
  for (const failure of summary.failures) {
    const kind = failure.kind ? `${failure.kind} ` : "";
    const path = failure.path ? `${failure.path}` : "";
    const chunk =
      failure.chunkIndex && failure.totalChunks
        ? ` chunk ${failure.chunkIndex}/${failure.totalChunks}`
        : "";
    const context = failure.contextHint ? ` (context: "${failure.contextHint}")` : "";
    const reason = stripRedundantPathTail(failure.message, failure.path);
    lines.push(theme.fg("warning", `! ${kind}${path}${chunk}: ${reason}${context}`.trim()));
  }

  return new Text(`\n${lines.join("\n")}`, 0, 0);
}

function formatContent(summary: ApplyPatchSummary): string {
  const badge = formatBadge(summary);
  const lines: string[] = [];

  if (summary.status === "failed") {
    lines.push("No changes applied.");
  } else {
    lines.push(
      `Applied ${summary.completedOperations}/${summary.totalOperations} sections. [${badge}]`,
    );
  }

  for (const path of summary.added) lines.push(`A ${path}`);
  for (const path of summary.updated) lines.push(`M ${path}`);
  for (const path of summary.deleted) lines.push(`D ${path}`);
  for (const move of summary.moved) lines.push(`R ${move.from} -> ${move.to}`);

  if (summary.status !== "completed") {
    lines.push("Failures:");
    for (const failure of summary.failures) {
      const kind = failure.kind ? `${failure.kind} ` : "";
      const path = failure.path ? `${failure.path}` : "";
      const chunk =
        failure.chunkIndex && failure.totalChunks
          ? ` chunk ${failure.chunkIndex}/${failure.totalChunks}`
          : "";
      const reason = stripRedundantPathTail(failure.message, failure.path);
      const context = failure.contextHint ? ` (context: "${failure.contextHint}")` : "";
      lines.push(`- ${kind}${path}${chunk}: ${reason}${context}`.trim());
    }
  }

  return lines.join("\n");
}

function validatePatchInput(input: string): string {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized.startsWith("*** Begin Patch")) {
    throw new Error("apply_patch input must start with *** Begin Patch");
  }
  return normalized;
}

function currentCapability(model: Pick<Model<any>, "provider" | "id"> | undefined) {
  return getCodexCompatCapabilities(model);
}

export default function codexCompatApplyPatchExtension(pi: ExtensionAPI) {
  let compatActive = false;
  let savedActiveTools: string[] | undefined;

  function syncActiveTools(model: Pick<Model<any>, "provider" | "id"> | undefined) {
    const capability = currentCapability(model);
    const currentActiveTools = pi.getActiveTools();
    const allTools = pi.getAllTools() as ToolInfo[];

    if (!capability) {
      const stripped = stripCompatTools(currentActiveTools);
      if (!sameToolSet(currentActiveTools, stripped)) {
        pi.setActiveTools(stripped);
      }
      if (compatActive && savedActiveTools) {
        const restorable = savedActiveTools.filter((toolName) =>
          allTools.some((tool) => tool.name === toolName),
        );
        if (!sameToolSet(pi.getActiveTools(), restorable)) {
          pi.setActiveTools(restorable);
        }
      }
      compatActive = false;
      savedActiveTools = undefined;
      return;
    }

    const nonCompatSnapshot = stripCompatTools(currentActiveTools);
    if (!compatActive) {
      savedActiveTools = nonCompatSnapshot;
    }

    const nextTools = buildCompatToolSet(
      currentActiveTools,
      allTools,
      capability.supportsImageInput,
    );
    if (!sameToolSet(currentActiveTools, nextTools)) {
      pi.setActiveTools(nextTools);
    }

    compatActive = true;
  }

  pi.registerTool({
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a multi-file patch with Codex-compatible parsing and matching. Accepts raw patch bodies and explicit apply_patch/applypatch invocation forms.",
    promptSnippet: "Apply focused multi-file text patches",
    promptGuidelines: [
      "Use apply_patch for file edits, file creation, file deletion, and coordinated multi-file changes.",
      "Patch bodies use *** Begin Patch / *** End Patch and Add/Update/Delete File sections.",
      "In Add File sections, only + lines are treated as content.",
      "Use *** End of File in update chunks when the match should be EOF-sensitive.",
      "When one task needs coordinated edits across multiple files, send them in a single apply_patch call when one coherent patch will do.",
      "Put the full patch text in the input field.",
    ],
    parameters: APPLY_PATCH_PARAMS,
    renderCall(args, theme) {
      return renderApplyPatchCall(args, theme);
    },
    renderResult(result, options, theme) {
      return renderApplyPatchResult(result, options, theme);
    },
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const input = validatePatchInput(params.input);
      const summary = await applyPatch(ctx.cwd, input, async (progress) => {
        await onUpdate?.({
          content: [
            {
              type: "text",
              text: `Applying patch · ${progress.completedOperations}/${progress.totalOperations} · +${progress.linesAdded} -${progress.linesRemoved}`,
            },
          ],
          details: progress,
        });
      });

      return {
        content: [{ type: "text", text: formatContent(summary) }],
        details: summary,
        isError: summary.status === "failed",
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    syncActiveTools(ctx.model);
  });

  pi.on("model_select", async (event) => {
    syncActiveTools(event.model);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!currentCapability(ctx.model)) return undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildCompatPromptDelta()}`,
    };
  });
}
