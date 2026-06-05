import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeCavemanEnhancements } from "../../caveman/src/system-prompt.js";
import {
  getDefaultProjectCrumbsPathForRoot,
  getGlobalCrumbsPath,
  getGlobalCrumbsReadPaths,
  getLegacyProjectCrumbsPathForRoot,
} from "../../shared/config/crumbs-paths.js";
import { mergeLegacyWithDefault } from "../../shared/config/legacy-default-merge.js";
import { loadEffectiveExtensionConfig } from "../../shared/config/crumbs-loader.js";
import { asObject } from "../../shared/io/json-file.js";
import { DirectMcpClient } from "./client.js";
import {
  type CavemanGateState,
  type McpTool,
  type RawServerConfig,
  type ServerConfig,
  type ServerConfigRecord,
  type ServerSourceKind,
  isServerAllowedByCaveman,
} from "./shared.js";

interface RawMcpFile {
  mcpServers?: Record<string, RawServerConfig>;
  extensions?: {
    mcp?: {
      mcpServers?: Record<string, RawServerConfig>;
    };
    mcpDirect?: {
      mcpServers?: Record<string, RawServerConfig>;
    };
  };
}

interface McpToolCacheFile {
  servers?: Record<string, McpTool[]>;
}

interface ConfigSource {
  filePath: string;
  readPaths?: string[];
  writePath?: string;
  sourceKind: ServerSourceKind;
  getServers(root: RawMcpFile): Record<string, RawServerConfig>;
  setServers(root: RawMcpFile, servers: Record<string, RawServerConfig>): void;
}

function readConfigSourceRoot(source: ConfigSource): RawMcpFile {
  const paths = source.readPaths ?? [source.filePath];
  return paths.reduce<RawMcpFile>(
    (merged, path) => mergeLegacyWithDefault(merged, readJsonFile(path)),
    {},
  );
}

function hasLegacyServerInSource(source: ConfigSource, name: string): boolean {
  const writePath = source.writePath ?? source.filePath;
  return (source.readPaths ?? [])
    .filter((path) => path !== writePath)
    .some((path) => !!source.getServers(readJsonFile(path))[name]);
}

function getProjectCrumbsReadPathsSync(cwd: string): string[] {
  const projectRoot = resolveProjectRootSync(cwd);
  return [
    getLegacyProjectCrumbsPathForRoot(projectRoot),
    getDefaultProjectCrumbsPathForRoot(projectRoot),
  ];
}

function resolveProjectRootSync(cwd: string): string {
  const start = resolve(cwd);
  let current = start;

  while (true) {
    if (
      existsSync(join(current, ".agents", "crumbs", "crumbs.json")) ||
      existsSync(join(current, ".pi", "crumbs.json")) ||
      existsSync(join(current, ".git"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function cloneServerConfig(raw: RawServerConfig): RawServerConfig {
  return JSON.parse(JSON.stringify(raw)) as RawServerConfig;
}

function cloneTools(tools: McpTool[]): McpTool[] {
  return JSON.parse(JSON.stringify(tools)) as McpTool[];
}

function normalizeServerConfig(raw: RawServerConfig): ServerConfig | null {
  const lifecycle = raw.lifecycle === "eager" ? "eager" : "lazy";

  if (typeof raw.command === "string" && raw.command.trim()) {
    return {
      mode: "stdio",
      lifecycle,
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args.filter((x) => typeof x === "string") : [],
      env: raw.env,
      cwd: raw.cwd,
      headers: undefined,
      bearerToken: undefined,
      bearerTokenEnv: undefined,
      url: undefined,
    };
  }

  const url = raw.url ?? raw.serverUrl;
  if (typeof url === "string" && url.trim()) {
    return {
      mode: "http",
      lifecycle,
      url,
      headers: raw.headers,
      bearerToken: raw.bearerToken,
      bearerTokenEnv: raw.bearerTokenEnv,
    };
  }

  return null;
}

function readJsonFile(path: string): RawMcpFile {
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf8")) as RawMcpFile;
  } catch {
    return {};
  }
}

function writeJsonFile(path: string, data: RawMcpFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getToolCachePath(): string {
  return join(homedir(), ".pi", "agent", "mcp-tools-cache.json");
}

function getToolCacheKey(record: ServerConfigRecord): string {
  return JSON.stringify([record.filePath, record.sourceKind, record.name, record.config]);
}

function readToolCacheFile(): McpToolCacheFile {
  const path = getToolCachePath();

  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, "utf8")) as McpToolCacheFile;
  } catch {
    return {};
  }
}

function writeToolCacheFile(data: McpToolCacheFile): void {
  const path = getToolCachePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getConfigSources(cwd: string): ConfigSource[] {
  const projectRoot = resolveProjectRootSync(cwd);
  const globalCrumbsWritePath = getGlobalCrumbsPath();
  const projectCrumbsWritePath = getDefaultProjectCrumbsPathForRoot(projectRoot);
  const globalCrumbsReadPaths = getGlobalCrumbsReadPaths();
  const projectCrumbsReadPaths = getProjectCrumbsReadPathsSync(cwd);

  return [
    {
      filePath: join(homedir(), ".pi", "agent", "mcp.json"),
      sourceKind: "global",
      getServers(root) {
        return root.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.mcpServers = servers;
      },
    },
    {
      filePath: globalCrumbsWritePath,
      readPaths: globalCrumbsReadPaths,
      writePath: globalCrumbsWritePath,
      sourceKind: "global-crumbs-extension",
      getServers(root) {
        return root.extensions?.mcp?.mcpServers ?? root.extensions?.mcpDirect?.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.extensions ??= {};
        root.extensions.mcp ??= {};
        root.extensions.mcp.mcpServers = servers;
      },
    },
    {
      filePath: resolve(projectRoot, ".pi", "mcp.json"),
      sourceKind: "project",
      getServers(root) {
        return root.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.mcpServers = servers;
      },
    },
    {
      filePath: projectCrumbsWritePath,
      readPaths: projectCrumbsReadPaths,
      writePath: projectCrumbsWritePath,
      sourceKind: "crumbs-root",
      getServers(root) {
        return root.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.mcpServers = servers;
      },
    },
    {
      filePath: projectCrumbsWritePath,
      readPaths: projectCrumbsReadPaths,
      writePath: projectCrumbsWritePath,
      sourceKind: "crumbs-extension",
      getServers(root) {
        return root.extensions?.mcp?.mcpServers ?? root.extensions?.mcpDirect?.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.extensions ??= {};
        root.extensions.mcp ??= {};
        root.extensions.mcp.mcpServers = servers;
      },
    },
  ];
}

function findSource(cwd: string, kind: ServerSourceKind): ConfigSource {
  const source = getConfigSources(cwd).find((entry) => entry.sourceKind === kind);
  if (!source) throw new Error(`Unknown config source: ${kind}`);
  return source;
}

export function formatSourceKind(kind: ServerSourceKind): string {
  switch (kind) {
    case "global":
      return "global";
    case "global-crumbs-extension":
      return "global crumbs ext";
    case "project":
      return "project";
    case "crumbs-root":
      return "crumbs";
    case "crumbs-extension":
      return "crumbs ext";
  }
}

export function loadServerRecords(cwd: string): Record<string, ServerConfigRecord> {
  const merged: Record<string, ServerConfigRecord> = {};

  for (const source of getConfigSources(cwd)) {
    const root = readConfigSourceRoot(source);
    const servers = source.getServers(root);

    for (const [name, raw] of Object.entries(servers)) {
      merged[name] = {
        name,
        filePath: source.filePath,
        sourceKind: source.sourceKind,
        raw: cloneServerConfig(raw),
        config: normalizeServerConfig(raw),
      };
    }
  }

  return merged;
}

export async function loadCavemanGateState(cwd: string): Promise<CavemanGateState> {
  const section = asObject(await loadEffectiveExtensionConfig(cwd, "caveman"));
  return {
    enabled: typeof section?.enabled === "boolean" ? section.enabled : false,
    enhancements: normalizeCavemanEnhancements(section?.powers ?? section?.enhancements),
  };
}

export async function loadServersConfig(cwd: string): Promise<Record<string, ServerConfig>> {
  const records = loadServerRecords(cwd);
  const caveman = await loadCavemanGateState(cwd);
  const normalized: Record<string, ServerConfig> = {};

  for (const [name, record] of Object.entries(records)) {
    if (record.raw.enabled === false) continue;
    if (!isServerAllowedByCaveman(record.raw, caveman)) continue;
    if (record.config) normalized[name] = record.config;
  }

  return normalized;
}

export function updateServerRecord(
  cwd: string,
  sourceKind: ServerSourceKind,
  name: string,
  updater: (current: RawServerConfig | undefined) => RawServerConfig | undefined,
): void {
  const source = findSource(cwd, sourceKind);
  const writePath = source.writePath ?? source.filePath;
  const root = readJsonFile(writePath);
  const servers = { ...source.getServers(root) };
  const fallbackCurrent = loadServerRecords(cwd)[name];
  const current =
    servers[name] ?? (fallbackCurrent?.sourceKind === sourceKind ? fallbackCurrent.raw : undefined);
  const next = updater(current);
  const hasLegacyServer = hasLegacyServerInSource(source, name);

  if (next) servers[name] = next;
  else if (hasLegacyServer) servers[name] = { enabled: false };
  else delete servers[name];

  source.setServers(root, servers);
  writeJsonFile(writePath, root);
}

export function removeServerRecord(cwd: string, sourceKind: ServerSourceKind, name: string): void {
  updateServerRecord(cwd, sourceKind, name, () => undefined);
}

export async function connectAndDiscover(
  name: string,
  config: ServerConfig,
): Promise<{ client: DirectMcpClient; tools: McpTool[] }> {
  const client = new DirectMcpClient();
  await client.connect(name, config);
  const tools = await client.listTools();
  return { client, tools };
}

export function readCachedServerTools(record: ServerConfigRecord): McpTool[] | undefined {
  const cache = readToolCacheFile();
  const tools = cache.servers?.[getToolCacheKey(record)];

  return Array.isArray(tools) ? cloneTools(tools) : undefined;
}

export function writeCachedServerTools(record: ServerConfigRecord, tools: McpTool[]): void {
  const cache = readToolCacheFile();
  const nextServers = {
    ...cache.servers,
    [getToolCacheKey(record)]: cloneTools(tools),
  };

  writeToolCacheFile({ servers: nextServers });
}

export function removeCachedServerTools(record: ServerConfigRecord): void {
  const cache = readToolCacheFile();

  if (!cache.servers) {
    return;
  }

  const nextServers = { ...cache.servers };
  delete nextServers[getToolCacheKey(record)];
  writeToolCacheFile({ servers: nextServers });
}
