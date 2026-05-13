import type { Model } from "@earendil-works/pi-ai";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  renderCollapsibleStyledTextResult,
  truncateMultilineText,
} from "../../shared/ui/collapsible-text-result.js";
import { applyPatch, type ApplyPatchSummary } from "./patch-executor.js";
import { getCodexCompatCapabilities } from "./capabilities.js";

const COMPAT_TOOL_NAMES = new Set(["apply_patch", "view_image"]);
const SUPPRESSED_BUILTINS = new Set(["edit", "write"]);
const KEPT_BUILTINS = ["read", "bash"] as const;

const APPLY_PATCH_PARAMS = Type.Object({
  input: Type.String({
    description:
      "Patch body or explicit apply_patch invocation. Use one coherent patch for all file changes in the task. Sections: Add File for new files, Replace File for full rewrites of existing files, Update File for contextual edits, Delete File for removals. Use *** Move to inside Update File for moves; move targets must not already exist. Do not include more than one Add/Replace/Update/Delete section for the same path.",
  }),
});

interface ToolInfo {
  name: string;
  sourceInfo: {
    source: string;
  };
}

interface PatchPreviewOperation {
  sectionIndex: number;
  kind: "add" | "replace" | "update" | "delete";
  path: string;
  moveTo?: string;
  linesAdded: number;
  linesRemoved: number;
}

function sameToolSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function buildCompatPromptDelta(): string {
  return [
    "Codex compatibility mode is active for this model.",
    "- Keep using builtin read and bash for file reads and command execution.",
    "- Use apply_patch for edits, file creation, file deletion, moves, and coordinated multi-file changes. Treat this as required, not preference.",
    "- Only skip apply_patch in very rare cases where a deterministic scripted transformation via tools like python3 or node materially reduces token usage or risk.",
    "- Never use cat, echo, printf, here-docs, perl, sed, or similar shell/file-manipulation shortcuts to write or rewrite files when apply_patch can express change.",
    "- For apply_patch, send either a raw patch body or an explicit apply_patch/applypatch invocation.",
    "- Patch grammar: *** Begin Patch / *** End Patch with Add/Replace/Update/Delete File sections, optional *** Move to, optional *** End of File for EOF-sensitive update chunks.",
    "- Prefer one coherent apply_patch call for all file changes in a task, across all affected files. Include adds, replaces, updates, deletes, and moves together when possible.",
    "- Use Add File for new files, Replace File for full rewrites of existing files, Update File for contextual edits, and Delete File only for removals.",
    "- Use one Update File section with *** Move to for combined move+edit operations. Move targets must not already exist.",
    "- Do not include more than one Add/Replace/Update/Delete section for the same path in one patch. Use Replace File for full rewrites.",
    "- For Add File and Replace File sections, only lines prefixed with + are file content.",
    '- Use view_image for local image inspection; pass detail: "original" only when the current model supports it.',
  ].join("\n");
}

const APPLY_PATCH_EXAMPLE = [
  "Example:",
  "*** Begin Patch",
  "*** Add File: new.md",
  "+new file content",
  "*** Replace File: existing.md",
  "+full replacement content",
  "*** Update File: edited.md",
  "-old line",
  "+new line",
  "*** Update File: old-name.md",
  "*** Move to: new-name.md",
  "-old content",
  "+new content",
  "*** Delete File: remove.md",
  "*** End Patch",
].join("\n");

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

function parsePatchPreview(input: string | undefined): PatchPreviewOperation[] {
  if (typeof input !== "string") return [];

  const operations: PatchPreviewOperation[] = [];
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let current: PatchPreviewOperation | undefined;

  for (const line of lines) {
    const section = line.match(/^\*\*\* (Add|Replace|Update|Delete) File: (.+)$/);
    if (section) {
      current = {
        sectionIndex: operations.length + 1,
        kind:
          section[1] === "Add"
            ? "add"
            : section[1] === "Replace"
              ? "replace"
              : section[1] === "Delete"
                ? "delete"
                : "update",
        path: section[2],
        linesAdded: 0,
        linesRemoved: 0,
      };
      operations.push(current);
      continue;
    }

    if (!current) continue;

    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move && current.kind === "update") {
      current.moveTo = move[1];
      continue;
    }

    if (current.kind === "add" || current.kind === "replace") {
      if (line.startsWith("+")) current.linesAdded += 1;
      continue;
    }

    if (current.kind !== "update") continue;
    if (line.startsWith("+")) current.linesAdded += 1;
    else if (line.startsWith("-")) current.linesRemoved += 1;
  }

  return operations;
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

function collectPreviewTouchedFiles(preview: PatchPreviewOperation[]): number {
  const paths = new Set<string>();
  for (const operation of preview) {
    paths.add(operation.moveTo ?? operation.path);
  }
  return paths.size;
}

function collectTouchedFiles(summary: ApplyPatchSummary): number {
  const paths = new Set<string>();
  for (const change of summary.changes) {
    paths.add(change.move?.to ?? change.path);
  }
  return paths.size;
}

function formatHeaderStats(
  summary: ApplyPatchSummary | undefined,
  preview: PatchPreviewOperation[],
): string {
  const fileCount = summary ? collectTouchedFiles(summary) : collectPreviewTouchedFiles(preview);
  const linesAdded = summary
    ? summary.linesAdded
    : preview.reduce((sum, item) => sum + item.linesAdded, 0);
  const linesRemoved = summary
    ? summary.linesRemoved
    : preview.reduce((sum, item) => sum + item.linesRemoved, 0);
  const moves = summary
    ? summary.moved.length
    : preview.filter((item) => item.kind === "update" && item.moveTo).length;
  const stats = [
    linesAdded > 0 ? `+${linesAdded}` : "",
    linesRemoved > 0 ? `-${linesRemoved}` : "",
    moves > 0 ? `>${moves}` : "",
  ].filter(Boolean);

  return `${fileCount} file${fileCount === 1 ? "" : "s"}${stats.length > 0 ? ` · ${stats.join(" ")}` : ""}`;
}

function renderApplyPatchCall(args: any, theme: any, context: any) {
  const preview = parsePatchPreview(args?.input);
  const label = formatHeaderStats(undefined, preview);
  const header = `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${theme.fg("accent", label)}`;

  if (context?.executionStarted || !context?.isPartial) return new Text(header, 0, 0);

  const rawPatch = typeof args?.input === "string" ? args.input.replace(/\r\n/g, "\n").trim() : "";
  const collapsedText = renderCollapsedPreviewText(theme, preview);
  const body = collapsedText ? `${header}\n${collapsedText}` : header;
  const expandedBody = rawPatch ? `${header}\n${theme.fg("muted", rawPatch)}` : undefined;
  return renderCollapsibleStyledTextResult(theme, {
    expanded: Boolean(context?.expanded),
    collapsedText: body,
    expandedText: expandedBody,
  });
}

function renderChangeLine(change: ApplyPatchSummary["changes"][number]): string {
  if (change.move) return `Moving ${change.move.from} -> ${change.move.to}`;
  if (change.kind === "add") return `Adding ${change.path}`;
  if (change.kind === "replace") return `Replacing ${change.path}`;
  if (change.kind === "delete") return `Deleting ${change.path}`;
  return `Editing ${change.path}`;
}

function renderFailureLine(failure: ApplyPatchSummary["failures"][number]): string {
  const kind = failure.kind ? `${failure.kind} ` : "";
  const path = failure.path ? `${failure.path}` : "";
  const chunk =
    failure.chunkIndex && failure.totalChunks
      ? ` chunk ${failure.chunkIndex}/${failure.totalChunks}`
      : "";
  const context = failure.contextHint ? ` (context: "${failure.contextHint}")` : "";
  const reason = stripRedundantPathTail(failure.message, failure.path);
  return `Failed: ${kind}${path}${chunk}: ${reason}${context}`.trim();
}

function formatPreviewOperation(operation: PatchPreviewOperation): string {
  if (operation.kind === "add") return `Adding ${operation.path}`;
  if (operation.kind === "replace") return `Replacing ${operation.path}`;
  if (operation.kind === "delete") return `Deleting ${operation.path}`;
  if (operation.moveTo) return `Moving ${operation.path} -> ${operation.moveTo}`;
  return `Editing ${operation.path}`;
}

function formatSettledOperation(operation: PatchPreviewOperation): string {
  if (operation.kind === "add") return `Added ${operation.path}`;
  if (operation.kind === "replace") return `Replaced ${operation.path}`;
  if (operation.kind === "delete") return `Deleted ${operation.path}`;
  if (operation.moveTo) return `Moved ${operation.path} -> ${operation.moveTo}`;
  return `Edited ${operation.path}`;
}

function buildSectionStatuses(summary: ApplyPatchSummary | undefined) {
  const applied = new Set<number>();
  const failed = new Map<number, string>();

  if (!summary) {
    return { applied, failed };
  }

  for (const change of summary.changes) {
    applied.add(change.sectionIndex);
  }
  for (const failure of summary.failures) {
    if (failure.sectionIndex) failed.set(failure.sectionIndex, renderFailureLine(failure));
  }

  return { applied, failed };
}

function buildPreviewRows(
  preview: PatchPreviewOperation[],
  summary: ApplyPatchSummary | undefined,
): string[] {
  const { applied, failed } = buildSectionStatuses(summary);

  return preview.map((operation) => {
    const base = formatPreviewOperation(operation);
    const failure = failed.get(operation.sectionIndex);
    if (failure) return `${base} · failed`;
    if (applied.has(operation.sectionIndex)) return `${base} · applied`;
    return `${base} · pending`;
  });
}

function renderCollapsedPreviewText(theme: any, preview: PatchPreviewOperation[]): string {
  const lines = buildPreviewRows(preview, undefined);
  if (lines.length === 0) return "";

  const maxLines = 3;
  const visible = lines.slice(-maxLines).map((line) => truncateMultilineText(line, 1, 120));
  const hidden = lines.length - visible.length;
  const rendered = visible.map((line) => {
    const [label, status] = line.split(" · ");
    return `${theme.fg("muted", `${label} `)}${formatStatus(theme, status as "pending")}`;
  });
  if (hidden > 0) rendered.push(theme.fg("muted", `... +${hidden} more`));
  return rendered.join("\n");
}

function buildExpandedResult(preview: PatchPreviewOperation[], summary: ApplyPatchSummary): string {
  const { applied, failed } = buildSectionStatuses(summary);
  const lines: Array<{ label: string; status: "applied" | "failed" }> = [];
  for (const operation of preview) {
    if (failed.has(operation.sectionIndex)) {
      lines.push({ label: formatSettledOperation(operation), status: "failed" });
      continue;
    }
    if (applied.has(operation.sectionIndex)) {
      lines.push({ label: formatSettledOperation(operation), status: "applied" });
    }
  }
  if (lines.length === 0) return "";
  return ["Result:", ...lines.map((line) => `${line.label}\t${line.status}`)].join("\n");
}

function buildCollapsedActivity(summary: ApplyPatchSummary): string {
  const lines = [
    ...summary.changes.map(renderChangeLine),
    ...summary.failures.map(renderFailureLine),
  ];
  if (lines.length === 0) {
    return summary.status === "failed" ? "No changes applied." : "Waiting for patch activity...";
  }

  const maxLines = 3;
  const visible = lines.slice(-maxLines).map((line) => truncateMultilineText(line, 1, 120));
  const hidden = lines.length - visible.length;
  if (hidden > 0) visible.push(`... +${hidden} more`);
  return visible.join("\n");
}

function buildExpandedPatchText(_summary: ApplyPatchSummary, input: string | undefined): string {
  const normalizedInput = typeof input === "string" ? input.replace(/\r\n/g, "\n").trim() : "";
  return normalizedInput;
}

function formatStatus(theme: any, status: "pending" | "applied" | "failed"): string {
  if (status === "applied") return theme.fg("success", theme.bold("applied"));
  if (status === "failed") return theme.fg("error", theme.bold("failed"));
  return theme.fg("muted", "pending");
}

function renderCollapsedResultText(
  theme: any,
  preview: PatchPreviewOperation[],
  summary: ApplyPatchSummary,
): string {
  const lines = buildPreviewRows(preview, summary);
  if (lines.length === 0) return theme.fg("muted", buildCollapsedActivity(summary));

  const maxLines = 3;
  const visible = lines.slice(-maxLines).map((line) => truncateMultilineText(line, 1, 120));
  const hidden = lines.length - visible.length;
  const rendered = visible.map((line) => {
    const [label, status] = line.split(" · ");
    return `${theme.fg("muted", `${label} `)}${formatStatus(theme, status as "pending" | "applied" | "failed")}`;
  });
  if (hidden > 0) rendered.push(theme.fg("muted", `... +${hidden} more`));
  return rendered.join("\n");
}

function renderExpandedResultText(
  theme: any,
  preview: PatchPreviewOperation[],
  summary: ApplyPatchSummary,
  input: string | undefined,
): string {
  const settled = buildExpandedResult(preview, summary);
  const sections: string[] = [];
  const patchText = buildExpandedPatchText(summary, input);
  if (patchText) sections.push(theme.fg("muted", patchText));
  if (settled) {
    const lines = settled.split("\n") as string[];
    const [title, ...rest] = lines;
    sections.push(
      [
        theme.fg("muted", title),
        ...rest.map((line: string) => {
          const [label, status] = line.split("\t");
          return `${theme.fg("muted", `${label} `)}${formatStatus(theme, status as "applied" | "failed")}`;
        }),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

function renderApplyPatchResult(
  result: any,
  options: { expanded: boolean; isPartial?: boolean },
  theme: any,
  context: any,
) {
  const summary = result.details as ApplyPatchSummary | undefined;
  if (!summary) return new Text("", 0, 0);
  const preview = parsePatchPreview(context?.args?.input);

  const collapsedText = renderCollapsedResultText(theme, preview, summary);
  const expandedText = renderExpandedResultText(
    theme,
    preview,
    { ...summary },
    context?.args?.input,
  );
  return renderCollapsibleStyledTextResult(theme, {
    expanded: options.expanded,
    collapsedText,
    expandedText,
  });
}

function createInitialSummary(input: string): ApplyPatchSummary {
  const preview = parsePatchPreview(input);
  return {
    status: "partial",
    added: [],
    updated: [],
    deleted: [],
    moved: [],
    linesAdded: 0,
    linesRemoved: 0,
    changes: [],
    failures: [],
    completedOperations: 0,
    totalOperations: preview.length,
  };
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
      "Use apply_patch for file edits, file creation, file deletion, moves, and coordinated multi-file changes. Treat this as required unless a rare deterministic scripted transform is clearly better.",
      "Do not use cat, echo, printf, here-docs, perl, sed, or similar shell shortcuts to create or modify files when apply_patch can express change.",
      "Only bypass apply_patch for unusual deterministic file rewrites via tools like python3 or node when that materially reduces tokens or patch risk.",
      "Patch bodies use *** Begin Patch / *** End Patch and Add/Replace/Update/Delete File sections.",
      "Prefer one coherent apply_patch call for all file changes in a task, across all affected files. Include adds, replaces, updates, deletes, and moves together when possible.",
      "Use Add File for new files, Replace File for full rewrites of existing files, Update File for contextual edits, and Delete File only for removals.",
      "Use one Update File section with *** Move to for combined move+edit operations. Move targets must not already exist.",
      "Do not include more than one Add/Replace/Update/Delete section for the same path in one patch. Use Replace File for full rewrites.",
      "In Add File and Replace File sections, only + lines are treated as content.",
      "Use *** End of File in update chunks when the match should be EOF-sensitive.",
      APPLY_PATCH_EXAMPLE,
      "Put the full patch text in the input field.",
    ],
    parameters: APPLY_PATCH_PARAMS,
    renderCall(args, theme, context) {
      return renderApplyPatchCall(args, theme, context);
    },
    renderResult(result, options, theme, context) {
      return renderApplyPatchResult(result, options, theme, context);
    },
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const input = validatePatchInput(params.input);
      await onUpdate?.({
        content: [{ type: "text", text: "Applying patch..." }],
        details: createInitialSummary(input),
      });
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
