import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { normalizeCavemanEnhancements } from "../caveman/src/system-prompt.js";
import { loadEffectiveExtensionConfig } from "../shared/config/crumbs-loader.js";
import { asObject } from "../shared/io/json-file.js";
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

interface ConfigSource {
  filePath: string;
  sourceKind: ServerSourceKind;
  getServers(root: RawMcpFile): Record<string, RawServerConfig>;
  setServers(root: RawMcpFile, servers: Record<string, RawServerConfig>): void;
}

function cloneServerConfig(raw: RawServerConfig): RawServerConfig {
  return JSON.parse(JSON.stringify(raw)) as RawServerConfig;
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

function getConfigSources(cwd: string): ConfigSource[] {
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
      filePath: resolve(cwd, ".pi", "mcp.json"),
      sourceKind: "project",
      getServers(root) {
        return root.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.mcpServers = servers;
      },
    },
    {
      filePath: resolve(cwd, ".pi", "crumbs.json"),
      sourceKind: "crumbs-root",
      getServers(root) {
        return root.mcpServers ?? {};
      },
      setServers(root, servers) {
        root.mcpServers = servers;
      },
    },
    {
      filePath: resolve(cwd, ".pi", "crumbs.json"),
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
    const root = readJsonFile(source.filePath);
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
  const root = readJsonFile(source.filePath);
  const servers = { ...source.getServers(root) };
  const next = updater(servers[name]);

  if (next) servers[name] = next;
  else delete servers[name];

  source.setServers(root, servers);
  writeJsonFile(source.filePath, root);
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
