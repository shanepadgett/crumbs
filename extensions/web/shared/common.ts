import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type TruncationResult,
} from "@mariozechner/pi-coding-agent";

export const WEBFETCH_MAX_BYTES = 5 * 1024 * 1024;
export const WEBFETCH_DEFAULT_TIMEOUT = 30;
export const WEBSEARCH_DEFAULT_TIMEOUT = 25;
export const WEBRESEARCH_DEFAULT_TIMEOUT = 120;
export const WEBTOOLS_MAX_TIMEOUT = 600;

/**
 * Raw web tools (websearch/webfetch) are intended for internal webresearch use.
 * Set CRUMBS_ENABLE_RAW_WEB_TOOLS=1 to expose them in the parent agent for debugging.
 */
export function shouldRegisterRawWebTools(): boolean {
  return (
    process.env.CRUMBS_PATHFINDER_CHILD === "1" || process.env.CRUMBS_ENABLE_RAW_WEB_TOOLS === "1"
  );
}

export function clampTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  if (value < 1) return fallback;
  return Math.min(Math.floor(value), WEBTOOLS_MAX_TIMEOUT);
}

export function buildAbort(timeoutSeconds: number, parent: AbortSignal | undefined) {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  const id = setTimeout(abort, timeoutSeconds * 1000);

  if (parent) {
    if (parent.aborted) ctl.abort(parent.reason);
    parent.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: ctl.signal,
    clear: () => {
      clearTimeout(id);
      if (parent) parent.removeEventListener("abort", abort);
    },
  };
}

export function withTruncation(text: string): { text: string; truncation?: TruncationResult } {
  const cut = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!cut.truncated) {
    return { text: cut.content };
  }

  const suffix =
    `\n\n[Output truncated: showing ${cut.outputLines} of ${cut.totalLines} lines ` +
    `(${formatSize(cut.outputBytes)} of ${formatSize(cut.totalBytes)})]`;

  return {
    text: cut.content + suffix,
    truncation: cut,
  };
}

export function truncateInline(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function ensureHttpUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("URL must use http:// or https://");
  }
  return parsed;
}

export function mimeFromType(contentType: string | null): string {
  if (!contentType) return "";
  const [mime] = contentType.split(";");
  if (!mime) return "";
  return mime.trim().toLowerCase();
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

export function joinTextContent(
  content: Array<{ type: string; text?: string }>,
  fallback = "",
): string {
  return (
    content
      .filter(
        (c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string",
      )
      .map((c) => c.text)
      .join("\n") || fallback
  );
}
