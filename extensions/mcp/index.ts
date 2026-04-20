/**
 * MCP Extension
 *
 * What it does:
 * - Loads MCP servers from `.pi/mcp.json`, `~/.pi/agent/mcp.json`, and `.pi/crumbs.json`.
 * - Connects with stdio for local servers and Streamable HTTP with SSE fallback for remote servers.
 * - Registers discovered MCP tools as Pi tools and manages server and tool enablement from a TUI.
 *
 * How to use it:
 * - Add server entries under `mcpServers` in config.
 * - Use `/mcp` to open the manager.
 * - Use `/mcp reconnect [server]` for quick reconnects.
 * - Add `requiresCavemanPower` to gate server behind active Caveman power.
 *
 * Example:
 * - `{"mcpServers":{"pencil":{"url":"https://example.com/mcp","requiresCavemanPower":"design"}}}`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { normalizeCavemanEnhancement } from "../caveman/src/system-prompt.js";
import {
  connectAndDiscover,
  formatSourceKind,
  loadCavemanGateState,
  readCachedServerTools,
  loadServerRecords,
  removeCachedServerTools,
  removeServerRecord,
  updateServerRecord,
  writeCachedServerTools,
} from "./config.js";
import { DirectMcpClient } from "./client.js";
import {
  type CavemanGateState,
  errorMessage,
  isServerAllowedByCaveman,
  LOG_PREFIX,
  type McpTool,
  type ServerConfigRecord,
  type ServerState,
} from "./shared.js";
import { registerServerTool } from "./tools.js";
import { CRUMBS_EVENT_CAVEMAN_CHANGED } from "../shared/crumbs-events.js";
import {
  matchesTool,
  parseQuery,
  showManager,
  type ManagerServerView,
  type ManagerToolView,
} from "./ui.js";

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export default function mcpExtension(pi: ExtensionAPI): void {
  const servers = new Map<string, ServerState>();
  const managedToolNames = new Set<string>();
  const toolOwners = new Map<string, string>();
  let lastCwd = process.cwd();
  let cavemanState: CavemanGateState = { enabled: false, enhancements: [] };

  function withToolOverride(
    tools: ServerConfigRecord["raw"]["tools"] | undefined,
    toolName: string,
    enabled: boolean,
  ): ServerConfigRecord["raw"]["tools"] | undefined {
    const nextTools = { ...tools };

    if (enabled) delete nextTools[toolName];
    else nextTools[toolName] = { ...nextTools[toolName], enabled: false };

    return Object.keys(nextTools).length > 0 ? nextTools : undefined;
  }

  function getRecords(): Record<string, ServerConfigRecord> {
    return loadServerRecords(lastCwd);
  }

  function isRecordRuntimeEnabled(record: ServerConfigRecord): boolean {
    return (
      record.raw.enabled !== false &&
      !!record.config &&
      isServerAllowedByCaveman(record.raw, cavemanState)
    );
  }

  function releaseServerTools(name: string): void {
    const state = servers.get(name);
    if (!state) return;

    for (const tool of state.tools) {
      if (toolOwners.get(tool.name) === name) toolOwners.delete(tool.name);
    }
  }

  function claimUnownedTools(): void {
    for (const record of sortByName(Object.values(getRecords()))) {
      if (!isRecordRuntimeEnabled(record)) continue;
      const state = servers.get(record.name);
      if (!state) continue;

      for (const tool of state.tools) {
        if (toolOwners.has(tool.name)) continue;
        registerServerTool(pi, tool, record.name, servers);
        managedToolNames.add(tool.name);
        toolOwners.set(tool.name, record.name);
      }
    }
  }

  function hydrateServerFromCache(record: ServerConfigRecord): boolean {
    if (!record.config || servers.has(record.name)) {
      return false;
    }

    const tools = readCachedServerTools(record);

    if (!tools || tools.length === 0) {
      return false;
    }

    servers.set(record.name, {
      client: new DirectMcpClient(),
      config: record.config,
      tools,
      lastError: undefined,
    });

    return true;
  }

  function buildToolViews(record: ServerConfigRecord): ManagerToolView[] {
    const state = servers.get(record.name);
    const discovered = new Map<string, McpTool>(
      (state?.tools ?? []).map((tool) => [tool.name, tool]),
    );
    const configuredNames = Object.keys(record.raw.tools ?? {});
    const names = Array.from(new Set([...discovered.keys(), ...configuredNames])).sort((a, b) =>
      a.localeCompare(b),
    );
    const serverEnabled = isRecordRuntimeEnabled(record);

    return names.map((name) => {
      const tool = discovered.get(name);
      const configuredEnabled = record.raw.tools?.[name]?.enabled !== false;
      const runtimeOwner = toolOwners.get(name);
      const enabled = serverEnabled && configuredEnabled;

      let stateLabel: ManagerToolView["state"] = "disabled";
      if (!tool) stateLabel = "missing";
      else if (runtimeOwner && runtimeOwner !== record.name) stateLabel = "conflict";
      else if (enabled) stateLabel = "enabled";

      return {
        name,
        description: tool?.description,
        enabled,
        state: stateLabel,
      };
    });
  }

  function buildServerView(record: ServerConfigRecord): ManagerServerView {
    const state = servers.get(record.name);
    return {
      name: record.name,
      enabled: record.raw.enabled !== false,
      connected: state?.client.connected ?? false,
      mode: record.config?.mode ?? "invalid",
      lifecycle: record.config?.lifecycle ?? "-",
      sourceLabel: `${formatSourceKind(record.sourceKind)}:${record.filePath.replace(`${lastCwd}/`, "")}`,
      filePath: record.filePath,
      tools: buildToolViews(record),
      lastError: state?.lastError,
    };
  }

  function syncActiveTools(): void {
    const active = new Set(pi.getActiveTools());
    for (const toolName of managedToolNames) active.delete(toolName);

    for (const record of Object.values(getRecords())) {
      if (!isRecordRuntimeEnabled(record)) continue;

      for (const tool of servers.get(record.name)?.tools ?? []) {
        if (toolOwners.get(tool.name) !== record.name) continue;
        if (record.raw.tools?.[tool.name]?.enabled === false) continue;
        active.add(tool.name);
      }
    }

    pi.setActiveTools([...active]);
  }

  async function ensureServerReady(record: ServerConfigRecord): Promise<McpTool[]> {
    const state = servers.get(record.name);

    if (state) {
      if (record.config?.lifecycle === "eager" && !state.client.connected) {
        return connectServer(record.name);
      }

      claimUnownedTools();
      syncActiveTools();
      return state.tools;
    }

    if (hydrateServerFromCache(record)) {
      claimUnownedTools();
      syncActiveTools();
      return servers.get(record.name)?.tools ?? [];
    }

    const tools = await connectServer(record.name);
    if (record.config?.lifecycle !== "eager") await disconnectServer(record.name, false);
    return tools;
  }

  async function syncServersForCavemanState(): Promise<void> {
    const records = sortByName(Object.values(getRecords()));

    for (const record of records) {
      if (!isRecordRuntimeEnabled(record)) {
        await disconnectServer(record.name, true);
        continue;
      }

      hydrateServerFromCache(record);

      try {
        if (record.config?.lifecycle === "eager" || !servers.has(record.name)) {
          await ensureServerReady(record);
        }
      } catch {
        continue;
      }
    }

    claimUnownedTools();
    syncActiveTools();
  }

  async function connectServer(name: string): Promise<McpTool[]> {
    const record = getRecords()[name];
    if (!record) throw new Error(`Unknown server: ${name}`);
    if (record.raw.enabled === false) throw new Error(`Server "${name}" is disabled`);
    if (!record.config) throw new Error(`Server "${name}" has invalid config`);
    if (!isServerAllowedByCaveman(record.raw, cavemanState)) {
      throw new Error(
        `Server "${name}" requires Caveman power "${record.raw.requiresCavemanPower}"`,
      );
    }

    const previous = servers.get(name);
    if (previous) {
      releaseServerTools(name);
      await previous.client.close();
    }

    try {
      const { client, tools } = await connectAndDiscover(name, record.config);
      writeCachedServerTools(record, tools);

      const nextState: ServerState = {
        client,
        config: record.config,
        tools,
        lastError: undefined,
      };
      servers.set(name, nextState);

      for (const tool of tools) {
        const owner = toolOwners.get(tool.name);
        if (owner && owner !== name) continue;
        registerServerTool(pi, tool, name, servers);
        managedToolNames.add(tool.name);
        toolOwners.set(tool.name, name);
      }

      syncActiveTools();
      return tools;
    } catch (error) {
      if (previous) {
        servers.set(name, {
          client: previous.client,
          config: previous.config,
          tools: previous.tools,
          lastError: errorMessage(error),
        });
      }
      syncActiveTools();
      throw error;
    }
  }

  async function disconnectServer(name: string, releaseTools: boolean): Promise<void> {
    const state = servers.get(name);
    if (!state) return;
    if (releaseTools) releaseServerTools(name);
    await state.client.close();
    state.lastError = undefined;
    if (releaseTools) claimUnownedTools();
    syncActiveTools();
  }

  function getManagerState(): { servers: ManagerServerView[] } {
    return {
      servers: sortByName(Object.values(getRecords()).map(buildServerView)),
    };
  }

  async function setServerEnabled(name: string, enabled: boolean): Promise<string | undefined> {
    const record = getRecords()[name];
    if (!record) throw new Error(`Unknown server: ${name}`);

    updateServerRecord(lastCwd, record.sourceKind, name, (current) => {
      const next = { ...(current ?? record.raw) };
      if (enabled) delete next.enabled;
      else next.enabled = false;
      return next;
    });

    if (!enabled) {
      await disconnectServer(name, true);
      return undefined;
    }

    const nextRecord = getRecords()[name];
    if (!nextRecord || !isRecordRuntimeEnabled(nextRecord)) {
      syncActiveTools();
      return nextRecord?.raw.requiresCavemanPower
        ? `${name} waits for Caveman power ${nextRecord.raw.requiresCavemanPower}`
        : undefined;
    }

    await ensureServerReady(nextRecord);
    return undefined;
  }

  async function setToolEnabled(
    name: string,
    toolName: string,
    enabled: boolean,
  ): Promise<string | undefined> {
    const record = getRecords()[name];
    if (!record) throw new Error(`Unknown server: ${name}`);

    updateServerRecord(lastCwd, record.sourceKind, name, (current) => ({
      ...(current ?? record.raw),
      tools: withToolOverride(current?.tools ?? record.raw.tools, toolName, enabled),
    }));

    syncActiveTools();
    return undefined;
  }

  async function setToolsEnabledByFilter(
    name: string,
    enabled: boolean,
    filter: string,
  ): Promise<string | undefined> {
    const record = getRecords()[name];
    if (!record) throw new Error(`Unknown server: ${name}`);

    const query = parseQuery(filter);
    const matches = buildToolViews(record).filter((tool) => matchesTool(tool, query));
    if (matches.length === 0) return `No matching tools on ${name}`;

    updateServerRecord(lastCwd, record.sourceKind, name, (current) => {
      let nextTools = { ...(current?.tools || record.raw.tools) };
      for (const tool of matches) {
        if (enabled) delete nextTools[tool.name];
        else nextTools[tool.name] = { ...nextTools[tool.name], enabled: false };
      }
      return {
        ...(current ?? record.raw),
        tools: Object.keys(nextTools).length > 0 ? nextTools : undefined,
      };
    });

    syncActiveTools();
    return undefined;
  }

  pi.on("session_start", async (event, ctx) => {
    if (event.reason !== "startup" && event.reason !== "reload") return;

    lastCwd = ctx.cwd;
    cavemanState = await loadCavemanGateState(ctx.cwd);
    const records = sortByName(Object.values(getRecords())).filter((record) =>
      isRecordRuntimeEnabled(record),
    );
    if (records.length === 0) return;

    for (const record of records) {
      hydrateServerFromCache(record);
    }

    claimUnownedTools();

    const results = await Promise.allSettled(
      records
        .filter((record) => record.config?.lifecycle === "eager" || !servers.has(record.name))
        .map(async (record) => ({
          name: record.name,
          toolCount: (await ensureServerReady(record)).length,
        })),
    );

    let errorCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") errorCount += 1;
    }

    syncActiveTools();
    if (errorCount > 0) {
      const phase = event.reason === "reload" ? "reload" : "startup";
      ctx.ui.notify(
        `${LOG_PREFIX} ${errorCount} server(s) failed during ${phase}. Use /mcp to inspect.`,
        "error",
      );
    }
  });

  pi.events.on(CRUMBS_EVENT_CAVEMAN_CHANGED, (event) => {
    if (!event || typeof event !== "object") return;

    const record = event as Record<string, unknown>;
    const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
    if (cwd && cwd !== lastCwd) return;

    cavemanState = {
      enabled: typeof record.enabled === "boolean" ? record.enabled : cavemanState.enabled,
      enhancements: Array.isArray(record.enhancements)
        ? record.enhancements
            .map((value) => normalizeCavemanEnhancement(value))
            .filter((value): value is CavemanGateState["enhancements"][number] => Boolean(value))
        : cavemanState.enhancements,
    };

    void syncServersForCavemanState();
  });

  pi.on("session_shutdown", async () => {
    for (const state of servers.values()) {
      await state.client.close();
    }
    servers.clear();
    managedToolNames.clear();
    toolOwners.clear();
  });

  pi.registerCommand("mcp", {
    description: "MCP manager. Usage: /mcp [reconnect [server]]",
    getArgumentCompletions(prefix) {
      const trimmed = prefix.trimStart();
      if (!trimmed.includes(" ")) {
        const items = [
          { value: "reconnect", label: "reconnect", description: "Reconnect MCP server(s)" },
        ];
        const filtered = items.filter((item) => item.value.startsWith(trimmed));
        return filtered.length > 0 ? filtered : null;
      }

      const parts = trimmed.split(/\s+/);
      if (parts[0] === "reconnect" && parts.length <= 2) {
        const serverPrefix = parts[1] ?? "";
        const items = sortByName(Object.values(getRecords())).map((record) => ({
          value: `reconnect ${record.name}`,
          label: record.name,
          description: servers.get(record.name)?.client.connected ? "connected" : "disconnected",
        }));
        const filtered = items.filter((item) => item.label.startsWith(serverPrefix));
        return filtered.length > 0 ? filtered : null;
      }

      return null;
    },
    handler: async (args, ctx) => {
      lastCwd = ctx.cwd;
      const [subcommand, target] = (args ?? "").trim().split(/\s+/).filter(Boolean);

      if (subcommand === "reconnect") {
        const records = getRecords();
        const targets = target ? [target] : Object.keys(records);
        if (target && !records[target]) {
          ctx.ui.notify(`${LOG_PREFIX} Unknown server: ${target}`, "error");
          return;
        }

        for (const name of targets) {
          try {
            const tools = await connectServer(name);
            ctx.ui.notify(`${LOG_PREFIX} ${name}: connected (${tools.length} tools)`, "info");
          } catch (error) {
            ctx.ui.notify(`${LOG_PREFIX} ${name}: ${errorMessage(error)}`, "error");
          }
        }
        return;
      }

      const result = await showManager(ctx, {
        getState: getManagerState,
        toggleServer: async (name) => {
          const record = getRecords()[name];
          if (!record) throw new Error(`Unknown server: ${name}`);
          const nextEnabled = record.raw.enabled === false;
          return setServerEnabled(name, nextEnabled);
        },
        toggleTool: async (serverName, toolName) => {
          const record = getRecords()[serverName];
          if (!record) throw new Error(`Unknown server: ${serverName}`);
          const tool = buildToolViews(record).find((item) => item.name === toolName);
          if (!tool) throw new Error(`Unknown tool: ${toolName}`);
          return setToolEnabled(serverName, toolName, !tool.enabled);
        },
        setAllTools: async (serverName, enabled, filter) =>
          setToolsEnabledByFilter(serverName, enabled, filter),
        reconnect: async (serverName) => {
          const tools = await connectServer(serverName);
          return `${serverName} connected (${tools.length} tools)`;
        },
        disconnect: async (serverName) => {
          await disconnectServer(serverName, false);
          return `${serverName} disconnected`;
        },
        remove: async (serverName) => {
          const record = getRecords()[serverName];
          if (!record) throw new Error(`Unknown server: ${serverName}`);
          releaseServerTools(serverName);
          await servers.get(serverName)?.client.close();
          servers.delete(serverName);
          removeCachedServerTools(record);
          removeServerRecord(lastCwd, record.sourceKind, serverName);
          claimUnownedTools();
          syncActiveTools();
          return `${serverName} removed. Reload to fully clean tool registrations.`;
        },
      });

      if (result.type === "reload") {
        await ctx.reload();
      }
    },
  });
}
