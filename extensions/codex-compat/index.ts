/**
 * Codex Compat Extension
 *
 * What it does:
 * - Activates a Codex-oriented tool surface for supported Codex-family models.
 * - Adds `exec_command`, `write_stdin`, `apply_patch`, and conditional `view_image`.
 * - Preserves repo-native tools like `webresearch` instead of adding native Codex web search.
 *
 * How to use it:
 * - Install this package with `pi install .` and keep the extension enabled.
 * - Switch to a supported Codex-family model and the compat tool set will activate automatically.
 * - Switch away from that model and Pi restores the prior non-compat tool set.
 *
 * Example:
 * - Select `openai/gpt-5.3-codex`, then ask Pi to inspect code with `exec_command`
 *   and edit files with `apply_patch` while still using `webresearch` for web work.
 */

import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import { keyHint, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { applyPatch, type ApplyPatchSummary } from "./src/apply-patch.js";
import { type CodexCompatCapabilities, getCodexCompatCapabilities } from "./src/capabilities.js";
import {
  normalizeMaxOutputTokens,
  normalizeTimeoutMs,
  normalizeYieldMs,
  type ShellResultShape,
  ShellSessionManager,
} from "./src/shell-sessions.js";
import { loadImageFile } from "./src/view-image.js";

const COMPAT_TOOL_NAMES = new Set([
  "exec_command",
  "shell_command",
  "write_stdin",
  "apply_patch",
  "view_image",
]);
const SUPPRESSED_BUILTINS = new Set(["read", "bash", "edit", "write"]);

const EXEC_COMMAND_PARAMS = Type.Object({
  cmd: Type.String({ description: "Shell command to execute" }),
  workdir: Type.Optional(Type.String({ description: "Working directory for the command" })),
  shell: Type.Optional(Type.String({ description: "Optional shell binary override" })),
  tty: Type.Optional(Type.Boolean({ description: "Whether to request terminal behavior" })),
  yield_time_ms: Type.Optional(
    Type.Number({ description: "How long to wait for output before returning" }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({ description: "Approximate cap for returned output tokens" }),
  ),
  timeout_ms: Type.Optional(Type.Number({ description: "Maximum runtime in milliseconds" })),
  login: Type.Optional(
    Type.Boolean({ description: "Whether to run the command inside a login shell" }),
  ),
});

const WRITE_STDIN_PARAMS = Type.Object({
  session_id: Type.Number({ description: "Session id returned by exec_command" }),
  chars: Type.Optional(
    Type.String({ description: "Characters to write to stdin; omit or empty string to poll only" }),
  ),
  yield_time_ms: Type.Optional(
    Type.Number({ description: "How long to wait for more output before returning" }),
  ),
  max_output_tokens: Type.Optional(
    Type.Number({ description: "Approximate cap for returned output tokens" }),
  ),
});

const APPLY_PATCH_PARAMS = Type.Object({
  input: Type.String({
    description:
      "Full patch text. Use *** Begin Patch / *** End Patch with Add/Update/Delete File sections and optional *** Move to: lines.",
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

function normalizePathArgument(path: string): string {
  return path.replace(/^@/, "").trim();
}

async function resolveWorkdir(cwd: string, rawPath: string | undefined): Promise<string> {
  const nextPath = rawPath?.trim() ? normalizePathArgument(rawPath) : cwd;
  const absolutePath = isAbsolute(nextPath) ? resolve(nextPath) : resolve(cwd, nextPath);
  const canonicalPath = await realpath(absolutePath).catch(() => {
    throw new Error(`Working directory does not exist: ${rawPath ?? cwd}`);
  });
  const info = await stat(canonicalPath);
  if (!info.isDirectory()) {
    throw new Error(`Expected a directory for workdir: ${rawPath ?? cwd}`);
  }
  return canonicalPath;
}

function plainTextResult(text: string) {
  return [{ type: "text" as const, text }];
}

function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  return `${seconds.toFixed(2)}s`;
}

function hasVisibleToolOutput(text: string): boolean {
  for (const char of text) {
    const code = char.charCodeAt(0);
    const isControl = (code >= 0 && code <= 31) || code === 127;
    if (!isControl && char.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function renderExecCall(toolName: "exec_command" | "write_stdin", args: any, theme: any) {
  if (toolName === "exec_command") {
    const cmd = (args?.cmd ?? "").trim() || "…";
    return new Text(`${theme.fg("toolTitle", theme.bold("$"))} ${theme.fg("accent", cmd)}`, 0, 0);
  }

  const session = args?.session_id;
  const label = Number.isFinite(session) ? `session ${session}` : "session ?";
  const chars = typeof args?.chars === "string" ? args.chars : undefined;
  const action =
    chars === undefined || chars.length === 0 ? "poll" : `send ${JSON.stringify(chars)}`;
  return new Text(
    `${theme.fg("toolTitle", theme.bold("stdin"))} ${theme.fg("accent", label)} ${theme.fg("muted", `· ${action}`)}`,
    0,
    0,
  );
}

function renderExecResult(
  result: any,
  options: { expanded: boolean; isPartial: boolean },
  theme: any,
) {
  const details = result.details as ShellResultShape | undefined;
  const status: string[] = [];

  if (details?.session_id !== undefined) status.push(`session ${details.session_id} running`);
  if (details?.exit_code !== undefined) status.push(`exit ${details.exit_code}`);

  const duration = formatDuration(details?.wall_time_seconds);
  if (duration) status.push(duration);

  const statusText = status.length > 0 ? `[${status.join(" · ")}]` : "";
  const statusLine = statusText ? theme.fg("muted", statusText) : "";
  const outputText = result.content
    .filter((item: any) => item.type === "text")
    .map((item: any) => item.text ?? "")
    .join("\n")
    .trimEnd();
  const statusOnlyOutput = Boolean(statusText) && outputText.trim() === statusText;
  const hasExpandableContent = !statusOnlyOutput && hasVisibleToolOutput(outputText);

  if (!options.expanded) {
    const collapsedHint = hasExpandableContent
      ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
      : "";
    return new Text([statusLine, collapsedHint].filter(Boolean).join(" "), 0, 0);
  }

  const styledOutput = hasExpandableContent
    ? outputText
        .split("\n")
        .map((line: string) => theme.fg("toolOutput", line))
        .join("\n")
    : "";

  const expandedHint = hasExpandableContent
    ? theme.fg("muted", `(${keyHint("app.tools.expand", "to collapse")})`)
    : "";

  if (!styledOutput && !statusLine) {
    return new Text("", 0, 0);
  }

  const footer = [statusLine, expandedHint].filter(Boolean).join(" ");

  if (!styledOutput) {
    return new Text(footer, 0, 0);
  }

  const joined = footer ? `${styledOutput}\n${footer}` : styledOutput;
  return new Text(`\n${joined}`, 0, 0);
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

function renderApplyPatchResult(result: any, options: { expanded: boolean }, theme: any) {
  const details = result.details as
    | {
        added: string[];
        updated: string[];
        deleted: string[];
        moved: Array<{ from: string; to: string }>;
      }
    | undefined;

  if (!details) return new Text("", 0, 0);

  const summary = [
    details.added.length > 0 ? `+${details.added.length}` : "",
    details.updated.length > 0 ? `~${details.updated.length}` : "",
    details.deleted.length > 0 ? `-${details.deleted.length}` : "",
    details.moved.length > 0 ? `>${details.moved.length}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const lines: string[] = [];
  for (const path of details.added) lines.push(`+ ${path}`);
  for (const path of details.updated) lines.push(`~ ${path}`);
  for (const path of details.deleted) lines.push(`- ${path}`);
  for (const move of details.moved) lines.push(`> ${move.from} -> ${move.to}`);
  const hasExpandableContent = lines.length > 0;

  if (!options.expanded) {
    const compact = summary ? theme.fg("muted", `[${summary}]`) : "";
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
  const lines = [
    "Applied patch successfully.",
    `Added files: ${summary.added.length}`,
    `Updated files: ${summary.updated.length}`,
    `Deleted files: ${summary.deleted.length}`,
    `Moved files: ${summary.moved.length}`,
  ];

  if (summary.added.length > 0) {
    lines.push(`Added: ${summary.added.join(", ")}`);
  }
  if (summary.updated.length > 0) {
    lines.push(`Updated: ${summary.updated.join(", ")}`);
  }
  if (summary.deleted.length > 0) {
    lines.push(`Deleted: ${summary.deleted.join(", ")}`);
  }
  if (summary.moved.length > 0) {
    lines.push(`Moved: ${summary.moved.map((move) => `${move.from} -> ${move.to}`).join(", ")}`);
  }

  return lines.join("\n");
}

function throwOnFailedExec(result: ShellResultShape) {
  if (result.exit_code === undefined || result.exit_code === 0) return;
  const output = result.output.trim();
  if (output.length > 0) {
    throw new Error(`${output}

Command exited with code ${result.exit_code}`);
  }
  throw new Error(`Command exited with code ${result.exit_code}`);
}

function buildCompatPromptDelta(): string {
  return [
    "Codex compatibility mode is active for this model.",
    "- Prefer exec_command for project exploration, searches, local file reads, scripts, and tests.",
    "- Pass workdir when you want to operate in another directory instead of using cd inside command text when practical.",
    "- Prefer apply_patch for edits, file creation, file deletion, and coordinated multi-file changes. Put the full patch text in the input field.",
    "- Prefer a single apply_patch call that updates all related files together when one coherent patch will do.",
    "- When making coordinated edits across multiple files, include them in one apply_patch call instead of splitting them into separate patches.",
    "- Prefer webresearch for external information gathering. Do not rely on any native web_search tool.",
    "- Use write_stdin only when exec_command returns a session_id for a still-running command.",
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

  const next = [...preserved, "exec_command", "write_stdin", "apply_patch"];
  if (capability.supportsImageInput) next.push("view_image");
  return Array.from(new Set(next));
}

function stripCompatTools(activeTools: string[]): string[] {
  return activeTools.filter((toolName) => !COMPAT_TOOL_NAMES.has(toolName));
}

function normalizeExecCommandArgs(args: unknown): {
  cmd: string;
  workdir?: string;
  shell?: string;
  tty?: boolean;
  yield_time_ms?: number;
  max_output_tokens?: number;
  timeout_ms?: number;
  login?: boolean;
} {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args as {
      cmd: string;
      workdir?: string;
      shell?: string;
      tty?: boolean;
      yield_time_ms?: number;
      max_output_tokens?: number;
      timeout_ms?: number;
      login?: boolean;
    };
  }

  const input = args as Record<string, unknown>;
  const next: Record<string, unknown> = { ...input };

  if (typeof input.cwd === "string" && next.workdir === undefined) {
    next.workdir = input.cwd;
  }

  if (typeof input.command === "string" && next.cmd === undefined) {
    next.cmd = input.command;
  }

  if (typeof input.wait_ms === "number" && next.yield_time_ms === undefined) {
    next.yield_time_ms = input.wait_ms;
  }

  if (typeof input.timeout === "number" && next.timeout_ms === undefined) {
    next.timeout_ms = input.timeout > 1000 ? input.timeout : input.timeout * 1000;
  }

  return next as {
    cmd: string;
    workdir?: string;
    shell?: string;
    tty?: boolean;
    yield_time_ms?: number;
    max_output_tokens?: number;
    timeout_ms?: number;
    login?: boolean;
  };
}

function normalizeWriteStdinArgs(args: unknown): {
  session_id: number;
  chars?: string;
  yield_time_ms?: number;
  max_output_tokens?: number;
} {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args as {
      session_id: number;
      chars?: string;
      yield_time_ms?: number;
      max_output_tokens?: number;
    };
  }

  const input = args as Record<string, unknown>;
  const next: Record<string, unknown> = { ...input };

  if (typeof input.sessionId === "number" && next.session_id === undefined) {
    next.session_id = input.sessionId;
  }

  if (typeof input.wait_ms === "number" && next.yield_time_ms === undefined) {
    next.yield_time_ms = input.wait_ms;
  }

  if (typeof input.input === "string" && next.chars === undefined) {
    next.chars = input.input;
  }

  return next as {
    session_id: number;
    chars?: string;
    yield_time_ms?: number;
    max_output_tokens?: number;
  };
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
  const shellSessions = new ShellSessionManager();
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
    name: "exec_command",
    label: "Exec Command",
    description:
      "Execute a shell command with an explicit workdir and resumable session support. Returns a JSON object with output, timing, exit_code when finished, and session_id when still running.",
    promptSnippet: "Run shell commands with explicit workdir and resumable sessions",
    promptGuidelines: [
      "Prefer exec_command for local searches, file reads, test runs, and scripts.",
      "Set workdir instead of relying on cd when practical.",
      "Use write_stdin only when an exec_command result includes a session_id.",
    ],
    parameters: EXEC_COMMAND_PARAMS,
    prepareArguments: normalizeExecCommandArgs,
    renderCall(args, theme) {
      return renderExecCall("exec_command", args, theme);
    },
    renderResult(result, options, theme) {
      return renderExecResult(result, options, theme);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cmd = params.cmd.trim();
      if (!cmd) throw new Error("exec_command requires a non-empty cmd.");

      const workdir = await resolveWorkdir(ctx.cwd, params.workdir);
      const result = await shellSessions.start(
        {
          cmd,
          workdir,
          shell: params.shell,
          tty: params.tty,
          timeoutMs: normalizeTimeoutMs(params.timeout_ms),
          yieldTimeMs: normalizeYieldMs(params.yield_time_ms),
          maxOutputTokens: normalizeMaxOutputTokens(params.max_output_tokens),
          login: params.login ?? true,
        },
        signal,
      );

      throwOnFailedExec(result);

      return {
        content: plainTextResult(result.output),
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "write_stdin",
    label: "Write Stdin",
    description:
      "Poll or continue a running exec_command session by session_id. Returns the same JSON result shape as exec_command.",
    promptSnippet: "Continue or poll a running exec_command session",
    promptGuidelines: [
      "Call write_stdin with empty chars to poll a running session.",
      "Use write_stdin only after exec_command returns a session_id.",
    ],
    parameters: WRITE_STDIN_PARAMS,
    prepareArguments: normalizeWriteStdinArgs,
    renderCall(args, theme) {
      return renderExecCall("write_stdin", args, theme);
    },
    renderResult(result, options, theme) {
      return renderExecResult(result, options, theme);
    },
    async execute(_toolCallId, params, signal) {
      const result = await shellSessions.write(
        {
          sessionId: params.session_id,
          chars: params.chars,
          yieldTimeMs: normalizeYieldMs(params.yield_time_ms),
          maxOutputTokens: normalizeMaxOutputTokens(params.max_output_tokens),
        },
        signal,
      );

      throwOnFailedExec(result);

      return {
        content: plainTextResult(result.output),
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "apply_patch",
    label: "Apply Patch",
    description:
      "Apply a multi-file patch. The input field must contain the full patch text, including file add, update, delete, and optional move directives.",
    promptSnippet: "Apply focused multi-file text patches",
    promptGuidelines: [
      "Use apply_patch for file edits, file creation, file deletion, and coordinated multi-file changes.",
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const summary = await applyPatch(ctx.cwd, params.input);
      return {
        content: plainTextResult(formatApplyPatchContent(summary)),
        details: summary,
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

  pi.on("session_shutdown", async () => {
    shellSessions.shutdown();
  });
}
