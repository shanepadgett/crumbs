/**
 * Web Fetch Extension
 *
 * What it does:
 * - Adds a `webfetch` tool to fetch URL content as markdown/text/html.
 * - Supports inline image return and output truncation for large pages.
 *
 * How to use it:
 * - This tool is primarily internal to `webresearch`.
 * - Set `CRUMBS_ENABLE_RAW_WEB_TOOLS=1` to expose it directly for debugging.
 *
 * Example:
 * - "Fetch https://bun.sh/docs and return markdown"
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAbort,
  clampTimeout,
  ensureHttpUrl,
  isImageMime,
  mimeFromType,
  shouldRegisterRawWebTools,
  truncateInline,
  WEBFETCH_DEFAULT_TIMEOUT,
  WEBFETCH_MAX_BYTES,
  withTruncation,
} from "./shared/common.js";
import { claimFetch, maxCharsPerPage } from "./shared/research-budget.js";
import { htmlToMarkdown, htmlToText } from "./shared/html.js";
import { assertUrlAllowed } from "./shared/permissions.js";

const WEBFETCH_PARAMS = Type.Object({
  url: Type.String({ description: "URL to fetch (http:// or https://)" }),
  format: Type.Optional(
    Type.Union([Type.Literal("text"), Type.Literal("markdown"), Type.Literal("html")], {
      description: "Output format (default: markdown)",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default: 30, max: 600)" }),
  ),
});

interface WebFetchDetails {
  url: string;
  format: "text" | "markdown" | "html";
  mime: string;
  bytes: number;
  truncation?: unknown;
}

export default function webFetchExtension(pi: ExtensionAPI) {
  if (!shouldRegisterRawWebTools()) return;

  pi.registerTool({
    name: "webfetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and return page content as markdown, text, or html. Supports inline image output. Response body capped at 5MB.",
    promptSnippet: "Fetch a specific URL and extract readable content",
    promptGuidelines: [
      "Use webfetch after identifying a concrete URL to inspect.",
      "Prefer markdown or text format for summarization and citation tasks.",
    ],
    parameters: WEBFETCH_PARAMS,
    renderCall(args, theme) {
      const url = truncateInline((args.url ?? "").trim(), 90);
      const format = args.format ?? "markdown";
      const text =
        `${theme.fg("toolTitle", theme.bold("webfetch"))} ` +
        `${theme.fg("accent", url || "…")} ` +
        `${theme.fg("muted", `(${format})`)}`;
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) {
        const text = result.content.find((c) => c.type === "text");
        if (text?.type === "text") return new Text(theme.fg("warning", text.text), 0, 0);
        return new Text(theme.fg("warning", "Fetching page..."), 0, 0);
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
      const parsed = ensureHttpUrl(params.url);
      await assertUrlAllowed(ctx.cwd, parsed.toString());
      const format = (params.format ?? "markdown") as "text" | "markdown" | "html";
      const timeout = clampTimeout(params.timeout, WEBFETCH_DEFAULT_TIMEOUT);
      const gate = buildAbort(timeout, signal);

      claimFetch();

      try {
        let accept = "*/*";
        if (format === "markdown") {
          accept = "text/markdown;q=1.0, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
        }
        if (format === "text") {
          accept = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
        }
        if (format === "html") {
          accept = "text/html;q=1.0, application/xhtml+xml;q=0.9, */*;q=0.1";
        }

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.9",
        };

        const first = await fetch(parsed.toString(), {
          method: "GET",
          headers,
          signal: gate.signal,
        });

        const response =
          first.status === 403 && first.headers.get("cf-mitigated") === "challenge"
            ? await fetch(parsed.toString(), {
                method: "GET",
                headers: { ...headers, "User-Agent": "pi" },
                signal: gate.signal,
              })
            : first;

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const sizeHeader = response.headers.get("content-length");
        if (sizeHeader) {
          const size = Number.parseInt(sizeHeader, 10);
          if (Number.isFinite(size) && size > WEBFETCH_MAX_BYTES) {
            throw new Error("Response too large (limit is 5MB)");
          }
        }

        const buf = await response.arrayBuffer();
        if (buf.byteLength > WEBFETCH_MAX_BYTES) {
          throw new Error("Response too large (limit is 5MB)");
        }

        const contentType = response.headers.get("content-type");
        const mime = mimeFromType(contentType);

        if (isImageMime(mime)) {
          const data = Buffer.from(buf).toString("base64");
          return {
            content: [
              { type: "text", text: `Fetched image from ${parsed.toString()} (${mime})` },
              { type: "image", data, mimeType: mime },
            ],
            details: {
              url: parsed.toString(),
              format,
              mime,
              bytes: buf.byteLength,
            } as WebFetchDetails,
          };
        }

        const raw = new TextDecoder().decode(buf);
        const text =
          format === "html"
            ? raw
            : format === "text"
              ? mime.includes("text/html")
                ? htmlToText(raw)
                : raw
              : mime.includes("text/html")
                ? htmlToMarkdown(raw)
                : raw;

        const perPageCap = maxCharsPerPage();
        const budgetedText =
          perPageCap && text.length > perPageCap
            ? `${text.slice(0, perPageCap)}\n\n[Per-page character cap reached (${perPageCap}).]`
            : text;

        const cut = withTruncation(budgetedText);
        return {
          content: [{ type: "text", text: cut.text }],
          details: {
            url: parsed.toString(),
            format,
            mime,
            bytes: buf.byteLength,
            truncation: cut.truncation,
          } as WebFetchDetails,
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`Web fetch timed out after ${timeout}s`);
        }
        throw error;
      } finally {
        gate.clear();
      }
    },
  });
}
