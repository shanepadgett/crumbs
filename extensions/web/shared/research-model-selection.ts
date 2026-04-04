/**
 * Web Research Model Selection
 *
 * What it does:
 * - Resolves model selection for webresearch using explicit tier maps.
 * - Stays on the active provider and only falls back within that provider.
 *
 * How to use it:
 * - Call `resolveResearchModel(...)` from `research.ts`.
 *
 * Example:
 * - resolveResearchModel({ modelMode: "cheap", provider: "openai-codex", ... })
 */

import { spawn } from "node:child_process";

export type ResearchModelMode = "auto" | "cheap" | "current" | "best";

type Tier = "cheap" | "balanced" | "best";

interface TierSpec {
  model: string;
}

interface ProviderTierSpec {
  cheap?: TierSpec;
  balanced?: TierSpec;
  best?: TierSpec;
}

export interface ResolveResearchModelInput {
  explicitModel?: string;
  modelMode: ResearchModelMode;
  provider?: string;
  currentModelId?: string;
  task: string;
  query?: string;
  maxResults: number;
  maxActions: number;
  maxCharsPerPage: number;
  cwd: string;
}

export interface ResolveResearchModelResult {
  model: string;
  mode: ResearchModelMode;
  reason: string;
  provider?: string;
}

const DEFAULT_WEB_RESEARCH_MODEL = "claude-haiku-4-5";
const COMPLEX_TASK_HINT =
  /(white\s*paper|paper|rag|retrieval|benchmark|ablation|trade\s*-?off|architecture|state\s*of\s*the\s*art|cutting\s*edge|research|survey|technical\s+analysis)/i;

const PROVIDER_ALIASES: Record<string, string> = {
  codex: "openai-codex",
  openai_codex: "openai-codex",
};

const RESEARCH_TIER_MAP: Record<string, ProviderTierSpec> = {
  openai: {
    cheap: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    best: { model: "gpt-5.4" },
  },
  "openai-codex": {
    cheap: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    best: { model: "gpt-5.4" },
  },
  anthropic: {
    cheap: { model: "claude-haiku-4-5" },
    balanced: { model: "claude-sonnet-4-5" },
    best: { model: "claude-opus-4-6" },
  },
  google: {
    cheap: { model: "gemini-2.0-flash" },
    balanced: { model: "gemini-2.5-pro" },
    best: { model: "gemini-3.1-pro-preview" },
  },
  "google-gemini-cli": {
    cheap: { model: "gemini-3-flash-preview" },
    balanced: { model: "gemini-3-pro-preview" },
    best: { model: "gemini-3.1-pro-preview" },
  },
  "google-antigravity": {
    cheap: { model: "gemini-3-flash-preview" },
    balanced: { model: "gemini-3-pro-preview" },
    best: { model: "gemini-3.1-pro-preview" },
  },
  "github-copilot": {
    cheap: { model: "gpt-5.4-mini" },
    balanced: { model: "claude-sonnet-4.6" },
    best: { model: "claude-opus-4.6" },
  },
  mistral: {
    cheap: { model: "mistral-small-latest" },
    balanced: { model: "mistral-medium-latest" },
    best: { model: "mistral-large-latest" },
  },
  groq: {
    cheap: { model: "llama-3.3-70b-versatile" },
    balanced: { model: "llama-3.3-70b-versatile" },
    best: { model: "llama-3.3-70b-versatile" },
  },
  xai: {
    cheap: { model: "grok-3-mini-fast" },
    balanced: { model: "grok-3" },
    best: { model: "grok-3" },
  },
  openrouter: {
    cheap: { model: "anthropic/claude-haiku-4-5" },
    balanced: { model: "anthropic/claude-sonnet-4-5" },
    best: { model: "anthropic/claude-opus-4-6" },
  },
  "azure-openai-responses": {
    cheap: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    best: { model: "gpt-5.4" },
  },
};

const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache:
  | {
      at: number;
      modelsByProvider: Map<string, Set<string>>;
    }
  | undefined;

function normalizeProvider(provider: string | undefined): string | undefined {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;
  if (PROVIDER_ALIASES[value]) return PROVIDER_ALIASES[value];
  return value;
}

function toCliModel(modelId: string, provider: string | undefined): string {
  const id = modelId.trim();
  const p = normalizeProvider(provider);
  if (!p) return id;
  if (id.startsWith(`${p}/`)) return id;

  if (p === "openrouter") return `${p}/${id}`;
  if (id.includes("/")) return id;

  return `${p}/${id}`;
}

function isComplexResearch(input: {
  task: string;
  query?: string;
  maxResults: number;
  maxActions: number;
  maxCharsPerPage: number;
}): boolean {
  let score = 0;
  if (input.maxActions >= 8) score += 1;
  if (input.maxResults >= 8) score += 1;
  if (input.maxCharsPerPage >= 16_000) score += 1;
  if (input.task.length >= 240) score += 1;
  if (input.query && input.query.length >= 120) score += 1;
  if (COMPLEX_TASK_HINT.test(`${input.task}\n${input.query ?? ""}`)) score += 1;
  return score >= 2;
}

function parseModelCatalog(text: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const lines = text.split("\n").map((l) => l.trim());

  for (const line of lines) {
    if (!line || line.startsWith("provider") || line.startsWith("No models")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const provider = normalizeProvider(parts[0]);
    const model = parts[1];
    if (!provider || !model) continue;

    const set = map.get(provider) ?? new Set<string>();
    set.add(model);
    map.set(provider, set);
  }

  return map;
}

async function loadModelCatalog(cwd: string): Promise<Map<string, Set<string>>> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.modelsByProvider;
  }

  const output = await new Promise<string>((resolve) => {
    const proc = spawn("pi", ["--list-models"], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let done = false;

    const finish = (value: string) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 1000);
      finish(stdout);
    }, 4000);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", () => {
      clearTimeout(timer);
      finish(stdout);
    });

    proc.on("error", () => {
      clearTimeout(timer);
      finish(stdout);
    });
  });

  const modelsByProvider = parseModelCatalog(output);
  catalogCache = { at: Date.now(), modelsByProvider };
  return modelsByProvider;
}

function modelForTier(spec: ProviderTierSpec, tier: Tier): string | undefined {
  if (tier === "cheap") return spec.cheap?.model;
  if (tier === "best") return spec.best?.model;
  return spec.balanced?.model;
}

function tierFallbackOrder(tier: Tier): Tier[] {
  if (tier === "cheap") return ["cheap", "balanced", "best"];
  if (tier === "best") return ["best", "balanced", "cheap"];
  return ["balanced", "cheap", "best"];
}

function pickTier(mode: ResearchModelMode, complex: boolean): Tier {
  if (mode === "cheap") return "cheap";
  if (mode === "best") return "best";
  if (mode === "current") return "balanced";
  return complex ? "best" : "balanced";
}

function hasModel(catalog: Map<string, Set<string>>, provider: string, model: string): boolean {
  if (catalog.size === 0) return true;
  return catalog.get(provider)?.has(model) ?? false;
}

export async function resolveResearchModel(
  input: ResolveResearchModelInput,
): Promise<ResolveResearchModelResult> {
  const provider = normalizeProvider(input.provider);

  if (input.explicitModel) {
    return {
      model: toCliModel(input.explicitModel, provider),
      mode: input.modelMode,
      reason: "explicit model override",
      provider,
    };
  }

  const currentModel = input.currentModelId
    ? toCliModel(input.currentModelId, provider)
    : undefined;

  if (input.modelMode === "current" && currentModel) {
    return {
      model: currentModel,
      mode: input.modelMode,
      reason: "current model requested",
      provider,
    };
  }

  const complex = isComplexResearch({
    task: input.task,
    query: input.query,
    maxResults: input.maxResults,
    maxActions: input.maxActions,
    maxCharsPerPage: input.maxCharsPerPage,
  });
  const tier = pickTier(input.modelMode, complex);
  const activeProvider =
    provider ??
    (input.currentModelId?.includes("/")
      ? normalizeProvider(input.currentModelId.split("/")[0])
      : undefined);

  if (activeProvider) {
    const spec = RESEARCH_TIER_MAP[activeProvider];
    if (spec) {
      const catalog = await loadModelCatalog(input.cwd);
      for (const candidateTier of tierFallbackOrder(tier)) {
        const model = modelForTier(spec, candidateTier);
        if (!model) continue;
        if (!hasModel(catalog, activeProvider, model)) continue;

        return {
          model: toCliModel(model, activeProvider),
          mode: input.modelMode,
          reason:
            candidateTier === tier
              ? `${input.modelMode} mode: using mapped ${candidateTier} tier`
              : `${input.modelMode} mode: mapped ${tier} unavailable, using ${candidateTier} tier`,
          provider: activeProvider,
        };
      }
    }
  }

  if (currentModel) {
    return {
      model: currentModel,
      mode: input.modelMode,
      reason: "no mapped model available; using current model",
      provider,
    };
  }

  return {
    model: DEFAULT_WEB_RESEARCH_MODEL,
    mode: input.modelMode,
    reason: "fallback default model",
    provider,
  };
}
