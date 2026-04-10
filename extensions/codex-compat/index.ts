/**
 * Codex Compat Extension
 *
 * What it does:
 * - Activates a minimal Codex compatibility tool surface for supported Codex-family models.
 * - Suppresses builtin `edit` and `write`, then provides `apply_patch` and conditional `view_image`.
 * - Keeps builtin `read` and `bash`, and preserves custom tools like `webresearch` and `memory_recall`.
 *
 * How to use it:
 * - Install this package with `pi install .` and keep the extension enabled.
 * - Switch to a supported Codex-family model and the minimal compatibility tool set activates automatically.
 * - Switch away from that model and Pi restores the prior non-compat tool set.
 *
 * Example:
 * - Select `openai/gpt-5.3-codex`, then ask Pi to edit files with `apply_patch`
 *   and inspect local images with `view_image`.
 */

import type { Model } from "@mariozechner/pi-ai";
import { keyHint, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { applyPatch, type ApplyPatchChange, type ApplyPatchSummary } from "./src/apply-patch.js";
import { parseApplyPatchInvocation } from "./src/apply-patch-invocation.js";
import { type CodexCompatCapabilities, getCodexCompatCapabilities } from "./src/capabilities.js";
import { loadImageFile } from "./src/view-image.js";

const COMPAT_TOOL_NAMES = new Set(["apply_patch", "view_image"]);
const SUPPRESSED_BUILTINS = new Set(["edit", "write"]);
const KEPT_BUILTINS = ["read", "bash"] as const;

const APPLY_PATCH_PARAMS = Type.Object({
  input: Type.String({
    description:
      "Patch body or explicit apply_patch invocation. Patch bodies use *** Begin Patch / *** End Patch with Add/Update/Delete File sections, optional *** Move to, and optional *** End of File in update chunks.",
  }),
});

const VIEW_IMAGE_PARAMS = Type.Object({
  path: Type.String({ description: "Path to a local image file" }),
  detail: Type.Optional(
    Type.Literal("original", {
      description: "Request original image detail when the model supports it",
    }),
  ),
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

function plainTextResult(text: string) {
  return [{ type: "text" as const, text }];
}

function renderApplyPatchCall(args: any, theme: any) {
  const targets = args?.input?.match(/^\*\*\* (?:Add|Delete|Update) File: .+$/gm)?.length ?? 0;
  const label = targets > 0 ? `${targets} file${targets === 1 ? "" : "s"}` : "patch";
  return new Text(
    `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${theme.fg("accent", label)}`,
    0,
    0,
  );
}

function formatApplyPatchProgress(summary: ApplyPatchSummary): string {
  const noun = summary.totalOperations === 1 ? "file" : "files";
  return `${summary.completedOperations}/${summary.totalOperations} ${noun}`;
}

function formatApplyPatchBadge(summary: ApplyPatchSummary): string {
  return [
    summary.linesAdded > 0 ? `+${summary.linesAdded}` : "",
    summary.linesRemoved > 0 ? `-${summary.linesRemoved}` : "",
    summary.updated.length > 0 ? `~${summary.updated.length}` : "",
    summary.moved.length > 0 ? `>${summary.moved.length}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatApplyPatchDelta(change: ApplyPatchChange): string {
  const parts = [
    change.linesAdded > 0 ? `+${change.linesAdded}` : "",
    change.linesRemoved > 0 ? `-${change.linesRemoved}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? ` (${parts.join(" ")})` : "";
}

function formatApplyPatchChange(change: ApplyPatchChange): string {
  if (change.move) {
    return `> ${change.move.from} -> ${change.move.to}${formatApplyPatchDelta(change)}`;
  }

  const prefix = change.kind === "add" ? "+" : change.kind === "delete" ? "-" : "~";
  return `${prefix} ${change.path}${formatApplyPatchDelta(change)}`;
}

function formatApplyPatchProgressContent(summary: ApplyPatchSummary): string {
  return `Applying patch (${formatApplyPatchProgress(summary)})...`;
}

function renderApplyPatchResult(
  result: any,
  options: { expanded: boolean; isPartial?: boolean },
  theme: any,
) {
  const details = result.details as ApplyPatchSummary | undefined;

  if (!details) return new Text("", 0, 0);

  const progress = options.isPartial ? formatApplyPatchProgress(details) : "";
  const summary = formatApplyPatchBadge(details);
  const lines = details.changes.map((change) => formatApplyPatchChange(change));
  const hasExpandableContent = lines.length > 0;

  if (!options.expanded) {
    const compact = [
      progress ? theme.fg("muted", progress) : "",
      summary ? theme.fg("muted", `[${summary}]`) : "",
    ]
      .filter(Boolean)
      .join(" ");
    const hint = hasExpandableContent
      ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
      : "";
    return new Text([compact, hint].filter(Boolean).join(" "), 0, 0);
  }

  if (lines.length === 0 && !summary) return new Text("", 0, 0);

  const body = lines.map((line) => theme.fg("toolOutput", line)).join("\n");
  const expandedHint = hasExpandableContent
    ? theme.fg("muted", `(${keyHint("app.tools.expand", "to collapse")})`)
    : "";
  const footer = [
    progress ? theme.fg("muted", progress) : "",
    summary ? theme.fg("muted", `[${summary}]`) : "",
    expandedHint,
  ]
    .filter(Boolean)
    .join(" ");
  const withSummary = footer ? `${body}\n${footer}` : body;
  const withHint = withSummary;
  return new Text(`\n${withHint}`, 0, 0);
}

function formatApplyPatchContent(summary: ApplyPatchSummary): string {
  const files: string[] = [];
  for (const path of summary.added) files.push(`A ${path}`);
  for (const path of summary.updated) files.push(`M ${path}`);
  for (const path of summary.deleted) files.push(`D ${path}`);
  for (const move of summary.moved) files.push(`R ${move.from} -> ${move.to}`);

  if (files.length === 0) {
    return "Success. No files were modified.";
  }

  return ["Success. Updated the following files:", ...files].join("\n");
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
    "- Prefer webresearch for external information gathering. Do not rely on any native web_search tool.",
    "- If the parallel tool is available, use it only for independent work.",
  ].join("\n");
}

function buildCompatToolSet(
  capability: CodexCompatCapabilities,
  currentActiveTools: string[],
  allTools: ToolInfo[],
): string[] {
  const preserved = capability.preserveCustomTools
    ? currentActiveTools.filter((toolName) => {
        if (COMPAT_TOOL_NAMES.has(toolName)) return false;
        if (SUPPRESSED_BUILTINS.has(toolName)) return false;

        const tool = allTools.find((entry) => entry.name === toolName);
        if (!tool) return false;
        return tool.sourceInfo.source !== "builtin";
      })
    : [];

  const keepBuiltins = KEPT_BUILTINS.filter((toolName) =>
    allTools.some((entry) => entry.name === toolName),
  );
  const next = [...preserved, ...keepBuiltins, "apply_patch"];
  if (capability.supportsImageInput) next.push("view_image");
  return Array.from(new Set(next));
}

function stripCompatTools(activeTools: string[]): string[] {
  return activeTools.filter((toolName) => !COMPAT_TOOL_NAMES.has(toolName));
}

function normalizeApplyPatchArgs(args: unknown): { input: string } {
  if (typeof args === "string") {
    return { input: args };
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args as { input: string };
  }

  const input = args as Record<string, unknown>;
  if (typeof input.patch === "string" && input.input === undefined) {
    return { ...input, input: input.patch } as { input: string };
  }
  if (typeof input.text === "string" && input.input === undefined) {
    return { ...input, input: input.text } as { input: string };
  }

  return input as { input: string };
}

function normalizeViewImageArgs(args: unknown): { path: string; detail?: "original" } {
  if (typeof args === "string") {
    return { path: args };
  }
  return args as { path: string; detail?: "original" };
}

export default function codexCompatExtension(pi: ExtensionAPI) {
  let compatActive = false;
  let savedActiveTools: string[] | undefined;

  function currentCapability(model: Pick<Model<any>, "provider" | "id"> | undefined) {
    return getCodexCompatCapabilities(model);
  }

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
        if (restorable.length > 0 && !sameToolSet(pi.getActiveTools(), restorable)) {
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

    const nextTools = buildCompatToolSet(capability, currentActiveTools, allTools);
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
      "Input may be a raw patch body or an explicit apply_patch/applypatch command (including shell heredoc wrappers).",
      "Patch bodies use *** Begin Patch / *** End Patch and Add/Update/Delete File sections.",
      "In Add File sections, only + lines are treated as content.",
      "Use *** End of File in update chunks when the match should be EOF-sensitive.",
      "When one task needs coordinated edits across multiple files, send them in a single apply_patch call when one coherent patch will do.",
      "Put the full patch text in the input field.",
      "Prefer one coherent patch over many tiny edits when the changes belong together.",
    ],
    parameters: APPLY_PATCH_PARAMS,
    prepareArguments: normalizeApplyPatchArgs,
    renderCall(args, theme) {
      return renderApplyPatchCall(args, theme);
    },
    renderResult(result, options, theme) {
      return renderApplyPatchResult(result, options, theme);
    },
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const parsedInput = await parseApplyPatchInvocation(ctx.cwd, params.input);
      const summary = await applyPatch(
        parsedInput.effectiveCwd,
        parsedInput.patch,
        async (partial) => {
          await onUpdate?.({
            content: plainTextResult(formatApplyPatchProgressContent(partial)),
            details: {
              ...partial,
              invocationKind: parsedInput.kind,
              effectiveCwd: parsedInput.effectiveCwd,
            },
          });
        },
      );
      return {
        content: plainTextResult(formatApplyPatchContent(summary)),
        details: {
          ...summary,
          invocationKind: parsedInput.kind,
          effectiveCwd: parsedInput.effectiveCwd,
        },
      };
    },
  });

  pi.registerTool({
    name: "view_image",
    label: "View Image",
    description:
      "Load a local image file and return it as an image tool result for visual inspection.",
    promptSnippet: "Attach a local image file for inspection",
    promptGuidelines: [
      "Use view_image when you need to inspect a local screenshot, diagram, or other image asset.",
      'Pass detail: "original" only when the current compat model supports it.',
    ],
    parameters: VIEW_IMAGE_PARAMS,
    prepareArguments: normalizeViewImageArgs,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const capability = currentCapability(ctx.model);
      if (!capability?.supportsImageInput) {
        throw new Error("view_image is not available for the current model.");
      }
      if (params.detail === "original" && !capability.supportsOriginalImageDetail) {
        throw new Error('detail: "original" is not supported for the current model.');
      }

      const image = await loadImageFile(ctx.cwd, params.path, {
        preserveOriginal: params.detail === "original",
        signal,
      });
      return {
        content: [{ type: "image", data: image.data, mimeType: image.mimeType }],
        details: {
          path: image.path,
          mimeType: image.mimeType,
          detail: image.detail,
        },
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    syncActiveTools(ctx.model);
  });

  pi.on("model_select", async (event, ctx) => {
    syncActiveTools(event.model);

    if (!ctx.hasUI) return;

    const capability = currentCapability(event.model);
    if (!capability) return;

    ctx.ui.notify(`codex-compat: active for ${event.model.provider}/${event.model.id}`, "info");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!currentCapability(ctx.model)) return undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildCompatPromptDelta()}`,
    };
  });
}
