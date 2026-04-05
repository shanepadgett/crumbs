/**
 * Code Search Extension
 *
 * What it does:
 * - Adds a `codesearch` tool backed by Exa's MCP endpoint.
 * - Returns focused code/documentation context text for implementation-oriented questions.
 *
 * How to use it:
 * - This tool is primarily internal to `webresearch`.
 * - Set `CRUMBS_ENABLE_RAW_WEB_TOOLS=1` to expose it directly for debugging.
 *
 * Example:
 * - "Find real-world examples of React useEffect cleanup patterns"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAbort,
  clampTimeout,
  shouldRegisterRawWebTools,
  truncateInline,
  WEBSEARCH_DEFAULT_TIMEOUT,
  withTruncation,
} from "./shared/common.js";
import { claimSearch } from "./shared/research-budget.js";
import { assertUrlAllowed } from "./shared/permissions.js";

const EXA_URL = "https://mcp.exa.ai/mcp";

const CODESEARCH_PARAMS = Type.Object({
  query: Type.String({ description: "Code/documentation search query" }),
  tokensNum: Type.Optional(
    Type.Number({ description: "Target context token budget (default: 5000)" }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default: 25, max: 600)" }),
  ),
});

interface CodeSearchDetails {
  query: string;
  tokensNum: number;
  truncation?: unknown;
}

interface CodeSearchRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tools/call";
  params: {
    name: "get_code_context_exa";
    arguments: {
      query: string;
      tokensNum: number;
    };
  };
}

function parseCodePayload(raw: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") return undefined;

  const result = (parsed as { result?: unknown }).result;
  if (!result || typeof result !== "object") return undefined;

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return undefined;

  const first = content[0];
  if (!first || typeof first !== "object") return undefined;

  const text = (first as { text?: unknown }).text;
  if (typeof text !== "string") return undefined;

  return text;
}

function parseCodeSearchText(raw: string): string | undefined {
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = parseCodePayload(line.slice(6));
    if (payload) return payload;
  }
  return undefined;
}

export default function codeSearchExtension(pi: ExtensionAPI) {
  if (!shouldRegisterRawWebTools()) return;

  pi.registerTool({
    name: "codesearch",
    label: "Code Search",
    description:
      "Search code and documentation context through Exa MCP. Returns concise context text. Output is truncated to 2000 lines or 50KB.",
    promptSnippet: "Search code/documentation context for implementation details",
    promptGuidelines: [
      "Use codesearch for API usage patterns, code examples, and implementation-oriented queries.",
      "Use websearch when you need broad discovery of pages before fetching.",
    ],
    parameters: CODESEARCH_PARAMS,
    renderCall(args, theme) {
      const query = truncateInline((args.query ?? "").trim(), 90);
      const tokensNum = args.tokensNum ?? 5000;
      const text =
        `${theme.fg("toolTitle", theme.bold("codesearch"))} ` +
        `${theme.fg("accent", query || "…")} ` +
        `${theme.fg("muted", `(tokens=${tokensNum})`)}`;
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        const text = result.content.find((c) => c.type === "text");
        if (text?.type === "text") return new Text(theme.fg("warning", text.text), 0, 0);
        return new Text(theme.fg("warning", "Searching code context..."), 0, 0);
      }

      if (!expanded) {
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const output = textContent.text
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");

      return output ? new Text(`\n${output}`, 0, 0) : new Text("", 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      await assertUrlAllowed(ctx.cwd, EXA_URL);
      const timeout = clampTimeout(params.timeout, WEBSEARCH_DEFAULT_TIMEOUT);
      const tokensNum = Math.max(500, Math.min(Math.floor(params.tokensNum ?? 5000), 20_000));

      // codesearch shares the same search-class budget as websearch.
      claimSearch(1);

      const body: CodeSearchRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "get_code_context_exa",
          arguments: {
            query: params.query,
            tokensNum,
          },
        },
      };

      const gate = buildAbort(timeout, signal);

      try {
        const headers: Record<string, string> = {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        };

        const key = process.env.EXA_API_KEY?.trim();
        if (key) headers["x-api-key"] = key;

        const response = await fetch(EXA_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: gate.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Code search request failed (${response.status}): ${text}`);
        }

        const raw = await response.text();
        const output = parseCodeSearchText(raw);

        if (!output) {
          return {
            content: [
              {
                type: "text",
                text: "No code context found. Try a more specific query with library/language names.",
              },
            ],
            details: {
              query: params.query,
              tokensNum,
            } as CodeSearchDetails,
          };
        }

        const cut = withTruncation(output);
        return {
          content: [{ type: "text", text: cut.text }],
          details: {
            query: params.query,
            tokensNum,
            truncation: cut.truncation,
          } as CodeSearchDetails,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Code search timed out after ${timeout}s`);
        }
        throw error;
      } finally {
        gate.clear();
      }
    },
  });
}
