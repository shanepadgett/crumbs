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
import {
  SettingsManager,
  keyHint,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { applyPatch, type ApplyPatchChange, type ApplyPatchSummary } from "./src/apply-patch.js";
import { parseApplyPatchInvocation } from "./src/apply-patch-invocation.js";
import { type CodexCompatCapabilities, getCodexCompatCapabilities } from "./src/capabilities.js";
import { loadImageFile } from "./src/view-image.js";

const COMPAT_TOOL_NAMES = new Set(["apply_patch", "view_image"]);
const SUPPRESSED_BUILTINS = new Set(["edit", "write"]);
const KEPT_BUILTINS = ["read", "bash"] as const;
const FAST_STATUS_KEY = "fast";
const FAST_SETTINGS_KEY = "crumbs-fast";

const settingsManagers = new Map<string, SettingsManager>();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeSettings(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = merged[key];
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeSettings(baseValue, overrideValue);
      continue;
    }
    merged[key] = overrideValue;
  }
  return merged;
}

function getSettingsManager(cwd: string): SettingsManager {
  const existing = settingsManagers.get(cwd);
  if (existing) return existing;

  const manager = SettingsManager.create(cwd);
  settingsManagers.set(cwd, manager);
  return manager;
}

function getEffectiveSettings(settingsManager: SettingsManager): Record<string, unknown> {
  return mergeSettings(
    settingsManager.getGlobalSettings() as Record<string, unknown>,
    settingsManager.getProjectSettings() as Record<string, unknown>,
  );
}

function loadPersistedFastState(cwd: string): boolean | undefined {
  const settingsManager = getSettingsManager(cwd);
  settingsManager.reload();
  const settings = getEffectiveSettings(settingsManager);
  const extensionSettings = asObject(settings[FAST_SETTINGS_KEY]);
  return typeof extensionSettings?.enabled === "boolean" ? extensionSettings.enabled : undefined;
}

function persistFastState(enabled: boolean, cwd: string): SettingsManager {
  const settingsManager = getSettingsManager(cwd);
  const internal = settingsManager as unknown as {
    globalSettings: Record<string, unknown>;
    markModified(field: string, nestedKey?: string): void;
    save(): void;
  };
  settingsManager.reload();

  const globalSettings = settingsManager.getGlobalSettings() as Record<string, unknown>;
  const extensionSettings = asObject(globalSettings[FAST_SETTINGS_KEY]) ?? {};

  internal.globalSettings[FAST_SETTINGS_KEY] = {
    ...extensionSettings,
    enabled,
  };

  internal.markModified(FAST_SETTINGS_KEY);
  internal.save();
  return settingsManager;
}

function reportFastSettingsErrors(
  settingsManager: SettingsManager,
  ctx: ExtensionContext,
  action: "load" | "write",
): void {
  if (!ctx.hasUI) return;
  for (const { scope, error } of settingsManager.drainErrors()) {
    ctx.ui.notify(`fast: failed to ${action} ${scope} settings: ${error.message}`, "warning");
  }
}

function isFastSupportedProvider(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "openai" || ctx.model?.provider === "openai-codex";
}

function updateFastStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) return;
  if (!enabled || !isFastSupportedProvider(ctx)) {
    ctx.ui.setStatus(FAST_STATUS_KEY, undefined);
    return;
  }

  ctx.ui.setStatus(FAST_STATUS_KEY, ctx.ui.theme.fg("accent", "⚡"));
}

function sameToolSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function plainTextResult(text: string) {
  return [{ type: "text" as const, text }];
}

function trimApplyPatchPreviewLines(lines: string[], limit: number): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `... (${lines.length - limit} more lines)`];
}

function extractApplyPatchBody(input: string): string {
  const beginIndex = input.indexOf("*** Begin Patch");
  return beginIndex >= 0 ? input.slice(beginIndex) : input;
}

function inspectApplyPatchInput(input: string | undefined) {
  const normalized =
    typeof input === "string" ? extractApplyPatchBody(input.replace(/\r\n/g, "\n")) : "";
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  const operationMatches = normalized.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/gm) ?? [];

  let activeKind: "add" | "delete" | "update" | undefined;
  let activePath: string | undefined;
  let operationStart = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^\*\*\* (Add|Delete|Update) File: (.+)$/);
    if (!match) continue;
    activeKind = match[1]?.toLowerCase() as "add" | "delete" | "update";
    activePath = match[2]?.trim();
    operationStart = index;
  }

  const previewSource = operationStart >= 0 ? lines.slice(operationStart + 1) : [];
  const previewLines = previewSource.filter((line) => {
    if (line.startsWith("*** ")) return false;
    if (activeKind === "add") return line.startsWith("+");
    if (activeKind === "delete") return false;
    if (activeKind === "update") {
      return (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line.startsWith("@@") ||
        line === "*** End of File"
      );
    }
    return false;
  });

  return {
    targetCount: operationMatches.length,
    activeKind,
    activePath,
    previewLines,
    hasBeginPatch: normalized.includes("*** Begin Patch"),
    isComplete: normalized.includes("*** End Patch"),
  };
}

function formatApplyPatchCallAction(kind: "add" | "delete" | "update" | undefined): string {
  if (kind === "add") return "Adding";
  if (kind === "delete") return "Deleting";
  if (kind === "update") return "Updating";
  return "Composing";
}

function renderApplyPatchCall(args: any, theme: any, context?: any) {
  const inspected = inspectApplyPatchInput(args?.input);
  const targets = inspected.targetCount;
  const label = targets > 0 ? `${targets} file${targets === 1 ? "" : "s"}` : "patch";

  const header = `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${theme.fg("accent", label)}`;

  if (!args?.input) {
    return new Text(header, 0, 0);
  }

  const activity = inspected.activePath
    ? `${formatApplyPatchCallAction(inspected.activeKind)} ${inspected.activePath}`
    : inspected.hasBeginPatch
      ? "Composing patch"
      : "Waiting for patch";

  const previewLimit = context?.expanded ? 20 : 6;
  const previewLines = trimApplyPatchPreviewLines(inspected.previewLines, previewLimit)
    .map((line) => {
      if (line.startsWith("... (")) return theme.fg("muted", line);
      if (line.startsWith("+")) return theme.fg("accent", line);
      if (line.startsWith("-")) return theme.fg("muted", line);
      if (line.startsWith("@@") || line === "*** End of File") return theme.fg("muted", line);
      return theme.fg("toolOutput", line);
    })
    .join("\n");

  if (!context?.expanded) {
    const compact = [
      theme.fg("muted", activity),
      inspected.isComplete ? theme.fg("muted", "ready") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return new Text(compact ? `${header}\n${compact}` : header, 0, 0);
  }

  const sections = [header, theme.fg("muted", activity), previewLines].filter(Boolean).join("\n\n");
  return new Text(sections, 0, 0);
}

function formatApplyPatchProgress(summary: ApplyPatchSummary): string {
  const noun = summary.totalOperations === 1 ? "file" : "files";
  return `${summary.completedOperations}/${summary.totalOperations} ${noun}`;
}

function formatApplyPatchStatus(summary: ApplyPatchSummary): string {
  const phase = summary.phase === "preparing" ? "Preparing patch" : "Applying patch";
  const parts = [phase, formatApplyPatchProgress(summary)];
  const badge = formatApplyPatchBadge(summary);
  if (badge) parts.push(badge);
  return parts.join(" · ");
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
  const activity = summary.currentFile
    ? ` ${summary.currentFile}${summary.currentChunk && summary.totalChunks ? ` (${summary.currentChunk}/${summary.totalChunks})` : ""}`
    : "";
  return `${formatApplyPatchStatus(summary)}${activity}`;
}

function formatApplyPatchOperation(summary: ApplyPatchSummary): string {
  if (!summary.activeOperation) return "Working";
  if (summary.activeOperation === "add") return "Adding";
  if (summary.activeOperation === "delete") return "Deleting";
  return "Updating";
}

function renderApplyPatchCurrentDiff(summary: ApplyPatchSummary, theme: any): string {
  if (!summary.currentFile) return "";

  const header = theme.fg(
    "accent",
    `${formatApplyPatchOperation(summary)} ${summary.currentFile}${summary.currentChunk !== undefined && summary.totalChunks ? ` (${summary.currentChunk}/${summary.totalChunks})` : ""}`,
  );
  const diff = (summary.currentDiff ?? [])
    .map((line) => {
      if (line.startsWith("... (")) return theme.fg("muted", line);
      if (line.startsWith("+")) return theme.fg("accent", line);
      if (line.startsWith("-")) return theme.fg("muted", line);
      if (line.startsWith("@@") || line === "*** End of File") return theme.fg("muted", line);
      return theme.fg("toolOutput", line);
    })
    .join("\n");

  return diff ? `${header}\n${diff}` : header;
}

function renderApplyPatchRecentChanges(summary: ApplyPatchSummary, theme: any): string {
  const changes = summary.recentChanges ?? [];
  if (changes.length === 0) return "";

  const lines = changes.map((change) => theme.fg("toolOutput", formatApplyPatchChange(change)));
  return [theme.fg("muted", "Completed"), ...lines].join("\n");
}

function renderApplyPatchPartialResult(summary: ApplyPatchSummary, expanded: boolean, theme: any) {
  const status = theme.fg("muted", formatApplyPatchStatus(summary));
  const active = renderApplyPatchCurrentDiff(summary, theme);
  const completed = renderApplyPatchRecentChanges(summary, theme);
  const hasExpandableContent = Boolean(active || completed);

  if (!expanded) {
    const hint = hasExpandableContent
      ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
      : "";
    return new Text([status, hint].filter(Boolean).join(" "), 0, 0);
  }

  const sections = [status, active, completed].filter(Boolean).join("\n\n");
  const hint = hasExpandableContent
    ? theme.fg("muted", keyHint("app.tools.expand", "to collapse"))
    : "";
  return new Text(hint ? `\n${sections}\n${hint}` : `\n${sections}`, 0, 0);
}

function renderApplyPatchResult(
  result: any,
  options: { expanded: boolean; isPartial?: boolean },
  theme: any,
) {
  const details = result.details as ApplyPatchSummary | undefined;

  if (!details) return new Text("", 0, 0);

  if (options.isPartial || details.status === "running") {
    return renderApplyPatchPartialResult(details, options.expanded, theme);
  }

  const summary = formatApplyPatchBadge(details);
  const lines = details.changes.map((change) => formatApplyPatchChange(change));
  const hasExpandableContent = lines.length > 0;

  if (!options.expanded) {
    const compact = [summary ? theme.fg("muted", `[${summary}]`) : ""].filter(Boolean).join(" ");
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
  const footer = [summary ? theme.fg("muted", `[${summary}]`) : "", expandedHint]
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
  let fastEnabled = false;
  let settingsWriteQueue: Promise<void> = Promise.resolve();

  function persistEnabled(nextEnabled: boolean, ctx: ExtensionContext): void {
    const cwd = ctx.cwd;
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const settingsManager = persistFastState(nextEnabled, cwd);
        await settingsManager.flush();
        reportFastSettingsErrors(settingsManager, ctx, "write");
      });

    void settingsWriteQueue.catch((error) => {
      if (!ctx.hasUI) return;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`fast: failed to write settings: ${message}`, "warning");
    });
  }

  function setFastEnabled(
    nextEnabled: boolean,
    ctx: ExtensionContext,
    options?: { persist?: boolean },
  ): void {
    fastEnabled = nextEnabled;
    if (options?.persist !== false) {
      persistEnabled(nextEnabled, ctx);
    }
    updateFastStatus(ctx, fastEnabled);
  }

  async function reloadFastEnabledState(ctx: ExtensionContext): Promise<void> {
    await settingsWriteQueue.catch(() => undefined);
    fastEnabled = false;

    try {
      const settingsManager = getSettingsManager(ctx.cwd);
      const persistedEnabled = loadPersistedFastState(ctx.cwd);
      reportFastSettingsErrors(settingsManager, ctx, "load");
      if (typeof persistedEnabled === "boolean") {
        fastEnabled = persistedEnabled;
      }
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`fast: failed to load settings: ${message}`, "warning");
      }
    }

    updateFastStatus(ctx, fastEnabled);
  }

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
    renderCall(args, theme, context) {
      return renderApplyPatchCall(args, theme, context);
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

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (service_tier=priority)",
    handler: async (_args, ctx) => {
      const nextEnabled = !fastEnabled;
      setFastEnabled(nextEnabled, ctx);
      if (!ctx.hasUI) return;
      if (!nextEnabled) {
        ctx.ui.notify("Fast mode disabled.", "info");
        return;
      }

      if (isFastSupportedProvider(ctx)) {
        ctx.ui.notify("Fast mode enabled. Requests will send service_tier=priority.", "info");
        return;
      }

      const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no active model";
      ctx.ui.notify(
        `Fast mode enabled. It will apply once you switch to an OpenAI or OpenAI Codex model (current: ${modelLabel}).`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await reloadFastEnabledState(ctx);
    syncActiveTools(ctx.model);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    await reloadFastEnabledState(ctx);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    await reloadFastEnabledState(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    syncActiveTools(event.model);
    updateFastStatus(ctx, fastEnabled);

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

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastEnabled || !isFastSupportedProvider(ctx) || !isRecord(event.payload)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, "service_tier")) {
      return;
    }

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
