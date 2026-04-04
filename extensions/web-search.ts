/**
 * Web Search Extension
 *
 * What it does:
 * - Adds a `websearch` tool backed by Exa's MCP endpoint.
 * - Returns concise search context text suitable for follow-up fetch/summarize steps.
 *
 * How to use it:
 * - This tool is primarily internal to Pathfinder (`webresearch`).
 * - Set `CRUMBS_ENABLE_RAW_WEB_TOOLS=1` to expose it directly for debugging.
 *
 * Example:
 * - "Search for Bun HTMLRewriter docs and show the most relevant results"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAbort,
  clampTimeout,
  shouldRegisterRawWebTools,
  truncateInline,
  WEBSEARCH_DEFAULT_TIMEOUT,
  withTruncation,
} from "../shared/web-tools/common.js";

const EXA_URL = "https://mcp.exa.ai/mcp";

const WEBSEARCH_PARAMS = Type.Object({
  query: Type.String({ description: "Web search query" }),
  numResults: Type.Optional(
    Type.Number({ description: "Number of results to request from Exa (default: 8)" }),
  ),
  livecrawl: Type.Optional(
    StringEnum(["fallback", "preferred"] as const, {
      description:
        "Live crawl mode. fallback = use live crawl when cache is missing. preferred = prioritize live crawl.",
    }),
  ),
  type: Type.Optional(
    StringEnum(["auto", "fast"] as const, {
      description: "Search depth mode",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({ description: "Max context characters returned by Exa" }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default: 25, max: 240)" }),
  ),
});

interface WebSearchDetails {
  query: string;
  numResults: number;
  livecrawl: "fallback" | "preferred";
  type: "auto" | "fast";
  contextMaxCharacters?: number;
  truncation?: unknown;
}

interface SearchRequest {
  jsonrpc: "2.0";
  id: number;
  method: "tools/call";
  params: {
    name: "web_search_exa";
    arguments: {
      query: string;
      type: "auto" | "fast";
      numResults: number;
      livecrawl: "fallback" | "preferred";
      contextMaxCharacters?: number;
    };
  };
}

function parseSearchPayload(raw: string): string | undefined {
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

function parseSearchText(raw: string): string | undefined {
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = parseSearchPayload(line.slice(6));
    if (payload) return payload;
  }
  return undefined;
}

export default function webSearchExtension(pi: ExtensionAPI) {
  if (!shouldRegisterRawWebTools()) return;

  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description:
      "Search the web through Exa MCP. Returns concise search context text. Output is truncated to 2000 lines or 50KB.",
    promptSnippet: "Search the public web for current or external information",
    promptGuidelines: [
      "Use websearch before webfetch when you need to discover relevant URLs.",
      "Prefer targeted queries with entities (project name, doc page, version).",
    ],
    parameters: WEBSEARCH_PARAMS,
    renderCall(args, theme) {
      const query = truncateInline((args.query ?? "").trim(), 90);
      const mode = args.type ?? "auto";
      const count = args.numResults ?? 8;
      const text =
        `${theme.fg("toolTitle", theme.bold("websearch"))} ` +
        `${theme.fg("accent", query || "…")} ` +
        `${theme.fg("muted", `(${mode}, n=${count})`)}`;
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        const text = result.content.find((c) => c.type === "text");
        if (text?.type === "text") return new Text(theme.fg("warning", text.text), 0, 0);
        return new Text(theme.fg("warning", "Searching web..."), 0, 0);
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
    async execute(_toolCallId, params, signal) {
      const timeout = clampTimeout(params.timeout, WEBSEARCH_DEFAULT_TIMEOUT);
      const mode = params.type ?? "auto";
      const crawl = params.livecrawl ?? "fallback";
      const count = params.numResults ?? 8;

      const body: SearchRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: params.query,
            type: mode,
            numResults: count,
            livecrawl: crawl,
            contextMaxCharacters: params.contextMaxCharacters,
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
          throw new Error(`Search request failed (${response.status}): ${text}`);
        }

        const raw = await response.text();
        const output = parseSearchText(raw);

        if (!output) {
          return {
            content: [
              { type: "text", text: "No search results found. Try a more specific query." },
            ],
            details: {
              query: params.query,
              numResults: count,
              livecrawl: crawl,
              type: mode,
              contextMaxCharacters: params.contextMaxCharacters,
            } as WebSearchDetails,
          };
        }

        const cut = withTruncation(output);
        return {
          content: [{ type: "text", text: cut.text }],
          details: {
            query: params.query,
            numResults: count,
            livecrawl: crawl,
            type: mode,
            contextMaxCharacters: params.contextMaxCharacters,
            truncation: cut.truncation,
          } as WebSearchDetails,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Web search timed out after ${timeout}s`);
        }
        throw error;
      } finally {
        gate.clear();
      }
    },
  });
}
