import type { ExtensionCommandContext, ToolInfo } from "@mariozechner/pi-coding-agent";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot } from "../../shared/config/project-root.js";
import { isDirectory } from "../../shared/io/fs.js";
import type { AgentIssue, AgentRegistry, AgentSource, AgentSpec, Workflow } from "./types.js";

type DiscoverOptions = {
  refresh?: boolean;
  builtinDir?: string;
  includeBuiltin?: boolean;
  includeUser?: boolean;
  includeProject?: boolean;
  extraDirs?: string[];
};

type Runtime = {
  modelRegistry: Pick<ExtensionCommandContext, "modelRegistry">["modelRegistry"];
  allTools: ToolInfo[];
};

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const registryCache = new Map<string, AgentRegistry>();

function getBuiltinAgentsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "agents");
}

function getUserAgentsDir(): string {
  return join(process.env.HOME || "~", ".pi", "crumbs", "agents");
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getAgentName(filePath: string, frontmatter?: Record<string, unknown>): string | undefined {
  const name = frontmatter?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  const fileName = basename(filePath, ".md").trim();
  return fileName || undefined;
}

function issue(
  level: AgentIssue["level"],
  message: string,
  filePath?: string,
  agentName?: string,
): AgentIssue {
  return { level, message, filePath, agentName };
}

function fileIssue(
  filePath: string,
  message: string,
  frontmatter?: Record<string, unknown>,
): AgentIssue {
  return issue("error", message, filePath, getAgentName(filePath, frontmatter));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(frontmatter: Record<string, unknown>, key: string, filePath: string): string {
  const value = frontmatter[key];
  if (typeof value !== "string" || !value.trim()) {
    throw fileIssue(filePath, `frontmatter.${key} must be non-empty string`, frontmatter);
  }
  return value.trim();
}

function readOptionalString(
  frontmatter: Record<string, unknown>,
  key: string,
  filePath: string,
): string | undefined {
  const value = frontmatter[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw fileIssue(
      filePath,
      `frontmatter.${key} must be non-empty string when provided`,
      frontmatter,
    );
  }
  return value.trim();
}

function readTools(frontmatter: Record<string, unknown>, filePath: string): string[] | undefined {
  const value = frontmatter.tools;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw fileIssue(filePath, "frontmatter.tools must be array of non-empty strings", frontmatter);
  }
  const tools = value.map((item) => {
    if (typeof item !== "string" || !item.trim()) {
      throw fileIssue(
        filePath,
        "frontmatter.tools must be array of non-empty strings",
        frontmatter,
      );
    }
    return item.trim();
  });
  return tools.length > 0 ? tools : undefined;
}

function readThinkingLevel(
  frontmatter: Record<string, unknown>,
  filePath: string,
): AgentSpec["thinkingLevel"] {
  const value = frontmatter.thinkingLevel;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !THINKING_LEVELS.has(value)) {
    throw fileIssue(
      filePath,
      `frontmatter.thinkingLevel must be one of ${[...THINKING_LEVELS].join(", ")}`,
      frontmatter,
    );
  }
  return value as AgentSpec["thinkingLevel"];
}

function parseAgentMarkdown(
  filePath: string,
  rawContent: string,
): {
  frontmatter: Record<string, unknown>;
  promptText: string;
} {
  const content = normalizeNewlines(rawContent);
  if (content.startsWith("---\n") && content.indexOf("\n---\n", 4) === -1) {
    throw fileIssue(filePath, "frontmatter starts with --- but no closing --- line was found");
  }
  const parsed = parseFrontmatter<Record<string, unknown>>(content);
  if (!isRecord(parsed.frontmatter)) {
    throw fileIssue(filePath, "frontmatter must parse to object");
  }
  const promptText = parsed.body.trim();
  if (!promptText)
    throw fileIssue(filePath, "agent prompt body must not be empty", parsed.frontmatter);
  return { frontmatter: parsed.frontmatter, promptText };
}

function parseAgent(
  filePath: string,
  source: AgentSource,
  sourceDir: string,
  rawContent: string,
): AgentSpec {
  const { frontmatter, promptText } = parseAgentMarkdown(filePath, rawContent);
  return {
    name: readString(frontmatter, "name", filePath),
    description: readString(frontmatter, "description", filePath),
    promptText,
    filePath,
    source,
    sourceDir,
    model: readOptionalString(frontmatter, "model", filePath),
    thinkingLevel: readThinkingLevel(frontmatter, filePath),
    tools: readTools(frontmatter, filePath),
  };
}

async function findProjectAgentsDir(cwd: string): Promise<string | null> {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pi", "crumbs", "agents");
    if (await isDirectory(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function loadAgentsFromDir(
  dir: string,
  source: AgentSource,
): Promise<{
  agents: AgentSpec[];
  diagnostics: AgentIssue[];
}> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return { agents: [], diagnostics: [] };
    return {
      agents: [],
      diagnostics: [issue("error", error instanceof Error ? error.message : String(error), dir)],
    };
  }

  const results = await Promise.all(
    entries
      .filter((entry) => entry.name.endsWith(".md") && (entry.isFile() || entry.isSymbolicLink()))
      .map(async (entry) => {
        const filePath = join(dir, entry.name);
        try {
          const content = await readFile(filePath, "utf8");
          return { agents: [parseAgent(filePath, source, dir, content)], diagnostics: [] };
        } catch (error) {
          return {
            agents: [],
            diagnostics: [
              error && typeof error === "object" && "level" in error
                ? (error as AgentIssue)
                : fileIssue(filePath, error instanceof Error ? error.message : String(error)),
            ],
          };
        }
      }),
  );

  return {
    agents: results.flatMap((item) => item.agents),
    diagnostics: results.flatMap((item) => item.diagnostics),
  };
}

function mergeAgents(agents: AgentSpec[]): { agents: AgentSpec[]; diagnostics: AgentIssue[] } {
  const diagnostics: AgentIssue[] = [];
  const byName = new Map<string, AgentSpec>();
  for (const agent of agents) {
    const existing = byName.get(agent.name);
    if (!existing) {
      byName.set(agent.name, agent);
      continue;
    }
    if (existing.source === agent.source) {
      diagnostics.push(
        issue(
          "error",
          `duplicate agent name "${agent.name}" in ${agent.source} scope`,
          agent.filePath,
          agent.name,
        ),
      );
      continue;
    }
    diagnostics.push(
      issue(
        "info",
        `agent "${agent.name}" from ${agent.source} shadows ${existing.source}`,
        agent.filePath,
        agent.name,
      ),
    );
    byName.set(agent.name, agent);
  }
  return {
    agents: [...byName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
  };
}

function getWorkflowAgentNames(workflow: Workflow): string[] {
  if (workflow.mode === "single") return [workflow.agent];
  return [
    ...new Set(
      (workflow.mode === "chain" ? workflow.chain : workflow.tasks).map((item) => item.agent),
    ),
  ];
}

function filterRequestedDiagnostics(
  registry: AgentRegistry,
  requestedNames: string[],
): AgentIssue[] {
  if (requestedNames.length === 0) return [];
  const requested = new Set(requestedNames);
  return registry.diagnostics.filter((diagnostic) => {
    if (diagnostic.agentName && requested.has(diagnostic.agentName)) return true;
    if (!diagnostic.filePath) return false;
    const fileName = diagnostic.filePath.replace(/\\/g, "/").split("/").pop();
    return Boolean(fileName?.endsWith(".md") && requested.has(fileName.slice(0, -3)));
  });
}

async function validateRuntime(agents: AgentSpec[], runtime: Runtime): Promise<AgentIssue[]> {
  const diagnostics: AgentIssue[] = [];
  const toolNames = new Set(runtime.allTools.map((tool) => tool.name));
  let availableModels = { ids: new Set<string>(), keys: new Set<string>() };
  try {
    const models = await runtime.modelRegistry.getAvailable();
    availableModels = {
      ids: new Set(models.map((model) => model.id)),
      keys: new Set(models.map((model) => `${model.provider}/${model.id}`)),
    };
  } catch {}

  for (const agent of agents) {
    for (const toolName of agent.tools ?? []) {
      if (toolNames.has(toolName)) continue;
      diagnostics.push(issue("error", `unknown tool "${toolName}"`, agent.filePath, agent.name));
    }
    if (!agent.model) continue;
    const found = agent.model.includes("/")
      ? availableModels.keys.has(agent.model)
      : availableModels.ids.has(agent.model);
    if (!found) {
      diagnostics.push(
        issue(
          "warning",
          `model "${agent.model}" not found in current model registry`,
          agent.filePath,
          agent.name,
        ),
      );
    }
  }
  return diagnostics;
}

export async function discoverAgents(
  cwd: string,
  options: DiscoverOptions = {},
): Promise<AgentRegistry> {
  const projectKey = await resolveProjectRoot(cwd);
  if (!options.refresh) {
    const cached = registryCache.get(projectKey);
    if (cached) return cached;
  }

  const builtinDir = options.builtinDir ? resolve(options.builtinDir) : getBuiltinAgentsDir();
  const userDir = getUserAgentsDir();
  const projectDir = await findProjectAgentsDir(cwd);
  const dirs: Array<{ dir: string; source: AgentSource }> = [];

  if (options.includeBuiltin !== false) dirs.push({ dir: builtinDir, source: "builtin" });
  if (options.includeUser !== false) dirs.push({ dir: userDir, source: "user" });
  if (options.includeProject !== false && projectDir)
    dirs.push({ dir: projectDir, source: "project" });
  for (const extraDir of options.extraDirs ?? [])
    dirs.push({ dir: resolve(extraDir), source: "path" });

  const loaded = await Promise.all(dirs.map((item) => loadAgentsFromDir(item.dir, item.source)));
  const merged = mergeAgents(loaded.flatMap((item) => item.agents));
  const result: AgentRegistry = {
    agents: merged.agents,
    diagnostics: [...loaded.flatMap((item) => item.diagnostics), ...merged.diagnostics],
    builtinDir,
    userDir,
    projectDir,
  };

  registryCache.set(projectKey, result);
  return result;
}

export function clearAgentRegistryCache(): void {
  registryCache.clear();
}

export async function collectRegistryDiagnostics(
  cwd: string,
  runtime: Runtime,
): Promise<{
  registry: AgentRegistry;
  runtimeDiagnostics: AgentIssue[];
  diagnostics: AgentIssue[];
}> {
  const registry = await discoverAgents(cwd, { refresh: true });
  const runtimeDiagnostics = await validateRuntime(registry.agents, runtime);
  return {
    registry,
    runtimeDiagnostics,
    diagnostics: [...registry.diagnostics, ...runtimeDiagnostics],
  };
}

export async function resolveRunnableAgents(
  cwd: string,
  workflow: Workflow,
  runtime: Runtime,
): Promise<{ agents: AgentSpec[]; diagnostics: AgentIssue[] }> {
  const registry = await discoverAgents(cwd, { refresh: true });
  const requestedNames = getWorkflowAgentNames(workflow);
  const requestedAgents = requestedNames
    .map((name) => registry.agents.find((agent) => agent.name === name))
    .filter((agent): agent is AgentSpec => Boolean(agent));
  const runtimeDiagnostics = await validateRuntime(requestedAgents, runtime);
  return {
    agents: registry.agents,
    diagnostics: [...filterRequestedDiagnostics(registry, requestedNames), ...runtimeDiagnostics],
  };
}

function formatIssueLocation(issueItem: AgentIssue): string {
  return issueItem.filePath || issueItem.agentName || "<unknown>";
}

export function renderBlockingDiagnostics(diagnostics: AgentIssue[]): string {
  const lines = ["subagent blocked", ""];
  for (const item of diagnostics) {
    lines.push(`${item.level.toUpperCase()} ${formatIssueLocation(item)}`);
    lines.push(`  - ${item.message}`);
  }
  return lines.join("\n");
}

export function formatDiagnosticSummary(diagnostics: AgentIssue[]): string {
  if (diagnostics.length === 0) return "Subagent run blocked.";
  const lines = ["Subagent run blocked by agent definition errors:"];
  for (const item of diagnostics.slice(0, 5)) lines.push(`- ${item.message}`);
  if (diagnostics.length > 5) lines.push(`- ... ${diagnostics.length - 5} more`);
  lines.push("Run /subagent doctor.");
  return lines.join("\n");
}

function formatModel(model: string | undefined): string {
  return model || "inherit parent";
}

function formatTools(tools: string[] | undefined): string {
  return tools?.length ? tools.join(", ") : "inherit parent";
}

export function renderListReport(registry: AgentRegistry): string {
  const lines = ["subagents", ""];
  if (registry.agents.length === 0) return `${lines.join("\n")}No agents found.`;

  for (const [index, section] of [
    { title: "Project", source: "project" as const },
    { title: "User", source: "user" as const },
    { title: "Built-in", source: "builtin" as const },
    { title: "Path", source: "path" as const },
  ].entries()) {
    const agents = registry.agents.filter((agent) => agent.source === section.source);
    if (agents.length === 0) continue;
    const nameWidth = Math.max(4, ...agents.map((agent) => agent.name.length));
    const modelWidth = Math.max(5, ...agents.map((agent) => formatModel(agent.model).length));
    const toolWidth = Math.max(5, ...agents.map((agent) => formatTools(agent.tools).length));
    if (index > 0) lines.push("");
    lines.push(`[${section.title}]`);
    lines.push(
      `  ${"Name".padEnd(nameWidth)} | ${"Model".padEnd(modelWidth)} | ${"Tools".padEnd(toolWidth)}`,
    );
    lines.push(`  ${"-".repeat(nameWidth)}-+-${"-".repeat(modelWidth)}-+-${"-".repeat(toolWidth)}`);
    for (const agent of agents) {
      lines.push(
        `  ${agent.name.padEnd(nameWidth)} | ${formatModel(agent.model).padEnd(modelWidth)} | ${formatTools(agent.tools).padEnd(toolWidth)}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderDoctorReport(
  registry: AgentRegistry,
  runtimeDiagnostics: AgentIssue[],
): string {
  const diagnostics = [...registry.diagnostics, ...runtimeDiagnostics];
  const lines = [
    "subagent doctor",
    "",
    `Agents scanned: ${registry.agents.length}`,
    `Errors: ${diagnostics.filter((item) => item.level === "error").length}`,
    `Warnings: ${diagnostics.filter((item) => item.level === "warning").length}`,
    `Info: ${diagnostics.filter((item) => item.level === "info").length}`,
  ];
  if (diagnostics.length === 0) return `${lines.join("\n")}\n\nNo issues found.`;
  lines.push("");
  for (const item of diagnostics) {
    lines.push(`${item.level.toUpperCase()} ${formatIssueLocation(item)}`);
    lines.push(`  - ${item.message}`);
  }
  return lines.join("\n");
}
