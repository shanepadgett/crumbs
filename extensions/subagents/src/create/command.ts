import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "../agents.js";
import { THINKING_LEVEL_VALUES, type AgentRegistry, type AgentThinkingLevel } from "../types.js";
import { generateAgentDefinition } from "./generate.js";
import {
  analyzeCollision,
  buildDraftConfirmationLines,
  createCloneDraft,
  createNewDraft,
  persistDraft,
  sourceLabel,
  type AgentConfig,
  type CollisionAnalysis,
  type InheritMode,
  type Scope,
} from "./model.js";
import {
  confirmAction,
  pickFromList,
  pickTools,
  promptForText,
  runBusy,
  showMessage,
} from "./ui.js";

async function chooseScope(ctx: ExtensionCommandContext): Promise<Scope | undefined> {
  return pickFromList(ctx, "Choose destination scope", [
    {
      value: "project",
      label: "Project",
      description: "Write to .agents/crumbs/agents in project",
    },
    { value: "user", label: "User", description: "Write to ~/.agents/crumbs/agents" },
  ]);
}

async function collectAgentConfig(
  ctx: ExtensionCommandContext,
  allTools: string[],
  modelIds: string[],
  defaults?: {
    scope?: Scope;
    model?: string;
    thinkingLevel?: AgentThinkingLevel;
    tools?: string[];
  },
): Promise<AgentConfig | undefined> {
  const scope = defaults?.scope ?? (await chooseScope(ctx));
  if (!scope) return undefined;

  const modelChoices =
    defaults?.model && !modelIds.includes(defaults.model)
      ? [defaults.model, ...modelIds]
      : modelIds;
  const modelChoice = await pickFromList(
    ctx,
    "Choose model",
    [
      { value: "__inherit__", label: "inherit parent" },
      ...modelChoices.map((model) => ({ value: model, label: model })),
    ],
    defaults?.model ? Math.max(1, modelChoices.indexOf(defaults.model) + 1) : 0,
  );
  if (!modelChoice) return undefined;

  const thinkingChoice = await pickFromList(
    ctx,
    "Choose thinking level",
    [
      { value: "__inherit__", label: "inherit parent" },
      ...THINKING_LEVEL_VALUES.map((level) => ({ value: level, label: level })),
    ],
    defaults?.thinkingLevel
      ? Math.max(1, THINKING_LEVEL_VALUES.indexOf(defaults.thinkingLevel) + 1)
      : 0,
  );
  if (!thinkingChoice) return undefined;

  const defaultToolsMode: InheritMode = defaults?.tools?.length ? "explicit" : "inherit";
  const toolsChoice = await pickTools(ctx, allTools, defaultToolsMode, defaults?.tools ?? []);
  if (!toolsChoice) return undefined;

  return {
    scope,
    modelMode: modelChoice === "__inherit__" ? "inherit" : "explicit",
    model: modelChoice === "__inherit__" ? undefined : modelChoice,
    thinkingMode: thinkingChoice === "__inherit__" ? "inherit" : "explicit",
    thinkingLevel:
      thinkingChoice === "__inherit__"
        ? (defaults?.thinkingLevel ?? "low")
        : (thinkingChoice as AgentThinkingLevel),
    toolsMode: toolsChoice.mode,
    tools: toolsChoice.tools,
  };
}

async function confirmDraft(
  ctx: ExtensionCommandContext,
  registry: AgentRegistry,
  draft: ReturnType<typeof createCloneDraft> | ReturnType<typeof createNewDraft>,
) {
  const collision = await analyzeCollision(
    ctx.cwd,
    registry,
    draft.config.scope,
    draft.content.name,
  );
  const confirmed = await confirmAction(ctx, {
    title: draft.kind === "clone" ? "Confirm clone" : "Confirm new agent",
    lines: buildDraftConfirmationLines(draft, collision),
    confirmLabel: collision.overwrite ? "Update agent" : "Create agent",
    hint: "↑/↓ move • Enter confirm • Esc cancel",
  });
  return { collision, confirmed };
}

async function persistAndReport(
  ctx: ExtensionCommandContext,
  draft: ReturnType<typeof createCloneDraft> | ReturnType<typeof createNewDraft>,
  collision: CollisionAnalysis,
): Promise<void> {
  try {
    await runBusy(
      ctx,
      "Creating agent...",
      [draft.kind === "clone" ? "Writing cloned agent file." : "Writing generated agent file."],
      async () => {
        await persistDraft(ctx.cwd, collision.targetPath, draft);
      },
    );
    await showMessage(ctx, collision.overwrite ? "Agent updated" : "Agent created", [
      `Agent: ${draft.content.name}`,
      `Path: ${collision.targetPath}`,
    ]);
  } catch (error) {
    await showMessage(ctx, "Create failed", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

async function runCloneFlow(
  ctx: ExtensionCommandContext,
  registry: AgentRegistry,
  allTools: string[],
  modelIds: string[],
): Promise<void> {
  const sourceName = await pickFromList(
    ctx,
    "Choose source agent",
    registry.agents.map((agent) => ({
      value: agent.name,
      label: agent.name,
      description: `${sourceLabel(agent.source)} • ${agent.description}`,
    })),
  );
  if (!sourceName) return;

  const source = registry.agents.find((agent) => agent.name === sourceName);
  if (!source) {
    await showMessage(ctx, "Clone failed", [`Source agent "${sourceName}" no longer exists.`]);
    return;
  }

  const scope = await chooseScope(ctx);
  if (!scope) return;

  const config = await collectAgentConfig(ctx, allTools, modelIds, {
    scope,
    model: source.model,
    thinkingLevel: source.thinkingLevel,
    tools: source.tools,
  });
  if (!config) return;

  const draft = createCloneDraft(source, config);
  const { collision, confirmed } = await confirmDraft(ctx, registry, draft);
  if (!confirmed) return;
  await persistAndReport(ctx, draft, collision);
}

async function runNewFlow(
  ctx: ExtensionCommandContext,
  registry: AgentRegistry,
  allTools: string[],
  modelIds: string[],
): Promise<void> {
  const config = await collectAgentConfig(ctx, allTools, modelIds);
  if (!config) return;

  const description = await promptForText(ctx, {
    title: "Describe agent",
    description: "Describe agent so Pi can generate it. You can edit generated file afterward.",
    emptyMessage: "Description required.",
    hint: "Enter generate • Esc cancel",
  });
  if (!description) return;

  try {
    const generated = await runBusy(
      ctx,
      "Creating agent...",
      ["Generating agent definition."],
      () => generateAgentDefinition(ctx, registry, config, description),
    );
    const draft = createNewDraft(generated, config);
    const { collision, confirmed } = await confirmDraft(ctx, registry, draft);
    if (!confirmed) return;
    await persistAndReport(ctx, draft, collision);
  } catch (error) {
    await showMessage(ctx, "Create failed", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

export async function runCreateCommand(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  if (!ctx.hasUI) throw new Error("/subagents create requires interactive mode.");

  const registry = await discoverAgents(ctx.cwd, { refresh: true });
  if (registry.agents.length === 0) {
    await showMessage(ctx, "No agents found", ["Run /subagents list or add agent files first."]);
    return;
  }

  const allTools = [...new Set(pi.getAllTools().map((tool) => tool.name))].sort((a, b) =>
    a.localeCompare(b),
  );
  const modelIds = [
    ...new Set(
      (await ctx.modelRegistry.getAvailable()).map((model) => `${model.provider}/${model.id}`),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const mode = await pickFromList(ctx, "Create subagent", [
    { value: "new", label: "New", description: "Generate new agent from description" },
    {
      value: "clone",
      label: "Clone",
      description: "Copy existing agent into user or project scope",
    },
  ]);
  if (!mode) return;
  if (mode === "new") {
    await runNewFlow(ctx, registry, allTools, modelIds);
    return;
  }
  await runCloneFlow(ctx, registry, allTools, modelIds);
}
