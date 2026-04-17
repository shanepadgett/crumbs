import { parseFrontmatter, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { completeSimple, type Model } from "@mariozechner/pi-ai";
import { readFile } from "node:fs/promises";
import type { AgentRegistry } from "../types.js";
import type { AgentConfig, GeneratedAgent } from "./model.js";

type GenerationReference = {
  name: string;
  prompt: string;
};

const GENERATED_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const GENERATION_SYSTEM_PROMPT = `You create Pi subagent definitions.

Return JSON only. No markdown fences. No prose before or after JSON.

Return exactly this shape:
{
  "name": "string",
  "description": "string",
  "prompt": "string"
}

Rules:
- name: short, reusable, file-friendly, lowercase, letters/numbers/hyphens only
- description: one sentence, concise, specific
- prompt: durable role prompt for repeated reuse
- prompt may use simple markdown-like structure such as short labels and bullet lists
- prompt must not include markdown fences
- prompt must not include YAML frontmatter
- prompt must not mention model, thinking level, or tools
- prompt must not be task-specific to one immediate request
- prompt must avoid generic assistant fluff
- prompt must match caveman style: concise, direct, high-signal, no filler
- prompt should focus on role, goal, rules, and expected output shape when useful`;

function extractTextContent(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if ((item as { type?: unknown }).type !== "text") continue;
    if (typeof (item as { text?: unknown }).text !== "string") continue;
    parts.push((item as { text: string }).text);
  }
  return parts.join("\n").trim();
}

function buildGenerationUserPrompt(description: string, references: GenerationReference[]): string {
  const referenceText = references
    .map(
      (reference) =>
        `<reference name="${reference.name}">\n${reference.prompt.trim()}\n</reference>`,
    )
    .join("\n\n");

  return `Create new Pi subagent from this description:

<description>
${description.trim()}
</description>

Generate:
- name
- description
- prompt

Constraints:
- name must be lowercase and match ^[a-z0-9][a-z0-9-]*$
- description must be one sentence
- prompt must be concise, reusable, and role-focused
- prompt may use simple markdown-like structure such as labels and bullet lists
- prompt must not include markdown fences or frontmatter
- prompt must not mention model, tool, or thinking configuration
- prompt must follow caveman style: concise, direct, practical, no filler
- prompt must be suitable for writing directly as subagent prompt body

Use these built-in agents as style references:
- scout

Match its level of brevity and durability, not its exact wording.

${referenceText}

Return JSON only.`;
}

function buildGenerationRetryPrompt(raw: string, error: string): string {
  return `Previous response was invalid.

Validation error:
${error}

Previous response:
<previous-response>
${raw}
</previous-response>

Fix it and return JSON only with exactly this shape:
{
  "name": "string",
  "description": "string",
  "prompt": "string"
}

Requirements:
- name must match ^[a-z0-9][a-z0-9-]*$
- description must be one sentence
- prompt must be non-empty
- prompt may use simple markdown-like structure such as labels and bullet lists
- prompt must not include markdown fences
- prompt must not include YAML frontmatter
- prompt must follow caveman style: concise, direct, practical, no filler
- no extra keys
- no prose outside JSON`;
}

function parseGeneratedAgent(raw: string): GeneratedAgent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Generation returned invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Generation must return JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";

  if (!name) throw new Error("Generation missing required field: name.");
  if (!description) throw new Error("Generation missing required field: description.");
  if (!prompt) throw new Error("Generation missing required field: prompt.");
  if (!GENERATED_NAME_PATTERN.test(name)) throw new Error("Generated name is invalid.");
  if (prompt.includes("```")) throw new Error("Generated prompt must not include markdown fences.");
  if (prompt.startsWith("---"))
    throw new Error("Generated prompt must not include YAML frontmatter.");

  return { name, description, prompt };
}

async function loadGenerationReferences(registry: AgentRegistry): Promise<GenerationReference[]> {
  const names = ["scout"];
  const references = await Promise.all(
    names.map(async (name) => {
      const agent = registry.agents.find((item) => item.source === "builtin" && item.name === name);
      if (!agent) return undefined;
      const content = await readFile(agent.filePath, "utf8");
      const parsed = parseFrontmatter<Record<string, unknown>>(content);
      return { name, prompt: parsed.body.trim() };
    }),
  );
  return references.filter((reference): reference is GenerationReference => Boolean(reference));
}

async function resolveGenerationModel(
  ctx: ExtensionCommandContext,
  config: AgentConfig,
): Promise<Model<any>> {
  if (config.modelMode === "explicit") {
    const [provider, id] = (config.model ?? "").split("/");
    const model = provider && id ? ctx.modelRegistry.find(provider, id) : undefined;
    if (!model) throw new Error(`Unable to find generation model ${config.model}.`);
    return model;
  }
  if (!ctx.model) throw new Error("No active model available for generation.");
  return ctx.model;
}

export async function generateAgentDefinition(
  ctx: ExtensionCommandContext,
  registry: AgentRegistry,
  config: AgentConfig,
  description: string,
): Promise<GeneratedAgent> {
  const model = await resolveGenerationModel(ctx, config);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);

  const references = await loadGenerationReferences(registry);
  let prompt = buildGenerationUserPrompt(description, references);
  let lastError = "Generation failed.";

  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await completeSimple(
      model,
      {
        systemPrompt: GENERATION_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: ctx.signal,
        maxTokens: 2048,
        ...(model.reasoning ? { reasoning: "medium" as const } : {}),
      },
    );

    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Generation failed.");
    }
    if (response.stopReason === "aborted") {
      throw new Error("Generation was aborted.");
    }

    const text = extractTextContent(response.content);
    try {
      return parseGeneratedAgent(text);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      prompt = buildGenerationRetryPrompt(text, lastError);
    }
  }

  throw new Error(`Failed after 3 generation attempts. ${lastError}`);
}
