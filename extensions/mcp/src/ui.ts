import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getSelectListTheme, keyHint, rawKeyHint } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  Input,
  Key,
  SelectList,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type Focusable,
  type SelectItem,
} from "@earendil-works/pi-tui";

type ToolState = "enabled" | "disabled" | "conflict" | "missing";

export interface ManagerToolView {
  name: string;
  description?: string;
  enabled: boolean;
  state: ToolState;
}

export interface ManagerServerView {
  name: string;
  enabled: boolean;
  connected: boolean;
  mode: string;
  lifecycle: string;
  sourceLabel: string;
  filePath: string;
  tools: ManagerToolView[];
  lastError?: string;
}

interface ManagerState {
  servers: ManagerServerView[];
}

interface ManagerActions {
  getState(): ManagerState;
  toggleServer(name: string): Promise<string | undefined>;
  toggleTool(serverName: string, toolName: string): Promise<string | undefined>;
  setAllTools(serverName: string, enabled: boolean, filter: string): Promise<string | undefined>;
  reconnect(serverName: string): Promise<string | undefined>;
  disconnect(serverName: string): Promise<string | undefined>;
  remove(serverName: string): Promise<string | undefined>;
}

type CloseAction = { type: "close" } | { type: "reload" };

interface ChromeState {
  screen: "servers" | "tools";
  busy: boolean;
  flashMessage: string;
  serverName?: string;
  filterActive: boolean;
}

export interface TokenQuery {
  raw: string;
  terms: string[];
  filters: Record<string, string[]>;
}

export function parseQuery(input: string): TokenQuery {
  const filters: Record<string, string[]> = {};
  const terms: string[] = [];

  for (const token of input
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)) {
    const colon = token.indexOf(":");
    if (colon > 0) {
      const key = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1).toLowerCase();
      if (value) (filters[key] ??= []).push(value);
    } else {
      terms.push(token.toLowerCase());
    }
  }

  return { raw: input, terms, filters };
}

function matchesStructuredFilter(
  tool: ManagerToolView,
  filters: Record<string, string[]>,
): boolean {
  const description = (tool.description ?? "").toLowerCase();
  const name = tool.name.toLowerCase();

  for (const [key, values] of Object.entries(filters)) {
    if (key === "enabled") {
      const wants = values.some(
        (value) => value === "on" || value === "true" || value === "enabled",
      );
      const blocks = values.some(
        (value) => value === "off" || value === "false" || value === "disabled",
      );
      if (wants && !tool.enabled) return false;
      if (blocks && tool.enabled) return false;
      continue;
    }

    if (key === "state") {
      if (!values.includes(tool.state)) return false;
      continue;
    }

    if (key === "name") {
      if (!values.every((value) => name.includes(value))) return false;
      continue;
    }

    if (key === "desc" || key === "description") {
      if (!values.every((value) => description.includes(value))) return false;
      continue;
    }
  }

  return true;
}

export function matchesTool(tool: ManagerToolView, query: TokenQuery): boolean {
  if (!matchesStructuredFilter(tool, query.filters)) return false;

  const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
  return query.terms.every((term) => haystack.includes(term));
}

function padRight(input: string, width: number): string {
  return input + " ".repeat(Math.max(0, width - visibleWidth(input)));
}

function inlineText(value: string | undefined): string {
  if (!value) return "";

  let sanitized = "";
  const ansiEscape = String.fromCodePoint(27);

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const code = value.codePointAt(index) ?? 0;

    if (char === ansiEscape && value[index + 1] === "[") {
      let cursor = index + 2;
      while (cursor < value.length) {
        const marker = value[cursor];
        const isDigit = marker >= "0" && marker <= "9";
        if (isDigit || marker === ";") {
          cursor += 1;
          continue;
        }

        if ((marker >= "A" && marker <= "Z") || (marker >= "a" && marker <= "z")) {
          index = cursor;
          break;
        }

        cursor = index;
        break;
      }

      if (index === cursor) {
        continue;
      }
    }

    if (char === "\r" || char === "\n" || char === "\t") {
      sanitized += " ";
      continue;
    }

    if ((code >= 0 && code <= 31) || code === 127) {
      sanitized += " ";
      continue;
    }

    sanitized += char;
  }

  return sanitized.replace(/\s+/g, " ").trim();
}

function clampText(value: string | undefined, maxChars: number): string {
  const text = inlineText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function toolValue(tool: ManagerToolView): string {
  switch (tool.state) {
    case "enabled":
      return "on";
    case "disabled":
      return "off";
    case "conflict":
      return "conflict";
    case "missing":
      return "missing";
  }
}

class McpManagerComponent implements Component, Focusable {
  private screen: "servers" | "tools" = "servers";
  private serverIndex = 0;
  private toolIndex = 0;
  private busy = false;
  private flashMessage = "";
  private filterActive = false;
  private serverList?: SelectList;
  private toolList?: SelectList;
  private filterInput = new Input();
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly ctx: ExtensionCommandContext,
    private readonly tui: { requestRender(): void },
    private readonly actions: ManagerActions,
    private readonly done: (result: CloseAction) => void,
    private readonly onChromeChange: (state: ChromeState) => void,
  ) {
    this.filterInput.onSubmit = () => {
      this.filterActive = false;
      this.refresh();
    };
    this.filterInput.onEscape = () => {
      this.filterActive = false;
      this.refresh();
    };
    this.syncChrome();
  }

  set focused(value: boolean) {
    this._focused = value;
    this.filterInput.focused = value && this.screen === "tools" && this.filterActive;
  }

  get focused(): boolean {
    return this._focused;
  }

  private _focused = false;

  private get state(): ManagerState {
    return this.actions.getState();
  }

  private get servers(): ManagerServerView[] {
    return this.state.servers;
  }

  private get selectedServer(): ManagerServerView | undefined {
    if (this.servers.length === 0) return undefined;
    this.serverIndex = Math.max(0, Math.min(this.serverIndex, this.servers.length - 1));
    return this.servers[this.serverIndex];
  }

  private get query(): TokenQuery {
    return parseQuery(this.filterInput.getValue());
  }

  private get filteredTools(): ManagerToolView[] {
    const server = this.selectedServer;
    if (!server) return [];
    return server.tools.filter((tool) => matchesTool(tool, this.query));
  }

  private get selectedTool(): ManagerToolView | undefined {
    const tools = this.filteredTools;
    if (tools.length === 0) return undefined;
    this.toolIndex = Math.max(0, Math.min(this.toolIndex, tools.length - 1));
    return tools[this.toolIndex];
  }

  private syncChrome(): void {
    this.onChromeChange({
      screen: this.screen,
      busy: this.busy,
      flashMessage: this.flashMessage,
      serverName: this.selectedServer?.name,
      filterActive: this.filterActive,
    });
  }

  private refresh(): void {
    this.invalidate();
    this.syncChrome();
    this.tui.requestRender();
  }

  private setFlash(message: string | undefined): void {
    this.flashMessage = inlineText(message);
    this.syncChrome();
  }

  private async run(task: () => Promise<string | undefined>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setFlash("Working...");
    this.refresh();

    try {
      this.setFlash(await task());
    } catch (error) {
      this.setFlash(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private buildServerList(): SelectList {
    const items: SelectItem[] = this.servers.map((server) => {
      const summary = [
        server.enabled ? "on" : "off",
        server.connected ? "connected" : "disconnected",
        server.mode,
        `${server.tools.length} tools`,
      ].join(" · ");

      return {
        value: server.name,
        label: inlineText(server.name),
        description: `${summary} · ${inlineText(server.sourceLabel)}`,
      };
    });

    const list = new SelectList(
      items,
      Math.min(Math.max(items.length, 1), 8),
      getSelectListTheme(),
    );
    list.setSelectedIndex(this.serverIndex);
    list.onSelectionChange = (item) => {
      const nextIndex = this.servers.findIndex((server) => server.name === item.value);
      this.serverIndex = nextIndex === -1 ? this.serverIndex : nextIndex;
      this.invalidate();
      this.syncChrome();
    };
    list.onSelect = () => {
      if (!this.selectedServer) return;
      this.screen = "tools";
      this.filterActive = false;
      this.toolIndex = 0;
      this.refresh();
    };
    list.onCancel = () => this.done({ type: "close" });
    return list;
  }

  private buildToolList(): SelectList {
    const items: SelectItem[] = this.filteredTools.map((tool) => ({
      value: tool.name,
      label: `${tool.name} [${toolValue(tool)}]`,
      description:
        tool.state === "conflict"
          ? "claimed by another server"
          : tool.state === "missing"
            ? "configured but not discovered"
            : tool.enabled
              ? "enabled"
              : "disabled",
    }));

    const list = new SelectList(
      items,
      Math.min(Math.max(items.length, 1), 8),
      getSelectListTheme(),
    );
    list.setSelectedIndex(this.toolIndex);
    list.onSelectionChange = (item) => {
      const nextIndex = this.filteredTools.findIndex((tool) => tool.name === item.value);
      this.toolIndex = nextIndex === -1 ? this.toolIndex : nextIndex;
      this.invalidate();
      this.syncChrome();
    };
    list.onSelect = () => {
      const server = this.selectedServer;
      const tool = this.selectedTool;
      if (!server || !tool) return;
      void this.run(() => this.actions.toggleTool(server.name, tool.name));
    };
    list.onCancel = () => {
      this.screen = "servers";
      this.filterActive = false;
      this.refresh();
    };
    return list;
  }

  private renderHeader(width: number): string[] {
    const title =
      this.screen === "servers"
        ? this.ctx.ui.theme.fg("accent", this.ctx.ui.theme.bold("MCP Servers"))
        : this.ctx.ui.theme.fg(
            "accent",
            this.ctx.ui.theme.bold(`MCP Tools · ${inlineText(this.selectedServer?.name) || "-"}`),
          );

    const border = this.ctx.ui.theme.fg("border", "─".repeat(Math.max(1, width)));
    const lines = [truncateToWidth(title, width), truncateToWidth(border, width)];

    if (this.screen === "servers") {
      const connected = this.servers.filter((server) => server.connected).length;
      const enabled = this.servers.filter((server) => server.enabled).length;
      lines.push(
        truncateToWidth(
          this.ctx.ui.theme.fg(
            "muted",
            `${this.servers.length} servers · ${enabled} enabled · ${connected} connected`,
          ),
          width,
        ),
      );
      return [...lines, ""];
    }

    const server = this.selectedServer;
    if (!server) return [...lines, ""];

    const enabledTools = server.tools.filter((tool) => tool.enabled).length;
    lines.push(
      truncateToWidth(
        this.ctx.ui.theme.fg(
          "muted",
          `${server.enabled ? "on" : "off"} · ${server.connected ? "connected" : "disconnected"} · ${inlineText(server.mode)} · ${inlineText(server.lifecycle)} · ${enabledTools}/${server.tools.length} tools enabled`,
        ),
        width,
      ),
    );
    lines.push(truncateToWidth(this.ctx.ui.theme.fg("dim", inlineText(server.sourceLabel)), width));
    if (server.lastError) {
      lines.push(
        truncateToWidth(
          this.ctx.ui.theme.fg("warning", `Last error: ${inlineText(server.lastError)}`),
          width,
        ),
      );
    }
    return [...lines, ""];
  }

  private renderServerScreen(width: number): string[] {
    this.serverList = this.buildServerList();
    const lines = this.renderHeader(width);

    if (this.servers.length === 0) {
      lines.push(
        truncateToWidth(this.ctx.ui.theme.fg("warning", "No MCP servers configured."), width),
      );
      return lines;
    }

    lines.push(...this.serverList.render(width).map((line) => truncateToWidth(line, width)));

    const selected = this.selectedServer;
    if (selected) {
      lines.push("");
      lines.push(
        truncateToWidth(this.ctx.ui.theme.fg("dim", inlineText(selected.filePath)), width),
      );
    }

    if (this.flashMessage) {
      lines.push("");
      lines.push(truncateToWidth(this.ctx.ui.theme.fg("muted", this.flashMessage), width));
    }

    return lines;
  }

  private renderFilterLine(width: number): string {
    const prefix = this.ctx.ui.theme.fg("accent", "Filter: ");

    if (!this.filterActive && !this.filterInput.getValue()) {
      return truncateToWidth(prefix + this.ctx.ui.theme.fg("dim", "press / to filter"), width);
    }

    const rendered =
      this.filterInput.render(Math.max(1, width - visibleWidth("Filter: ")))[0] ?? "";
    if (!this.filterActive)
      return truncateToWidth(prefix + rendered.replace(CURSOR_MARKER, ""), width);
    return truncateToWidth(prefix + rendered, width);
  }

  private renderToolScreen(width: number): string[] {
    const server = this.selectedServer;
    const lines = this.renderHeader(width);
    if (!server) return lines;

    this.toolList = this.buildToolList();
    lines.push(this.renderFilterLine(width));
    lines.push(
      truncateToWidth(
        this.ctx.ui.theme.fg(
          "muted",
          `Matches: ${this.filteredTools.length} / ${server.tools.length}`,
        ),
        width,
      ),
    );
    lines.push("");

    if (this.filteredTools.length === 0) {
      if (!server.enabled) {
        lines.push(
          truncateToWidth(
            this.ctx.ui.theme.fg("warning", "Enable this server to inspect its tools."),
            width,
          ),
        );
      } else if (!server.connected) {
        lines.push(
          truncateToWidth(
            this.ctx.ui.theme.fg("warning", "Reconnect this server to inspect its tools."),
            width,
          ),
        );
      } else {
        lines.push(truncateToWidth(this.ctx.ui.theme.fg("warning", "No matching tools."), width));
      }
    } else {
      lines.push(...this.toolList.render(width).map((line) => truncateToWidth(line, width)));
    }

    const selectedTool = this.selectedTool;
    if (selectedTool) {
      const detail = [
        clampText(selectedTool.description, 96) || "No description.",
        selectedTool.state === "conflict" ? "Claimed by another server." : "",
        selectedTool.state === "missing" ? "Configured but not discovered." : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push("");
      lines.push(...wrapTextWithAnsi(this.ctx.ui.theme.fg("dim", detail), Math.max(1, width)));
    }

    if (this.flashMessage) {
      lines.push("");
      lines.push(truncateToWidth(this.ctx.ui.theme.fg("muted", this.flashMessage), width));
    }

    return lines;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines =
      this.screen === "servers" ? this.renderServerScreen(width) : this.renderToolScreen(width);
    this.cachedWidth = width;
    this.cachedLines = lines.map((line) => padRight(truncateToWidth(line, width), width));
    return this.cachedLines;
  }

  handleInput(data: string): void {
    if (this.busy) return;

    if (this.screen === "tools" && this.filterActive) {
      const before = this.filterInput.getValue();

      if (matchesKey(data, Key.ctrl("c"))) {
        this.filterInput.setValue("");
        this.filterActive = false;
        this.refresh();
        return;
      }

      this.filterInput.handleInput(data);
      if (this.filterInput.getValue() !== before) {
        this.toolIndex = 0;
        this.invalidate();
      }
      this.syncChrome();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.ctrl("l"))) {
      this.done({ type: "reload" });
      return;
    }

    if (this.screen === "servers") {
      if (matchesKey(data, Key.tab)) data = Key.down;
      if (matchesKey(data, Key.shift("tab"))) data = Key.up;
      if (matchesKey(data, Key.space)) {
        const server = this.selectedServer;
        if (!server) return;
        void this.run(() => this.actions.toggleServer(server.name));
        return;
      }
      if (matchesKey(data, Key.ctrl("r"))) {
        const server = this.selectedServer;
        if (!server) return;
        void this.run(() => this.actions.reconnect(server.name));
        return;
      }
      if (matchesKey(data, Key.ctrl("d"))) {
        const server = this.selectedServer;
        if (!server) return;
        void this.run(() => this.actions.disconnect(server.name));
        return;
      }
      if (matchesKey(data, Key.ctrl("x"))) {
        const server = this.selectedServer;
        if (!server) return;
        void this.run(() => this.actions.remove(server.name));
        return;
      }

      this.serverList ??= this.buildServerList();
      this.serverList.handleInput(data);
      this.refresh();
      return;
    }

    if (data === "/") {
      this.filterActive = true;
      this.filterInput.focused = true;
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.tab)) data = Key.down;
    if (matchesKey(data, Key.shift("tab"))) data = Key.up;
    if (matchesKey(data, Key.ctrl("c"))) {
      this.filterInput.setValue("");
      this.toolIndex = 0;
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.ctrl("a"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.setAllTools(server.name, true, this.filterInput.getValue()));
      return;
    }
    if (matchesKey(data, Key.ctrl("n"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() =>
        this.actions.setAllTools(server.name, false, this.filterInput.getValue()),
      );
      return;
    }
    if (matchesKey(data, Key.ctrl("e"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.setAllTools(server.name, true, ""));
      return;
    }
    if (matchesKey(data, Key.ctrl("o"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.setAllTools(server.name, false, ""));
      return;
    }
    if (matchesKey(data, Key.ctrl("r"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.reconnect(server.name));
      return;
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.disconnect(server.name));
      return;
    }
    if (matchesKey(data, Key.ctrl("x"))) {
      const server = this.selectedServer;
      if (!server) return;
      void this.run(() => this.actions.remove(server.name));
      return;
    }

    if (matchesKey(data, Key.space)) {
      const server = this.selectedServer;
      if (!server) return;
      if (!server.enabled) {
        void this.run(() => this.actions.toggleServer(server.name));
        return;
      }
      const tool = this.selectedTool;
      if (!tool) return;
      void this.run(() => this.actions.toggleTool(server.name, tool.name));
      return;
    }

    this.toolList ??= this.buildToolList();
    this.toolList.handleInput(data);
    if (matchesKey(data, Key.escape)) return;
    this.refresh();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.serverList = undefined;
    this.toolList = undefined;
  }
}

function footerText(ctx: ExtensionCommandContext, state: ChromeState): string {
  const screen =
    state.screen === "servers"
      ? [
          keyHint("tui.select.confirm", "open"),
          rawKeyHint("space", "toggle"),
          rawKeyHint("ctrl+r", "reconnect"),
          rawKeyHint("ctrl+d", "disconnect"),
          rawKeyHint("ctrl+x", "remove"),
          rawKeyHint("ctrl+l", "reload"),
          keyHint("tui.select.cancel", "close"),
        ]
      : [
          rawKeyHint("space", "toggle"),
          rawKeyHint("/", "filter"),
          rawKeyHint("ctrl+c", "clear"),
          rawKeyHint("ctrl+a/n", "matched on/off"),
          rawKeyHint("ctrl+e/o", "all on/off"),
          rawKeyHint("ctrl+r", "reconnect"),
          rawKeyHint("ctrl+d", "disconnect"),
          rawKeyHint("ctrl+x", "remove"),
          rawKeyHint("ctrl+l", "reload"),
          keyHint("tui.select.cancel", state.filterActive ? "stop filter" : "back"),
        ];

  const left = ctx.ui.theme.fg("dim", screen.join(" · "));
  const rightLabel =
    state.screen === "servers" ? "servers" : `tools:${inlineText(state.serverName) || "-"}`;
  const right = ctx.ui.theme.fg("accent", state.busy ? `${rightLabel} · busy` : rightLabel);
  return `${left} ${right}`;
}

export async function showManager(
  ctx: ExtensionCommandContext,
  actions: ManagerActions,
): Promise<CloseAction> {
  const chrome: ChromeState = {
    screen: "servers",
    busy: false,
    flashMessage: "",
    filterActive: false,
  };

  ctx.ui.setFooter(() => ({
    invalidate() {},
    render(width: number): string[] {
      return wrapTextWithAnsi(footerText(ctx, chrome), Math.max(1, width));
    },
  }));

  const syncChrome = (next: ChromeState) => {
    chrome.screen = next.screen;
    chrome.busy = next.busy;
    chrome.flashMessage = next.flashMessage;
    chrome.serverName = next.serverName;
    chrome.filterActive = next.filterActive;
    ctx.ui.setStatus(
      "mcp",
      next.flashMessage
        ? ctx.ui.theme.fg(next.busy ? "warning" : "muted", next.flashMessage)
        : undefined,
    );
  };

  try {
    return await ctx.ui.custom<CloseAction>((tui, _theme, _kb, done) => {
      return new McpManagerComponent(ctx, tui, actions, done, syncChrome);
    });
  } finally {
    ctx.ui.setStatus("mcp", undefined);
    ctx.ui.setFooter(undefined);
  }
}
