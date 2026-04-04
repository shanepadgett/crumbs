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
 * - Optionally cap breadth with `maxResults`, `maxSearches`, and `maxFetches`.
 *
 * Example:
 * - "Research RDS Proxy session pinning for Django apps using query + links"
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { keyHint, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";
import { truncateInline } from "./shared/common.js";
import { resolveResearchModel, type ResearchModelMode } from "./shared/research-model-selection.js";
import { buildResearchSystemPrompt, buildResearchTask } from "./shared/research-prompts.js";
import {
  runPathfinder,
  type PathfinderPhase,
  type PathfinderUsage,
} from "./shared/research-runner.js";

const WEB_RESEARCH_LABEL = "webresearch";
const CHILD_AGENT_NAME = "Web Research Specialist";
const SEARCH_ICON = "⌕";
const FETCH_ICON = "⎘";

type ModelMode = ResearchModelMode;
type ResearchMode = "quick" | "balanced" | "deep";

interface ResearchPreset {
  maxResults: number;
  maxSearches: number;
  maxFetches: number;
  maxCharsPerPage: number;
}

const RESEARCH_PRESETS: Record<ResearchMode, ResearchPreset> = {
  quick: {
    maxResults: 6,
    maxSearches: 6,
    maxFetches: 4,
    maxCharsPerPage: 12_000,
  },
  balanced: {
    maxResults: 10,
    maxSearches: 10,
    maxFetches: 6,
    maxCharsPerPage: 20_000,
  },
  deep: {
    maxResults: 12,
    maxSearches: 16,
    maxFetches: 10,
    maxCharsPerPage: 24_000,
  },
};
const DEFAULT_WEB_RESEARCH_MODEL = "claude-haiku-4-5";

function normalizeResearchMode(value: unknown): ResearchMode | undefined {
  if (typeof value !== "string") return undefined;
  const mode = value.trim().toLowerCase();
  if (mode === "thorough") return "deep";
  if (mode === "quick" || mode === "balanced" || mode === "deep") return mode;
  return undefined;
}

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
    Type.Union(
      [
        Type.Literal("quick"),
        Type.Literal("balanced"),
        Type.Literal("deep"),
        Type.Literal("thorough"),
      ],
      {
        description:
          "Research depth preset. quick = low-latency budget, balanced = default, deep = broader aggregate web action budget. `thorough` is accepted as a deprecated alias.",
      },
    ),
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
    Type.Number({
      description:
        "Max search results to consider (defaults vary by researchMode; balanced defaults to 10).",
    }),
  ),
  maxSearches: Type.Optional(
    Type.Number({
      description:
        "Max websearch calls allowed before the agent should stop searching and switch to fetching (defaults vary by researchMode; balanced defaults to 10).",
    }),
  ),
  maxFetches: Type.Optional(
    Type.Number({
      description:
        "Max webfetch calls allowed before the agent should stop fetching and finalize from gathered evidence (defaults vary by researchMode; balanced defaults to 6).",
    }),
  ),
  maxActions: Type.Optional(
    Type.Number({
      description:
        "Deprecated total-action override. If set, it can only further limit the combined search+fetch budget.",
    }),
  ),
  maxPages: Type.Optional(Type.Number({ description: "Deprecated alias for maxActions." })),
  maxCharsPerPage: Type.Optional(
    Type.Number({
      description:
        "Preferred max characters per fetched page for synthesis (defaults vary by researchMode; balanced defaults to 20000).",
    }),
  ),
  citationStyle: Type.Optional(
    Type.Union([Type.Literal("numeric"), Type.Literal("inline")], {
      description:
        "Citation format to use only when the required response shape explicitly asks for citations or sources (default: numeric).",
    }),
  ),
});

type WebResearchParams = Static<typeof WEBRESEARCH_PARAMS>;

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
  budgetExhausted?: true;
}

function toLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value!)));
}

function phaseSummary(
  phase: PathfinderPhase,
  _searches: number,
  _fetches: number,
  note?: string,
): string {
  const trimmed = (note ?? "").trim();
  if (phase === "starting") return trimmed ? `starting — ${trimmed}` : "starting";
  if (phase === "searching") {
    return trimmed ? `searching "${truncateInline(trimmed, 86)}"` : "searching";
  }
  if (phase === "reading") {
    return trimmed ? `fetching "${truncateInline(trimmed, 86)}"` : "fetching";
  }
  return "synthesizing";
}

function renderRunTag(
  details: Partial<WebResearchDetails>,
  options?: { showUnknownWhenMissing?: boolean },
): string {
  const showUnknown = options?.showUnknownWhenMissing ?? false;
  const mode = normalizeResearchMode(details.researchMode);
  const modeTag = mode ?? (showUnknown ? "..." : "balanced");

  const modelMode = details.modelMode;
  const costTag =
    modelMode === "cheap"
      ? "$"
      : modelMode === "best"
        ? "$$$"
        : modelMode === "auto" || modelMode === "current"
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
    return note ? `searching "${truncateInline(note, 86)}"` : "searching";
  }

  if (phase === "reading") {
    return note ? `fetching "${truncateInline(note, 86)}"` : "fetching";
  }

  if (phase === "synthesizing") return "synthesizing";
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
    `↑${usage.input} ↓${usage.output}`,
    `$${usage.cost.toFixed(4)}`,
    usage.model ?? "(unknown model)",
  ].join(" | ");
}

function actionSummary(
  details: Partial<WebResearchDetails>,
  fg: (color: "error" | "muted", text: string) => string,
): string {
  const text = `${SEARCH_ICON}${details.searches ?? 0} ${FETCH_ICON}${details.fetches ?? 0}`;
  return details.budgetExhausted ? fg("error", text) : fg("muted", text);
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
      "Use researchMode=quick for speed, balanced for normal work, and deep for broader web action budget.",
      "Use modelMode=cheap for lightweight distillation and modelMode=best/current for advanced technical synthesis.",
      "Provide specific goals and constraints in task/query for better signal.",
    ],
    parameters: WEBRESEARCH_PARAMS,
    prepareArguments(args): WebResearchParams {
      if (!args || typeof args !== "object" || Array.isArray(args)) {
        return args as WebResearchParams;
      }
      const {
        timeout: _timeout,
        idleTimeout: _idleTimeout,
        ...rest
      } = args as Record<string, unknown>;
      return rest as WebResearchParams;
    },
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
          parts.push(theme.fg("dim", formatElapsedShort(details.elapsedMs ?? 0)));
        }
        parts.push(actionSummary(details, (color, text) => theme.fg(color, text)));
        if (details.usageSummary) {
          parts.push(theme.fg("dim", details.usageSummary));
        }
        if (output.trim()) {
          parts.push(theme.fg("dim", keyHint("app.tools.expand", "to expand")));
        }
        const line = parts.join(theme.fg("dim", " | "));
        return new Text(line, 0, 0);
      }

      const expandedParts: string[] = [];
      if (Number.isFinite(details.elapsedMs)) {
        expandedParts.push(theme.fg("dim", formatElapsedShort(details.elapsedMs ?? 0)));
      }
      expandedParts.push(actionSummary(details, (color, text) => theme.fg(color, text)));
      if (details.usageSummary) {
        expandedParts.push(theme.fg("dim", details.usageSummary));
      }
      if (output.trim()) {
        expandedParts.push(theme.fg("dim", keyHint("app.tools.expand", "to collapse")));
      }
      const summaryLine = expandedParts.join(theme.fg("dim", " | "));
      const footer = summaryLine ? `\n${summaryLine}` : "";
      if (!output && !footer) return new Text("", 0, 0);
      return new Text(`${theme.fg("toolOutput", output)}${footer}`, 0, 0);
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx: ExtensionContext) {
      const rawUrls = (params.urls ?? []) as string[];
      const urls = rawUrls.map((u: string) => u.trim()).filter((u: string) => u.length > 0);
      const query = typeof params.query === "string" ? params.query.trim() : undefined;
      const hasQuery = Boolean(query);
      const hasUrls = urls.length > 0;
      const researchMode = normalizeResearchMode(params.researchMode) ?? "balanced";
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

      const maxResults = toLimit(params.maxResults, preset.maxResults, 1, 12);
      const maxSearches = toLimit(params.maxSearches, preset.maxSearches, 1, 24);
      const maxFetches = toLimit(params.maxFetches, preset.maxFetches, 1, 16);
      const maxActions = toLimit(
        params.maxActions ?? params.maxPages,
        maxSearches + maxFetches,
        1,
        40,
      );
      const maxCharsPerPage = toLimit(
        params.maxCharsPerPage,
        preset.maxCharsPerPage,
        2_000,
        30_000,
      );
      const citationStyle = (params.citationStyle ?? "numeric") as "numeric" | "inline";
      const responseShape = params.responseShape.trim();

      const resolution = await resolveResearchModel({
        explicitModel: params.model,
        modelMode,
        provider: ctx.model?.provider ?? lastProvider,
        currentModelId: ctx.model?.id ?? lastModelId,
        task: params.task,
        query,
        maxResults,
        maxActions,
        maxCharsPerPage,
        cwd: ctx.cwd,
      });
      const model = resolution.model;

      const systemPrompt = buildResearchSystemPrompt({
        agentName: CHILD_AGENT_NAME,
        hasQuery,
        hasUrls,
        maxSearches,
        maxFetches,
        maxActions,
        maxResults,
        maxCharsPerPage,
        citationStyle,
        responseShape,
      });

      const task = buildResearchTask({
        task: params.task,
        query,
        urls,
        maxSearches,
        maxFetches,
        maxActions,
        maxResults,
        maxCharsPerPage,
        responseShape,
      });

      const extensionPaths = [
        path.resolve(extensionDir, "budget-controller.ts"),
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

      emitProgress();

      try {
        const run = await runPathfinder({
          cwd: ctx.cwd,
          task,
          systemPrompt,
          model,
          extensionPaths,
          signal,
          env: {
            CRUMBS_RESEARCH_MAX_SEARCHES: String(maxSearches),
            CRUMBS_RESEARCH_MAX_FETCHES: String(maxFetches),
            CRUMBS_RESEARCH_MAX_ACTIONS: String(maxActions),
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

        if (signal?.aborted || run.abortedBy === "signal") {
          return {
            content: [{ type: "text", text: `${WEB_RESEARCH_LABEL} was canceled.` }],
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
              error: "canceled",
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
              ...(run.budgetExhausted ? { budgetExhausted: true as const } : {}),
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
            ...(run.budgetExhausted ? { budgetExhausted: true as const } : {}),
          } as WebResearchDetails,
        };
      } finally {
        clearInterval(tick);
      }
    },
  });
}
