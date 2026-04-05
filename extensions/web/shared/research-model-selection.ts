/**
 * Web Research Model Selection
 *
 * What it does:
 * - Resolves model selection for webresearch using provider-specific tier maps.
 * - Keeps model choice directly tied to a single research mode: fast/balanced/deep.
 *
 * How to use it:
 * - Call `resolveResearchModel(...)` from `research.ts` with the selected `mode`.
 *
 * Example:
 * - resolveResearchModel({ mode: "fast", provider: "openai-codex", ... })
 */

import { spawn } from "node:child_process";

export type ResearchMode = "fast" | "balanced" | "deep";

type Tier = ResearchMode;

interface TierSpec {
  model: string;
}

interface ProviderTierSpec {
  fast?: TierSpec;
  balanced?: TierSpec;
  deep?: TierSpec;
}

export interface ResolveResearchModelInput {
  explicitModel?: string;
  mode: ResearchMode;
  provider?: string;
  currentModelId?: string;
  cwd: string;
}

export interface ResolveResearchModelResult {
  model: string;
  mode: ResearchMode;
  reason: string;
  provider?: string;
}

const DEFAULT_WEB_RESEARCH_MODEL = "claude-haiku-4-5";

const PROVIDER_ALIASES: Record<string, string> = {
  codex: "openai-codex",
  openai_codex: "openai-codex",
};

const RESEARCH_TIER_MAP: Record<string, ProviderTierSpec> = {
  openai: {
    fast: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    deep: { model: "gpt-5.4" },
  },
  "openai-codex": {
    fast: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    deep: { model: "gpt-5.4" },
  },
  anthropic: {
    fast: { model: "claude-haiku-4-5" },
    balanced: { model: "claude-sonnet-4-5" },
    deep: { model: "claude-opus-4-6" },
  },
  google: {
    fast: { model: "gemini-2.0-flash" },
    balanced: { model: "gemini-2.5-pro" },
    deep: { model: "gemini-3.1-pro-preview" },
  },
  "google-gemini-cli": {
    fast: { model: "gemini-3-flash-preview" },
    balanced: { model: "gemini-3-pro-preview" },
    deep: { model: "gemini-3.1-pro-preview" },
  },
  "google-antigravity": {
    fast: { model: "gemini-3-flash-preview" },
    balanced: { model: "gemini-3-pro-preview" },
    deep: { model: "gemini-3.1-pro-preview" },
  },
  "github-copilot": {
    fast: { model: "gpt-5.4-mini" },
    balanced: { model: "claude-sonnet-4.6" },
    deep: { model: "claude-opus-4.6" },
  },
  mistral: {
    fast: { model: "mistral-small-latest" },
    balanced: { model: "mistral-medium-latest" },
    deep: { model: "mistral-large-latest" },
  },
  groq: {
    fast: { model: "llama-3.3-70b-versatile" },
    balanced: { model: "llama-3.3-70b-versatile" },
    deep: { model: "llama-3.3-70b-versatile" },
  },
  xai: {
    fast: { model: "grok-3-mini-fast" },
    balanced: { model: "grok-3" },
    deep: { model: "grok-3" },
  },
  openrouter: {
    fast: { model: "anthropic/claude-haiku-4-5" },
    balanced: { model: "anthropic/claude-sonnet-4-5" },
    deep: { model: "anthropic/claude-opus-4-6" },
  },
  "azure-openai-responses": {
    fast: { model: "gpt-5.4-mini" },
    balanced: { model: "gpt-5.4" },
    deep: { model: "gpt-5.4" },
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
  if (tier === "fast") return spec.fast?.model;
  if (tier === "deep") return spec.deep?.model;
  return spec.balanced?.model;
}

function tierFallbackOrder(tier: Tier): Tier[] {
  if (tier === "fast") return ["fast", "balanced", "deep"];
  if (tier === "deep") return ["deep", "balanced", "fast"];
  return ["balanced", "fast", "deep"];
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
      mode: input.mode,
      reason: "explicit model override",
      provider,
    };
  }

  const currentModel = input.currentModelId
    ? toCliModel(input.currentModelId, provider)
    : undefined;

  const activeProvider =
    provider ??
    (input.currentModelId?.includes("/")
      ? normalizeProvider(input.currentModelId.split("/")[0])
      : undefined);

  if (activeProvider) {
    const spec = RESEARCH_TIER_MAP[activeProvider];
    if (spec) {
      const catalog = await loadModelCatalog(input.cwd);
      for (const candidateTier of tierFallbackOrder(input.mode)) {
        const model = modelForTier(spec, candidateTier);
        if (!model) continue;
        if (!hasModel(catalog, activeProvider, model)) continue;

        return {
          model: toCliModel(model, activeProvider),
          mode: input.mode,
          reason:
            candidateTier === input.mode
              ? `${input.mode} mode: using mapped ${candidateTier} tier`
              : `${input.mode} mode: mapped tier unavailable, using ${candidateTier} tier`,
          provider: activeProvider,
        };
      }
    }
  }

  if (currentModel) {
    return {
      model: currentModel,
      mode: input.mode,
      reason: "no mapped model available; using current model",
      provider,
    };
  }

  return {
    model: DEFAULT_WEB_RESEARCH_MODEL,
    mode: input.mode,
    reason: "fallback default model",
    provider,
  };
}
