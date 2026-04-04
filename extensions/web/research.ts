/**
 * Web Research Extension
 *
 * What it does:
 * - Adds a `webresearch` tool that launches an isolated web research subagent.
 * - The subagent searches/fetches pages in disposable context and returns targeted findings.
 *
 * How to use it:
 * - Provide `task` plus `query`, `urls`, or both.
 * - Provide `responseShape` so the returned synthesis matches exactly what you need.
 * - Optionally cap breadth with `maxResults` and `maxPages`.
 *
 * Example:
 * - "Research RDS Proxy session pinning for Django apps using query + links"
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
  buildAbort,
  clampTimeout,
  truncateInline,
  WEBRESEARCH_DEFAULT_TIMEOUT,
} from "./shared/common.js";
import { resolveResearchModel, type ResearchModelMode } from "./shared/research-model-selection.js";
import { buildResearchSystemPrompt, buildResearchTask } from "./shared/research-prompts.js";
import {
  runPathfinder,
  type PathfinderPhase,
  type PathfinderUsage,
} from "./shared/research-runner.js";

const WEB_RESEARCH_LABEL = "webresearch";
const CHILD_AGENT_NAME = "Web Research Specialist";

type ModelMode = ResearchModelMode;
type ResearchMode = "quick" | "balanced" | "thorough";

interface ResearchPreset {
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
  timeout: number;
  idleTimeout: number;
  maxSearchCalls: number;
}

const RESEARCH_PRESETS: Record<ResearchMode, ResearchPreset> = {
  quick: {
    maxResults: 4,
    maxPages: 2,
    maxCharsPerPage: 6_000,
    timeout: 75,
    idleTimeout: 30,
    maxSearchCalls: 1,
  },
  balanced: {
    maxResults: 6,
    maxPages: 4,
    maxCharsPerPage: 12_000,
    timeout: 120,
    idleTimeout: 45,
    maxSearchCalls: 2,
  },
  thorough: {
    maxResults: 10,
    maxPages: 8,
    maxCharsPerPage: 20_000,
    timeout: 420,
    idleTimeout: 90,
    maxSearchCalls: 3,
  },
};
const DEFAULT_WEB_RESEARCH_MODEL = "claude-haiku-4-5";

const WEBRESEARCH_PARAMS = Type.Object({
  task: Type.String({
    description: "Research goal. Be specific about what findings matter.",
  }),
  query: Type.Optional(Type.String({ description: "Search query to discover candidate sources." })),
  urls: Type.Optional(Type.Array(Type.String(), { description: "Explicit URLs to investigate." })),
  responseShape: Type.String({
    description:
      "Required. Exact shape/style of the synthesis you want back (bullets, JSON schema, sections, required fields, etc.).",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Exact web research model override (e.g., openai/gpt-5). Takes precedence over modelMode.",
    }),
  ),
  researchMode: Type.Optional(
    Type.Union([Type.Literal("quick"), Type.Literal("balanced"), Type.Literal("thorough")], {
      description:
        "Research depth preset. quick = low-latency budget, balanced = default, thorough = broader search/fetch and longer timeout.",
    }),
  ),
  modelMode: Type.Optional(
    Type.Union(
      [Type.Literal("auto"), Type.Literal("cheap"), Type.Literal("current"), Type.Literal("best")],
      {
        description:
          "Model strategy. auto = choose based on task complexity, cheap = lower cost, current = use current session model, best = stronger provider model when possible.",
      },
    ),
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
    Type.Union([Type.Literal("numeric"), Type.Literal("inline")], {
      description: "Citation format in the final synthesis (default: numeric).",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Overall timeout in seconds (mode-based default, max: 600)." }),
  ),
  idleTimeout: Type.Optional(
    Type.Number({
      description: "Idle timeout in seconds (abort if no progress updates; mode-based default).",
    }),
  ),
});

interface WebResearchDetails {
  status: "running" | "done" | "error";
  model: string;
  modelMode?: ModelMode;
  researchMode?: ResearchMode;
  modelReason?: string;
  provider?: string;
  task?: string;
  responseShape?: string;
  query?: string;
  urls?: string[];
  phase?: PathfinderPhase;
  note?: string;
  searches?: number;
  fetches?: number;
  usage?: PathfinderUsage;
  usageSummary?: string;
  elapsedMs?: number;
  error?: string;
}

function toLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function toIdleTimeout(
  value: number | undefined,
  fallback: number,
  overallTimeout: number,
): number {
  if (!Number.isFinite(value)) {
    return Math.max(10, Math.min(fallback, Math.max(10, overallTimeout - 5)));
  }
  const bounded = Math.max(10, Math.floor(value!));
  return Math.min(bounded, Math.max(10, overallTimeout - 5));
}

function phaseSummary(
  phase: PathfinderPhase,
  searches: number,
  fetches: number,
  note?: string,
): string {
  if (phase === "starting") return `starting${note ? ` — ${note}` : ""}`;
  if (phase === "searching") return `searching (${searches})${note ? ` — ${note}` : ""}`;
  if (phase === "reading") return `fetching (${fetches})${note ? ` — ${note}` : ""}`;
  return `compiling final synthesis${note ? ` — ${note}` : ""}`;
}

function renderRunTag(
  details: Partial<WebResearchDetails>,
  options?: { showUnknownWhenMissing?: boolean },
): string {
  const showUnknown = options?.showUnknownWhenMissing ?? false;
  const mode = details.researchMode;
  const modeTag =
    mode === "quick"
      ? "fast"
      : mode === "thorough"
        ? "deep"
        : mode === "balanced"
          ? "balanced"
          : showUnknown
            ? "..."
            : "balanced";

  const modelMode = details.modelMode;
  const costTag =
    modelMode === "cheap"
      ? "$"
      : modelMode === "current"
        ? "$$$"
        : modelMode === "best"
          ? "$$$$"
          : modelMode === "auto"
            ? "$$"
            : showUnknown
              ? "..."
              : "$$";

  return `[${modeTag}/${costTag}]`;
}

function activityLine(details: Partial<WebResearchDetails>, fallback?: string): string {
  if (fallback && fallback.trim()) return truncateInline(fallback.trim(), 110);

  const phase = details.phase ?? "starting";
  const note = (details.note ?? "").trim();

  if (phase === "searching") {
    if (note.startsWith("query:")) {
      return `searching "${truncateInline(note.slice(6).trim(), 86)}"`;
    }
    return "searching";
  }

  if (phase === "reading") {
    if (note.startsWith("url:")) {
      return `fetching "${truncateInline(note.slice(4).trim(), 86)}"`;
    }
    return "fetching";
  }

  if (phase === "synthesizing") return "compiling final synthesis";
  return "starting";
}

function formatElapsedShort(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m${seconds}s`;
}

function usageSummary(usage: PathfinderUsage): string {
  return [
    `↺${usage.turns}`,
    `↑${usage.input} ↓${usage.output}`,
    `$${usage.cost.toFixed(4)}`,
    usage.model ?? "(unknown model)",
  ].join(" | ");
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
      "Research a task with an isolated web research subagent. It can search + fetch pages and return targeted findings.",
    promptSnippet: "Run isolated web research and return targeted findings",
    promptGuidelines: [
      "Prefer webresearch for all web information gathering, including single URLs.",
      "Always provide responseShape so results match the exact output format you need.",
      "Use researchMode=quick for speed, balanced for normal work, and thorough for deeper coverage.",
      "Use modelMode=cheap for lightweight distillation and modelMode=best/current for advanced technical synthesis.",
      "Provide specific goals and constraints in task/query for better signal.",
    ],
    parameters: WEBRESEARCH_PARAMS,
    renderCall(args, theme) {
      const task = truncateInline((args.task ?? "").trim(), 76);
      const tag = renderRunTag(
        {
          researchMode: args.researchMode as ResearchMode | undefined,
          modelMode: args.modelMode as ModelMode | undefined,
        },
        { showUnknownWhenMissing: true },
      );
      const title = `${theme.fg("toolTitle", theme.bold(WEB_RESEARCH_LABEL))} ${theme.fg("muted", tag)} ${theme.fg("accent", `"${task || "..."}"`)}`;
      return new Text(title, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      const details = (result.details ?? {}) as Partial<WebResearchDetails>;

      if (isPartial || details.status === "running") {
        const textPart = result.content.find((c) => c.type === "text");
        const activity = activityLine(
          details,
          textPart?.type === "text" ? textPart.text : undefined,
        );
        const elapsed = formatElapsedShort(details.elapsedMs ?? 0);
        const status = theme.fg("muted", `└ [${elapsed}] ${activity}`);
        return new Text(status, 0, 0);
      }

      if (details.status === "error") {
        const message = details.error || "Research failed";
        return new Text(theme.fg("error", `✗ ${message}`), 0, 0);
      }

      const content = result.content.find((c) => c.type === "text");
      const output = content?.type === "text" ? content.text : "";

      if (!expanded) {
        const parts: string[] = [];
        if (Number.isFinite(details.elapsedMs)) {
          parts.push(formatElapsedShort(details.elapsedMs ?? 0));
        }
        if (details.usageSummary) {
          parts.push(details.usageSummary);
        }
        const line = parts.join(" | ");
        return new Text(line ? theme.fg("dim", line) : "", 0, 0);
      }

      const usage = details.usageSummary ? `\n${theme.fg("dim", details.usageSummary)}` : "";
      if (!output && !usage) return new Text("", 0, 0);
      return new Text(`${theme.fg("toolOutput", output)}${usage}`, 0, 0);
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const rawUrls = (params.urls ?? []) as string[];
      const urls = rawUrls.map((u: string) => u.trim()).filter((u: string) => u.length > 0);
      const query = typeof params.query === "string" ? params.query.trim() : undefined;
      const hasQuery = Boolean(query);
      const hasUrls = urls.length > 0;
      const researchMode = (params.researchMode ?? "balanced") as ResearchMode;
      const preset = RESEARCH_PRESETS[researchMode];
      const modelMode = (params.modelMode ??
        (researchMode === "quick" ? "cheap" : "auto")) as ModelMode;

      if (!hasQuery && !hasUrls) {
        return {
          content: [{ type: "text", text: "Provide at least `query` or `urls` (or both)." }],
          details: {
            status: "error",
            model: DEFAULT_WEB_RESEARCH_MODEL,
            modelMode,
            researchMode,
            error: "missing_input",
          } as WebResearchDetails,
          isError: true,
        };
      }

      const timeout = clampTimeout(params.timeout, preset.timeout ?? WEBRESEARCH_DEFAULT_TIMEOUT);
      const idleTimeout = toIdleTimeout(params.idleTimeout, preset.idleTimeout, timeout);
      const maxResults = toLimit(params.maxResults, preset.maxResults, 1, 12);
      const maxPages = toLimit(params.maxPages, preset.maxPages, 1, 10);
      const maxCharsPerPage = toLimit(
        params.maxCharsPerPage,
        preset.maxCharsPerPage,
        2_000,
        30_000,
      );
      const citationStyle = (params.citationStyle ?? "numeric") as "numeric" | "inline";
      const maxSearchCalls = Math.max(1, Math.min(maxResults, preset.maxSearchCalls));
      const responseShape = params.responseShape.trim();

      const resolution = await resolveResearchModel({
        explicitModel: params.model,
        modelMode,
        provider: ctx.model?.provider ?? lastProvider,
        currentModelId: ctx.model?.id ?? lastModelId,
        task: params.task,
        query,
        maxResults,
        maxPages,
        maxCharsPerPage,
        cwd: ctx.cwd,
      });
      const model = resolution.model;

      const systemPrompt = buildResearchSystemPrompt({
        agentName: CHILD_AGENT_NAME,
        hasQuery,
        hasUrls,
        maxResults,
        maxPages,
        maxCharsPerPage,
        citationStyle,
        responseShape,
      });

      const task = buildResearchTask({
        task: params.task,
        query,
        urls,
        maxResults,
        maxPages,
        maxCharsPerPage,
        responseShape,
      });

      const extensionPaths = [
        path.resolve(extensionDir, "search.ts"),
        path.resolve(extensionDir, "fetch.ts"),
      ];

      let phase: PathfinderPhase = "starting";
      let note = "";
      let searches = 0;
      let fetches = 0;
      const startedAt = Date.now();

      const emitProgress = () => {
        const text = phaseSummary(phase, searches, fetches, note);
        onUpdate?.({
          content: [{ type: "text", text }],
          details: {
            status: "running",
            model,
            modelMode: resolution.mode,
            researchMode,
            modelReason: resolution.reason,
            provider: resolution.provider,
            task: params.task,
            responseShape,
            query,
            urls,
            phase,
            note,
            searches,
            fetches,
            elapsedMs: Date.now() - startedAt,
          } as WebResearchDetails,
        });
      };

      const tick = setInterval(() => {
        emitProgress();
      }, 250);

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
          idleTimeoutSeconds: idleTimeout,
          env: {
            CRUMBS_RESEARCH_MAX_SEARCH_CALLS: String(maxSearchCalls),
            CRUMBS_RESEARCH_MAX_FETCH_CALLS: String(maxPages),
            CRUMBS_RESEARCH_MAX_RESULTS: String(maxResults),
            CRUMBS_RESEARCH_MAX_CHARS_PER_PAGE: String(maxCharsPerPage),
          },
          onProgress: (progress) => {
            phase = progress.phase;
            note = progress.note ?? "";
            searches = progress.searches;
            fetches = progress.fetches;
            emitProgress();
          },
        });

        if (gate.signal.aborted || run.abortedBy === "idle_timeout") {
          const canceled = signal?.aborted;
          const idleTimedOut = run.abortedBy === "idle_timeout";
          const message = canceled
            ? `${WEB_RESEARCH_LABEL} was canceled.`
            : idleTimedOut
              ? `${WEB_RESEARCH_LABEL} timed out after ${idleTimeout}s with no progress.`
              : `${WEB_RESEARCH_LABEL} timed out after ${timeout}s.`;
          return {
            content: [{ type: "text", text: message }],
            details: {
              status: "error",
              model,
              modelMode: resolution.mode,
              researchMode,
              modelReason: resolution.reason,
              provider: resolution.provider,
              task: params.task,
              responseShape,
              query,
              urls,
              phase,
              searches: run.searches,
              fetches: run.fetches,
              elapsedMs: run.elapsedMs,
              error: canceled ? "canceled" : idleTimedOut ? "timeout_idle" : "timeout_overall",
            } as WebResearchDetails,
            isError: true,
          };
        }

        if (run.exitCode !== 0) {
          const message =
            run.stderr.trim() || run.output.trim() || "Web research failed with no output.";
          return {
            content: [{ type: "text", text: `Research failed: ${message}` }],
            details: {
              status: "error",
              model,
              modelMode: resolution.mode,
              researchMode,
              modelReason: resolution.reason,
              provider: resolution.provider,
              task: params.task,
              responseShape,
              query,
              urls,
              phase,
              searches: run.searches,
              fetches: run.fetches,
              usage: run.usage,
              elapsedMs: run.elapsedMs,
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
            model: run.usage.model ?? model,
            modelMode: resolution.mode,
            researchMode,
            modelReason: resolution.reason,
            provider: resolution.provider,
            task: params.task,
            responseShape,
            query,
            urls,
            phase: "synthesizing",
            searches: run.searches,
            fetches: run.fetches,
            usage: run.usage,
            usageSummary: summary,
            elapsedMs: run.elapsedMs,
          } as WebResearchDetails,
        };
      } finally {
        clearInterval(tick);
        gate.clear();
      }
    },
  });
}
