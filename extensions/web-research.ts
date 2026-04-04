/**
 * Web Research Extension (Pathfinder)
 *
 * What it does:
 * - Adds a `webresearch` tool that launches an isolated Pathfinder subagent.
 * - Pathfinder searches/fetches pages in disposable context and returns only relevant findings.
 *
 * How to use it:
 * - Provide `task` plus `query`, `urls`, or both.
 * - Optionally cap breadth with `maxResults` and `maxPages`.
 * - Use `modelMode` to pick cheap/current/best strategy, or set `model` explicitly.
 *
 * Example:
 * - "Research RDS Proxy session pinning for Django apps using query + links"
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAbort,
  clampTimeout,
  truncateInline,
  WEBRESEARCH_DEFAULT_TIMEOUT,
} from "../shared/web-tools/common.js";
import {
  runPathfinder,
  type PathfinderPhase,
  type PathfinderUsage,
} from "../shared/web-tools/research-runner.js";

const PATHFINDER_NAME = "Pathfinder";
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;

type ModelMode = "auto" | "cheap" | "current" | "best";

const CHEAP_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4.1-mini",
  google: "gemini-2.0-flash",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-3-mini-fast",
  mistral: "mistral-small-latest",
  openrouter: "anthropic/claude-haiku-4-5",
};

const BEST_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-5",
  google: "gemini-2.5-pro",
  groq: "llama-3.3-70b-versatile",
  xai: "grok-3",
  mistral: "mistral-medium-latest",
  openrouter: "anthropic/claude-sonnet-4-5",
};

const DEFAULT_PATHFINDER_MODEL = "claude-haiku-4-5";
const COMPLEX_TASK_HINT =
  /(white\s*paper|paper|rag|retrieval|benchmark|ablation|trade\s*-?off|architecture|state\s*of\s*the\s*art|cutting\s*edge|research|survey|technical\s+analysis)/i;

const WEBRESEARCH_PARAMS = Type.Object({
  task: Type.String({
    description: "Research goal. Be specific about what findings matter.",
  }),
  query: Type.Optional(Type.String({ description: "Search query to discover candidate sources." })),
  urls: Type.Optional(Type.Array(Type.String(), { description: "Explicit URLs to investigate." })),
  model: Type.Optional(
    Type.String({
      description:
        "Exact Pathfinder model override (e.g., openai/gpt-5). Takes precedence over modelMode.",
    }),
  ),
  modelMode: Type.Optional(
    StringEnum(["auto", "cheap", "current", "best"] as const, {
      description:
        "Model strategy. auto = choose based on task complexity, cheap = lower cost, current = use current session model, best = stronger provider model when possible.",
    }),
  ),
  maxResults: Type.Optional(
    Type.Number({ description: "Max search results to consider (default: 6)." }),
  ),
  maxPages: Type.Optional(Type.Number({ description: "Max pages to fetch/read (default: 4)." })),
  maxCharsPerPage: Type.Optional(
    Type.Number({
      description: "Preferred max characters per fetched page for synthesis (default: 12000).",
    }),
  ),
  citationStyle: Type.Optional(
    StringEnum(["numeric", "inline"] as const, {
      description: "Citation format in the final synthesis (default: numeric).",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default: 120, max: 240)." }),
  ),
});

interface WebResearchDetails {
  status: "running" | "done" | "error";
  pathfinder: string;
  model: string;
  modelMode?: ModelMode;
  modelReason?: string;
  provider?: string;
  query?: string;
  urls?: string[];
  phase?: PathfinderPhase;
  note?: string;
  searches?: number;
  fetches?: number;
  usage?: PathfinderUsage;
  usageSummary?: string;
  error?: string;
}

interface ModelResolutionInput {
  explicitModel?: string;
  modelMode: ModelMode;
  provider?: string;
  currentModelId?: string;
  task: string;
  query?: string;
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
}

interface ModelResolutionResult {
  model: string;
  mode: ModelMode;
  reason: string;
  provider?: string;
}

function normalizeProvider(provider: string | undefined): string | undefined {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;
  return value;
}

function toCliModel(modelId: string, provider: string | undefined): string {
  const id = modelId.trim();
  const p = normalizeProvider(provider);
  if (!p) return id;
  if (id.startsWith(`${p}/`)) return id;

  // OpenRouter model IDs often contain a slash (e.g. anthropic/claude-*),
  // but still need the provider prefix for robust subprocess resolution.
  if (p === "openrouter") return `${p}/${id}`;

  // For other providers, if the id already has a provider prefix, keep it.
  if (id.includes("/")) return id;

  return `${p}/${id}`;
}

function isComplexResearch(
  input: Omit<ModelResolutionInput, "explicitModel" | "provider" | "currentModelId" | "modelMode">,
): boolean {
  let score = 0;

  if (input.maxPages >= 6) score += 1;
  if (input.maxResults >= 8) score += 1;
  if (input.maxCharsPerPage >= 16_000) score += 1;
  if (input.task.length >= 240) score += 1;
  if (input.query && input.query.length >= 120) score += 1;
  if (COMPLEX_TASK_HINT.test(`${input.task}\n${input.query ?? ""}`)) score += 1;

  return score >= 2;
}

function resolvePathfinderModel(input: ModelResolutionInput): ModelResolutionResult {
  const provider = normalizeProvider(input.provider);

  if (input.explicitModel) {
    return {
      model: toCliModel(input.explicitModel, provider),
      mode: input.modelMode,
      reason: "explicit model override",
      provider,
    };
  }

  const cheapModel = provider ? CHEAP_MODELS[provider] : undefined;
  const bestModel = provider ? BEST_MODELS[provider] : undefined;
  const currentModel = input.currentModelId
    ? toCliModel(input.currentModelId, provider)
    : undefined;

  if (input.modelMode === "current") {
    if (currentModel) {
      return {
        model: currentModel,
        mode: input.modelMode,
        reason: "current model requested",
        provider,
      };
    }
    if (cheapModel) {
      return {
        model: toCliModel(cheapModel, provider),
        mode: input.modelMode,
        reason: "current unavailable; falling back to cheap provider model",
        provider,
      };
    }
  }

  if (input.modelMode === "cheap") {
    if (cheapModel) {
      return {
        model: toCliModel(cheapModel, provider),
        mode: input.modelMode,
        reason: "cheap mode requested",
        provider,
      };
    }
    if (currentModel) {
      return {
        model: currentModel,
        mode: input.modelMode,
        reason: "cheap provider mapping unavailable; using current model",
        provider,
      };
    }
  }

  if (input.modelMode === "best") {
    if (bestModel) {
      return {
        model: toCliModel(bestModel, provider),
        mode: input.modelMode,
        reason: "best mode requested",
        provider,
      };
    }
    if (currentModel) {
      return {
        model: currentModel,
        mode: input.modelMode,
        reason: "best provider mapping unavailable; using current model",
        provider,
      };
    }
    if (cheapModel) {
      return {
        model: toCliModel(cheapModel, provider),
        mode: input.modelMode,
        reason: "best provider mapping unavailable; using cheap provider model",
        provider,
      };
    }
  }

  const complex = isComplexResearch({
    task: input.task,
    query: input.query,
    maxResults: input.maxResults,
    maxPages: input.maxPages,
    maxCharsPerPage: input.maxCharsPerPage,
  });

  if (complex && currentModel) {
    return {
      model: currentModel,
      mode: "auto",
      reason: "auto mode: complex task detected, using current model",
      provider,
    };
  }

  if (cheapModel) {
    return {
      model: toCliModel(cheapModel, provider),
      mode: "auto",
      reason: complex
        ? "auto mode: no current model, using cheap provider model"
        : "auto mode: lightweight task, using cheap provider model",
      provider,
    };
  }

  if (currentModel) {
    return {
      model: currentModel,
      mode: "auto",
      reason: "auto mode: no cheap mapping, using current model",
      provider,
    };
  }

  return {
    model: DEFAULT_PATHFINDER_MODEL,
    mode: "auto",
    reason: "fallback default model",
    provider,
  };
}

function toLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function phaseSummary(
  phase: PathfinderPhase,
  searches: number,
  fetches: number,
  note?: string,
): string {
  if (phase === "starting") return `starting up${note ? ` (${note})` : ""}`;
  if (phase === "searching") return `searching web (${searches})${note ? ` — ${note}` : ""}`;
  if (phase === "reading") return `reading sources (${fetches})${note ? ` — ${note}` : ""}`;
  return `synthesizing findings${note ? ` — ${note}` : ""}`;
}

function usageSummary(usage: PathfinderUsage): string {
  return [
    `${usage.turns} turns`,
    `↑${usage.input} ↓${usage.output}`,
    `$${usage.cost.toFixed(4)}`,
    usage.model ?? "(unknown model)",
  ].join(" | ");
}

function buildResearchSystemPrompt(params: {
  hasQuery: boolean;
  hasUrls: boolean;
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
  citationStyle: "numeric" | "inline";
}): string {
  const citationRule =
    params.citationStyle === "inline"
      ? "Include direct URL citations inline at the end of each claim."
      : "Use numeric citations like [1], [2] and provide a Sources section mapping numbers to URLs.";

  return `You are ${PATHFINDER_NAME}, a focused web research specialist.

Available tools:
- websearch: discover relevant URLs
- webfetch: retrieve readable page content

Operating rules:
- Keep costs low and stay on-task.
- Never call any tool other than websearch/webfetch.
- Respect limits strictly:
  - max search results considered: ${params.maxResults}
  - max pages fetched: ${params.maxPages}
  - preferred max chars consumed per page: ${params.maxCharsPerPage}
- Prioritize official docs, changelogs, specs, and primary sources.
- If a source looks low quality or irrelevant, skip it.

Workflow:
${params.hasQuery ? "1) Run websearch with the provided query and identify best candidates." : "1) Skip search (no query provided)."}
${params.hasUrls ? "2) Include provided URLs in evaluation and fetch queue." : "2) No explicit URLs provided."}
3) Fetch and read only the most relevant pages.
4) Synthesize findings for the request. Remove noise and tangents.

Output contract:
- Start with "## Key Findings"
- Then "## Evidence" with concise bullets tied to sources
- Then "## Sources"
- Include caveats and uncertainty when evidence is weak
- ${citationRule}
- Keep answer compact and scannable.`;
}

function buildResearchTask(params: {
  task: string;
  query?: string;
  urls: string[];
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
}): string {
  let text = `Research task:\n${params.task}`;
  if (params.query) text += `\n\nSearch query:\n${params.query}`;
  if (params.urls.length > 0) {
    text += `\n\nSeed URLs:\n${params.urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
  }

  text += `\n\nExecution limits:\n- maxResults: ${params.maxResults}\n- maxPages: ${params.maxPages}\n- maxCharsPerPage: ${params.maxCharsPerPage}`;
  return text;
}

export default function webResearchExtension(pi: ExtensionAPI) {
  if (process.env.CRUMBS_PATHFINDER_CHILD === "1") {
    return;
  }

  const extensionDir = path.dirname(fileURLToPath(import.meta.url));
  let lastProvider: string | undefined;
  let lastModelId: string | undefined;

  pi.on("model_select", async (event) => {
    lastProvider = event.model.provider;
    lastModelId = event.model.id;
  });

  pi.registerTool({
    name: "webresearch",
    label: "Web Research",
    description:
      "Research a task with Pathfinder (isolated subagent). Pathfinder can search + fetch pages and returns a concise, cited synthesis.",
    promptSnippet: "Run isolated web research and return concise, cited findings",
    promptGuidelines: [
      "Prefer webresearch for all web information gathering, including single URLs.",
      "Use modelMode=cheap for lightweight distillation and modelMode=best/current for advanced technical synthesis.",
      "Provide specific goals and constraints in task/query for better signal.",
    ],
    parameters: WEBRESEARCH_PARAMS,
    renderCall(args, theme) {
      const query = truncateInline((args.query ?? "").trim(), 70);
      const urlCount = args.urls?.length ?? 0;
      const task = truncateInline((args.task ?? "").trim(), 64);
      let text = `${theme.fg("toolTitle", theme.bold("webresearch"))} `;
      if (query) text += theme.fg("accent", `"${query}"`);
      if (urlCount > 0) {
        if (query) text += theme.fg("muted", " + ");
        text += theme.fg("accent", `${urlCount} URL(s)`);
      }
      if (!query && urlCount === 0) text += theme.fg("accent", "(needs query or urls)");
      text += `\n  ${theme.fg("dim", task || "...")}`;
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const details = (result.details ?? {}) as Partial<WebResearchDetails>;

      if (isPartial || details.status === "running") {
        const textPart = result.content.find((c) => c.type === "text");
        const line =
          textPart?.type === "text" ? textPart.text : `${PATHFINDER_NAME} is researching...`;
        return new Text(theme.fg("warning", line), 0, 0);
      }

      if (details.status === "error") {
        const message = details.error || "Research failed";
        return new Text(theme.fg("error", `✗ ${message}`), 0, 0);
      }

      const content = result.content.find((c) => c.type === "text");
      const output = content?.type === "text" ? content.text : "";

      if (!expanded) {
        let text = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", `${PATHFINDER_NAME} complete`)}`;
        if (details.phase) text += theme.fg("muted", ` (${details.phase})`);

        if (output) {
          const preview = output.split("\n").slice(0, 4).join("\n");
          text += `\n${theme.fg("toolOutput", preview)}`;
          if (output.split("\n").length > 4) {
            text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
          }
        }

        if (details.usageSummary) {
          text += `\n${theme.fg("dim", details.usageSummary)}`;
        }
        return new Text(text, 0, 0);
      }

      const mdTheme = getMarkdownTheme();
      const container = new Container();
      let header = `${theme.fg("success", "✓")} ${theme.fg("toolTitle", theme.bold(`${PATHFINDER_NAME} synthesis`))}`;
      if (details.model) header += theme.fg("muted", ` (${details.model})`);
      container.addChild(new Text(header, 0, 0));

      if (output) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(output, 0, 0, mdTheme));
      }

      if (details.usageSummary) {
        container.addChild(new Spacer(1));
        container.addChild(new Text(theme.fg("dim", details.usageSummary), 0, 0));
      }

      return container;
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const urls = (params.urls ?? []).map((u) => u.trim()).filter((u) => u.length > 0);
      const query = params.query?.trim();
      const hasQuery = Boolean(query);
      const hasUrls = urls.length > 0;
      const modelMode = params.modelMode ?? "auto";

      if (!hasQuery && !hasUrls) {
        return {
          content: [{ type: "text", text: "Provide at least `query` or `urls` (or both)." }],
          details: {
            status: "error",
            pathfinder: PATHFINDER_NAME,
            model: DEFAULT_PATHFINDER_MODEL,
            modelMode,
            error: "missing_input",
          } as WebResearchDetails,
          isError: true,
        };
      }

      const timeout = clampTimeout(params.timeout, WEBRESEARCH_DEFAULT_TIMEOUT);
      const maxResults = toLimit(params.maxResults, 6, 1, 12);
      const maxPages = toLimit(params.maxPages, 4, 1, 10);
      const maxCharsPerPage = toLimit(params.maxCharsPerPage, 12_000, 2_000, 30_000);
      const citationStyle = params.citationStyle ?? "numeric";

      const resolution = resolvePathfinderModel({
        explicitModel: params.model,
        modelMode,
        provider: ctx.model?.provider ?? lastProvider,
        currentModelId: ctx.model?.id ?? lastModelId,
        task: params.task,
        query,
        maxResults,
        maxPages,
        maxCharsPerPage,
      });
      const model = resolution.model;

      const systemPrompt = buildResearchSystemPrompt({
        hasQuery,
        hasUrls,
        maxResults,
        maxPages,
        maxCharsPerPage,
        citationStyle,
      });

      const task = buildResearchTask({
        task: params.task,
        query,
        urls,
        maxResults,
        maxPages,
        maxCharsPerPage,
      });

      const extensionPaths = [
        path.join(extensionDir, "web-search.ts"),
        path.join(extensionDir, "web-fetch.ts"),
      ];

      let phase: PathfinderPhase = "starting";
      let note = "";
      let searches = 0;
      let fetches = 0;
      let frame = 0;

      const emitProgress = () => {
        const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
        const text = `${spinner} ${PATHFINDER_NAME}: ${phaseSummary(phase, searches, fetches, note)}`;
        onUpdate?.({
          content: [{ type: "text", text }],
          details: {
            status: "running",
            pathfinder: PATHFINDER_NAME,
            model,
            modelMode: resolution.mode,
            modelReason: resolution.reason,
            provider: resolution.provider,
            query,
            urls,
            phase,
            note,
            searches,
            fetches,
          } as WebResearchDetails,
        });
      };

      const tick = setInterval(() => {
        frame += 1;
        emitProgress();
      }, 170);

      const gate = buildAbort(timeout, signal);
      emitProgress();

      try {
        const run = await runPathfinder({
          cwd: ctx.cwd,
          task,
          systemPrompt,
          model,
          extensionPaths,
          signal: gate.signal,
          onProgress: (progress) => {
            phase = progress.phase;
            note = progress.note ?? "";
            searches = progress.searches;
            fetches = progress.fetches;
            emitProgress();
          },
        });

        if (gate.signal.aborted) {
          const canceled = signal?.aborted;
          const message = canceled
            ? `${PATHFINDER_NAME} was canceled.`
            : `${PATHFINDER_NAME} timed out after ${timeout}s.`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              status: "error",
              pathfinder: PATHFINDER_NAME,
              model,
              modelMode: resolution.mode,
              modelReason: resolution.reason,
              provider: resolution.provider,
              query,
              urls,
              phase,
              searches: run.searches,
              fetches: run.fetches,
              error: canceled ? "canceled" : "timeout",
            } as WebResearchDetails,
            isError: true,
          };
        }

        if (run.exitCode !== 0) {
          const message =
            run.stderr.trim() || run.output.trim() || "Pathfinder failed with no output.";
          return {
            content: [{ type: "text", text: `Research failed: ${message}` }],
            details: {
              status: "error",
              pathfinder: PATHFINDER_NAME,
              model,
              modelMode: resolution.mode,
              modelReason: resolution.reason,
              provider: resolution.provider,
              query,
              urls,
              phase,
              searches: run.searches,
              fetches: run.fetches,
              usage: run.usage,
              error: message,
            } as WebResearchDetails,
            isError: true,
          };
        }

        const output = run.output.trim() || "No synthesis produced.";
        const summary = usageSummary(run.usage);

        return {
          content: [{ type: "text", text: output }],
          details: {
            status: "done",
            pathfinder: PATHFINDER_NAME,
            model: run.usage.model ?? model,
            modelMode: resolution.mode,
            modelReason: resolution.reason,
            provider: resolution.provider,
            query,
            urls,
            phase: "synthesizing",
            searches: run.searches,
            fetches: run.fetches,
            usage: run.usage,
            usageSummary: summary,
          } as WebResearchDetails,
        };
      } finally {
        clearInterval(tick);
        gate.clear();
      }
    },
  });
}
