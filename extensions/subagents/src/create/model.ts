import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveProjectRoot } from "../../../shared/config/project-root.js";
import { getDefaultProjectSubagentsDir } from "../../../shared/config/crumbs-runtime-paths.js";
import { clearAgentRegistryCache, discoverAgents } from "../agents.js";
import type { AgentRegistry, AgentSource, AgentSpec, AgentThinkingLevel } from "../types.js";

export type Scope = "project" | "user";
export type InheritMode = "inherit" | "explicit";

export type AgentConfig = {
  scope: Scope;
  modelMode: InheritMode;
  model?: string;
  thinkingMode: InheritMode;
  thinkingLevel?: AgentThinkingLevel;
  toolsMode: InheritMode;
  tools: string[];
};

export type CollisionAnalysis = {
  targetPath: string;
  overwrite?: AgentSpec;
  shadows: AgentSpec[];
};

export type GeneratedAgent = {
  name: string;
  description: string;
  prompt: string;
};

type DraftContent = {
  name: string;
  description: string;
  promptText: string;
};

export type CloneDraft = {
  kind: "clone";
  source: AgentSpec;
  config: AgentConfig;
  content: DraftContent;
};

export type NewDraft = {
  kind: "new";
  generated: GeneratedAgent;
  config: AgentConfig;
  content: DraftContent;
};

export type CreateDraft = CloneDraft | NewDraft;

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function sourceLabel(source: AgentSource): string {
  switch (source) {
    case "builtin":
      return "built-in";
    case "user":
      return "user";
    case "project":
      return "project";
    case "path":
      return "path";
  }
}

export function createCloneDraft(source: AgentSpec, config: AgentConfig): CloneDraft {
  return {
    kind: "clone",
    source,
    config,
    content: {
      name: source.name,
      description: source.description,
      promptText: source.promptText,
    },
  };
}

export function createNewDraft(generated: GeneratedAgent, config: AgentConfig): NewDraft {
  return {
    kind: "new",
    generated,
    config,
    content: {
      name: generated.name,
      description: generated.description,
      promptText: generated.prompt,
    },
  };
}

export function getConfigSummary(config: AgentConfig): {
  model: string;
  thinking: string;
  tools: string;
} {
  return {
    model: config.modelMode === "inherit" ? "inherit parent" : (config.model ?? ""),
    thinking: config.thinkingMode === "inherit" ? "inherit parent" : (config.thinkingLevel ?? ""),
    tools:
      config.toolsMode === "inherit"
        ? "inherit parent active tools"
        : config.tools.join(", ") || "none",
  };
}

async function resolveTargetPath(
  cwd: string,
  registry: AgentRegistry,
  scope: Scope,
  agentName: string,
): Promise<string> {
  if (scope === "user") return join(registry.userDir, `${agentName}.md`);
  const projectDir =
    registry.projectDir ?? getDefaultProjectSubagentsDir(await resolveProjectRoot(cwd));
  return join(projectDir, `${agentName}.md`);
}

export async function analyzeCollision(
  cwd: string,
  registry: AgentRegistry,
  scope: Scope,
  agentName: string,
): Promise<CollisionAnalysis> {
  const targetPath = await resolveTargetPath(cwd, registry, scope, agentName);
  const overwrite = registry.agents.find(
    (agent) => agent.name === agentName && agent.source === scope,
  );
  const shadows = registry.agents.filter((agent) => {
    if (agent.name !== agentName) return false;
    if (scope === "project") return agent.source === "user" || agent.source === "builtin";
    return agent.source === "builtin";
  });
  return { targetPath, overwrite, shadows };
}

export function buildDraftConfirmationLines(
  draft: CreateDraft,
  collision: CollisionAnalysis,
): string[] {
  const summary = getConfigSummary(draft.config);
  const lines =
    draft.kind === "clone"
      ? [
          "Mode: clone",
          `Source: ${draft.source.name} (${sourceLabel(draft.source.source)})`,
          `Destination scope: ${draft.config.scope}`,
          `Target path: ${collision.targetPath}`,
          `Model: ${summary.model}`,
          `Thinking level: ${summary.thinking}`,
          `Tools: ${summary.tools}`,
        ]
      : [
          "Mode: new",
          `Name: ${draft.content.name}`,
          `Description: ${draft.content.description}`,
          `Destination scope: ${draft.config.scope}`,
          `Target path: ${collision.targetPath}`,
          `Model: ${summary.model}`,
          `Thinking level: ${summary.thinking}`,
          `Tools: ${summary.tools}`,
        ];
  if (collision.overwrite)
    lines.push("", `Warning: will overwrite existing ${draft.config.scope} agent.`);
  lines.push(
    ...collision.shadows.map((agent) =>
      draft.config.scope === "project"
        ? `Note: project agent "${draft.content.name}" will shadow ${sourceLabel(agent.source)} agent.`
        : `Note: user agent "${draft.content.name}" will shadow built-in agent.`,
    ),
  );
  return lines;
}

export function buildAgentMarkdown(draft: CreateDraft): string {
  const lines = [
    "---",
    `name: ${yamlString(draft.content.name)}`,
    `description: ${yamlString(draft.content.description)}`,
  ];

  if (draft.config.modelMode === "explicit" && draft.config.model) {
    lines.push(`model: ${yamlString(draft.config.model)}`);
  }
  if (draft.config.thinkingMode === "explicit" && draft.config.thinkingLevel) {
    lines.push(`thinkingLevel: ${yamlString(draft.config.thinkingLevel)}`);
  }
  if (draft.config.toolsMode === "explicit" && draft.config.tools.length > 0) {
    lines.push("tools:");
    for (const tool of draft.config.tools) lines.push(`  - ${yamlString(tool)}`);
  }

  lines.push("---", "", draft.content.promptText.trim(), "");
  return lines.join("\n");
}

export async function persistDraft(
  cwd: string,
  targetPath: string,
  draft: CreateDraft,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buildAgentMarkdown(draft), "utf8");
  clearAgentRegistryCache();
  await discoverAgents(cwd, { refresh: true });
}
