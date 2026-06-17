import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type McpTool, type ServerState } from "./shared.js";

interface ToolDetails {
  server: string;
  truncated?: boolean;
  shownLines?: number;
  totalLines?: number;
  shownBytes?: number;
  totalBytes?: number;
  fullOutputPath?: string;
}

interface JsonSchemaProperty {
  type?: string | string[];
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
}

function expectsComplexType(propSchema: JsonSchemaProperty | undefined): boolean {
  const types = propSchema?.type
    ? Array.isArray(propSchema.type)
      ? propSchema.type
      : [propSchema.type]
    : [];
  return types.includes("array") || types.includes("object");
}

function coerceArgs(
  args: Record<string, unknown>,
  schema: JsonSchema | undefined,
): Record<string, unknown> {
  if (!schema?.properties) return args;
  const next = { ...args };

  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string") continue;
    if (!expectsComplexType(schema.properties[key])) continue;

    const trimmed = value.trim();
    const looksJson =
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"));

    if (!looksJson) continue;
    try {
      next[key] = JSON.parse(trimmed);
    } catch {
      next[key] = value;
    }
  }

  return next;
}

export function toPiMcpToolName(serverName: string, toolName: string): string {
  return `mcp_${serverName}_${toolName}`;
}

export function registerServerTool(
  pi: ExtensionAPI,
  tool: McpTool,
  serverName: string,
  servers: Map<string, ServerState>,
): void {
  const piToolName = toPiMcpToolName(serverName, tool.name);

  pi.registerTool({
    name: piToolName,
    label: piToolName,
    description: tool.description ?? "(no description)",
    promptSnippet: tool.description ?? piToolName,
    parameters: Type.Unsafe<Record<string, unknown>>(
      tool.inputSchema ?? { type: "object", properties: {} },
    ),
    prepareArguments(args) {
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return (args ?? {}) as Record<string, unknown>;
      }
      return coerceArgs(
        args as Record<string, unknown>,
        tool.inputSchema as JsonSchema | undefined,
      );
    },
    async execute(_toolCallId, params) {
      const state = servers.get(serverName);
      if (!state) throw new Error(`Server "${serverName}" unavailable`);

      if (!state.client.connected) {
        if (state.config.lifecycle !== "eager") {
          await state.client.connect(serverName, state.config);
        } else {
          throw new Error(`Server "${serverName}" disconnected`);
        }
      }

      const result = await state.client.callTool(tool.name, params);
      const textParts: string[] = [];
      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];

      for (const item of result.content ?? []) {
        if (item.type === "text") textParts.push(item.text);
        else if (item.type === "image") {
          images.push({
            type: "image",
            data: item.data,
            mimeType: item.mimeType ?? "image/png",
          });
        } else {
          textParts.push(JSON.stringify(item));
        }
      }

      if (result.isError) {
        throw new Error(textParts.join("\n") || "MCP tool error");
      }

      const details: ToolDetails = { server: serverName };
      const content: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [];

      if (textParts.length > 0) {
        const full = textParts.join("\n");
        const cut = truncateHead(full, {
          maxLines: DEFAULT_MAX_LINES,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let text = cut.content;
        if (cut.truncated) {
          const tempDir = await mkdtemp(join(tmpdir(), "mcp-"));
          const file = join(tempDir, `${tool.name}-output.txt`);
          await writeFile(file, full, "utf8");

          details.truncated = true;
          details.fullOutputPath = file;
          details.shownLines = cut.outputLines;
          details.totalLines = cut.totalLines;
          details.shownBytes = cut.outputBytes;
          details.totalBytes = cut.totalBytes;

          text += `\n\n[Output truncated: ${cut.outputLines}/${cut.totalLines} lines (${formatSize(cut.outputBytes)}/${formatSize(cut.totalBytes)}). Full output: ${file}]`;
        }

        content.push({ type: "text", text });
      }

      content.push(...images);

      return { content, details };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const header = `${theme.fg("toolTitle", theme.bold(`${piToolName} `))}${theme.fg("dim", `(${serverName})`)}`;
      if (!args || typeof args !== "object") {
        text.setText(header);
        return text;
      }

      const pairs = Object.entries(args as Record<string, unknown>)
        .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : String(v)}`)
        .join(" ");
      text.setText(pairs ? `${header} ${theme.fg("muted", pairs)}` : header);
      return text;
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Running…"), 0, 0);

      const details = result.details as ToolDetails | undefined;
      const textBlocks = (result.content ?? [])
        .filter((item): item is { type: "text"; text: string } => item.type === "text")
        .map((item) => item.text);
      const lineCount = textBlocks.reduce((sum, block) => sum + block.split("\n").length, 0);

      let summary = context.isError
        ? theme.fg("error", "✗ error")
        : lineCount === 0
          ? theme.fg("dim", "(no text output)")
          : theme.fg("success", `✓ ${lineCount} lines`);

      if (details?.truncated) {
        summary += theme.fg("warning", ` (truncated: ${details.shownLines}/${details.totalLines})`);
      }

      if (!expanded) {
        summary += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`)}`;
        return new Text(summary, 0, 0);
      }

      const body = textBlocks.length > 0 ? `\n${textBlocks.join("\n")}` : "";
      return new Text(`${summary}${body}`, 0, 0);
    },
  });
}
