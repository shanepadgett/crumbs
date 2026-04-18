import type { Model } from "@mariozechner/pi-ai";

export interface CodexCompatCapabilities {
  provider: string;
  modelId: string;
  supportsImageInput: boolean;
  supportsOriginalImageDetail: boolean;
}

function capability(
  provider: string,
  modelId: string,
  overrides: Partial<Omit<CodexCompatCapabilities, "provider" | "modelId">> = {},
): CodexCompatCapabilities {
  return {
    provider,
    modelId,
    supportsImageInput: true,
    supportsOriginalImageDetail: true,
    ...overrides,
  };
}

const REGISTRY = new Map<string, CodexCompatCapabilities>();

function register(provider: string, modelIds: readonly string[], imageCapable = true) {
  for (const modelId of modelIds) {
    REGISTRY.set(
      `${provider}:${modelId}`,
      capability(provider, modelId, {
        supportsImageInput: imageCapable,
        supportsOriginalImageDetail: imageCapable,
      }),
    );
  }
}

register("openai", [
  "codex-mini-latest",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "o4-mini",
]);
register("openai", ["gpt-5.3-codex-spark"], false);

register("azure-openai-responses", [
  "codex-mini-latest",
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "o4-mini",
]);
register("azure-openai-responses", ["gpt-5.3-codex-spark"], false);

register("github-copilot", [
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
]);

register("openai-codex", [
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
]);
register("openai-codex", ["gpt-5.3-codex-spark"], false);

register("opencode", [
  "gpt-5-codex",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
]);

register("openrouter", [
  "openai/gpt-5-codex",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-codex-max",
  "openai/gpt-5.1-codex-mini",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.3-codex",
]);

register("vercel-ai-gateway", [
  "openai/gpt-5-codex",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-codex-max",
  "openai/gpt-5.1-codex-mini",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.3-codex",
]);

export function getCodexCompatCapabilities(
  model: Pick<Model<any>, "provider" | "id"> | undefined,
): CodexCompatCapabilities | undefined {
  if (!model) return undefined;
  return REGISTRY.get(`${model.provider}:${model.id}`);
}
