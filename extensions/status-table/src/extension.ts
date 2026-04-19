import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { normalizeCavemanEnhancement } from "../../caveman/src/system-prompt.js";
import type { MultiSelectItem } from "../../shared/ui/multi-select-list.js";
import { MultiSelectList } from "../../shared/ui/multi-select-list.js";
import { GIT_REFRESH_INTERVAL_MS, WIDGET_KEY } from "./constants.js";
import {
  CRUMBS_EVENT_CAVEMAN_CHANGED,
  CRUMBS_EVENT_FAST_CHANGED,
  CRUMBS_EVENT_FOCUS_ADV_CHANGED,
  CRUMBS_EVENT_THINKING_CHANGED,
} from "../../shared/crumbs-events.js";
import { loadGitSummary } from "./git.js";
import { renderMinimalTable } from "./render-minimal.js";
import { loadStatusFlags, loadStatusTablePrefs, saveStatusTablePrefs } from "./settings.js";
import { buildSnapshot, getSessionTokenTotals } from "./snapshot.js";
import type {
  CavemanEnhancement,
  GitSummary,
  SessionTokenTotals,
  StatusBlockId,
  StatusFlags,
  StatusTablePrefs,
} from "./types.js";

type WorkspaceState = {
  prefs?: StatusTablePrefs;
  flags: StatusFlags;
  tokenTotals: SessionTokenTotals;
  git: GitSummary;
  gitRefreshNonce: number;
};

type StatusFlagEvent = {
  cwd?: string;
  enabled?: boolean;
};

type CavemanFlagEvent = StatusFlagEvent & {
  name?: string;
  enhancements?: CavemanEnhancement[];
  powerSource?: "session" | "project" | "global" | "none";
  hasSessionOverride?: boolean;
};

type FocusFlagEvent = StatusFlagEvent & {
  mode?: "off" | "soft" | "hidden" | "hard";
};

function asStatusFlagEvent(value: unknown): StatusFlagEvent {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
  };
}

function asCavemanFlagEvent(value: unknown): CavemanFlagEvent {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
    enhancements: Array.isArray(record.enhancements)
      ? record.enhancements
          .map((value) => normalizeCavemanEnhancement(value))
          .filter((value): value is CavemanEnhancement => Boolean(value))
      : undefined,
    powerSource:
      record.powerSource === "session" ||
      record.powerSource === "project" ||
      record.powerSource === "global" ||
      record.powerSource === "none"
        ? record.powerSource
        : undefined,
    hasSessionOverride:
      typeof record.hasSessionOverride === "boolean" ? record.hasSessionOverride : undefined,
  };
}

function asCwdEvent(value: unknown): { cwd?: string } {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
  };
}

function asFocusFlagEvent(value: unknown): FocusFlagEvent {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    mode:
      record.mode === "off" ||
      record.mode === "soft" ||
      record.mode === "hidden" ||
      record.mode === "hard"
        ? record.mode
        : undefined,
  };
}

const DEFAULT_VISIBLE_BLOCKS: StatusBlockId[] = [
  "path",
  "git",
  "provider",
  "model",
  "thinking",
  "focus",
  "fast",
  "caveman",
  "context",
  "tokens",
];
const DEFAULT_PREFS: StatusTablePrefs = {
  enabled: true,
  visibleBlocks: [...DEFAULT_VISIBLE_BLOCKS],
};
const DEFAULT_FLAGS: StatusFlags = {
  fastEnabled: false,
  cavemanName: "Grug",
  cavemanEnabled: false,
  cavemanEnhancements: [],
  cavemanPowerSource: "none",
  cavemanHasSessionOverride: false,
  focusEnabled: false,
  focusMode: "hidden",
};
const DEFAULT_TOKEN_TOTALS: SessionTokenTotals = { input: 0, output: 0 };
const DEFAULT_GIT: GitSummary = { branch: "no git", summary: "no git" };

function hideFooter(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  ctx.ui.setFooter(() => ({
    invalidate() {},
    render(): string[] {
      return [];
    },
  }));
}

function clearStatusTable(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  ctx.ui.setFooter(undefined);
}

const STATUS_BLOCK_OPTIONS: { id: StatusBlockId; label: string; description: string }[] = [
  { id: "path", label: "Path", description: "Current working directory" },
  { id: "git", label: "Git", description: "Current branch and git cleanliness" },
  { id: "provider", label: "Provider", description: "Active model provider" },
  { id: "model", label: "Model", description: "Active model id" },
  { id: "thinking", label: "Thinking", description: "Current thinking level" },
  { id: "focus", label: "Focus", description: "focus-advanced state" },
  { id: "fast", label: "Fast", description: "Codex fast mode" },
  { id: "caveman", label: "Caveman", description: "Caveman state and powers" },
  { id: "context", label: "Context", description: "Current context usage" },
  { id: "tokens", label: "Tokens", description: "Accumulated session token totals" },
];

async function openStatusTableConfig(
  ctx: ExtensionContext,
  currentVisibleBlocks: StatusBlockId[],
): Promise<StatusBlockId[] | null> {
  if (!ctx.hasUI) return null;

  let draft = [...currentVisibleBlocks];

  return ctx.ui.custom<StatusBlockId[] | null>((tui, theme, _kb, done) => {
    const items: MultiSelectItem[] = STATUS_BLOCK_OPTIONS.map((block) => ({
      value: block.id,
      label: block.label,
      description: block.description,
    }));

    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold("Status table config")), 1, 0));
    container.addChild(new Text(theme.fg("muted", "Toggle blocks rendered below editor."), 1, 0));

    const list = new MultiSelectList(items, Math.min(items.length + 2, 12), {
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });
    list.setCheckedValues(draft);
    list.onToggle = (values) => {
      draft = STATUS_BLOCK_OPTIONS.map((block) => block.id).filter((id) => values.includes(id));
    };
    list.onConfirm = (values) => {
      const next = STATUS_BLOCK_OPTIONS.map((block) => block.id).filter((id) =>
        values.includes(id),
      );
      done(next.length > 0 ? next : []);
    };
    list.onCancel = () => done(null);

    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "Space toggle • Enter save • Esc close"), 1, 0));
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      focused: true,
      render(width: number): string[] {
        return container.render(width);
      },
      invalidate(): void {
        container.invalidate();
      },
      handleInput(data: string): void {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

export default function statusTableExtension(pi: ExtensionAPI): void {
  let lastContext: ExtensionContext | undefined;
  let gitRefreshTimer: ReturnType<typeof setInterval> | undefined;
  const stateByCwd = new Map<string, WorkspaceState>();

  function getWorkspaceState(cwd: string): WorkspaceState {
    const cached = stateByCwd.get(cwd);
    if (cached) return cached;

    const state: WorkspaceState = {
      flags: { ...DEFAULT_FLAGS },
      tokenTotals: { ...DEFAULT_TOKEN_TOTALS },
      git: { ...DEFAULT_GIT },
      gitRefreshNonce: 0,
    };
    stateByCwd.set(cwd, state);
    return state;
  }

  function setCurrentContext(ctx: ExtensionContext): void {
    lastContext = ctx;
  }

  async function ensurePrefs(cwd: string): Promise<StatusTablePrefs> {
    const state = getWorkspaceState(cwd);
    if (state.prefs) return state.prefs;

    const prefs = await loadStatusTablePrefs(cwd);
    state.prefs = prefs;
    return prefs;
  }

  async function refreshFlags(ctx: ExtensionContext): Promise<StatusFlags> {
    const state = getWorkspaceState(ctx.cwd);
    const flags = await loadStatusFlags(ctx);
    state.flags = { ...flags };
    return state.flags;
  }

  function refreshTokenTotals(ctx: ExtensionContext): SessionTokenTotals {
    const totals = getSessionTokenTotals(ctx);
    getWorkspaceState(ctx.cwd).tokenTotals = totals;
    return totals;
  }

  async function setPrefs(cwd: string, prefs: StatusTablePrefs): Promise<void> {
    getWorkspaceState(cwd).prefs = prefs;
    await saveStatusTablePrefs(cwd, prefs);
  }

  function renderSnapshot(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    setCurrentContext(ctx);
    const state = getWorkspaceState(ctx.cwd);
    const prefs = state.prefs ?? DEFAULT_PREFS;

    if (!prefs.enabled) {
      clearStatusTable(ctx);
      return;
    }

    hideFooter(ctx);

    ctx.ui.setWidget(
      WIDGET_KEY,
      (_tui, theme) => ({
        invalidate() {},
        render(width: number): string[] {
          const currentState = getWorkspaceState(ctx.cwd);
          const snapshot = buildSnapshot(
            pi,
            ctx,
            currentState.git,
            currentState.tokenTotals,
            currentState.flags,
          );

          return renderMinimalTable(theme, width, snapshot, prefs.visibleBlocks);
        },
      }),
      { placement: "belowEditor" },
    );
  }

  function refreshUI(ctx: ExtensionContext): void {
    renderSnapshot(ctx);
  }

  async function refreshGit(ctx: ExtensionContext): Promise<void> {
    setCurrentContext(ctx);
    const state = getWorkspaceState(ctx.cwd);
    const nonce = ++state.gitRefreshNonce;
    const git = await loadGitSummary(pi, ctx.cwd);
    if (nonce !== state.gitRefreshNonce) return;

    state.git = git;
    if (lastContext?.cwd !== ctx.cwd) return;
    renderSnapshot(lastContext);
  }

  function scheduleUIRefresh(ctx: ExtensionContext): void {
    setCurrentContext(ctx);
    refreshUI(ctx);
  }

  function scheduleGitRefresh(ctx: ExtensionContext): void {
    setCurrentContext(ctx);
    void refreshGit(ctx);
  }

  function startGitPolling(ctx: ExtensionContext): void {
    if (gitRefreshTimer) return;

    gitRefreshTimer = setInterval(() => {
      if (!lastContext) return;
      void refreshGit(lastContext);
    }, GIT_REFRESH_INTERVAL_MS);
    gitRefreshTimer.unref?.();

    scheduleGitRefresh(ctx);
  }

  function stopGitPolling(): void {
    if (!gitRefreshTimer) return;
    clearInterval(gitRefreshTimer);
    gitRefreshTimer = undefined;
  }

  function applyFlagEvent(
    ctx: ExtensionContext | undefined,
    event: StatusFlagEvent,
    key: "fastEnabled" | "cavemanEnabled",
  ): void {
    if (!ctx) return;
    if (event.cwd && event.cwd !== ctx.cwd) return;
    if (typeof event.enabled !== "boolean") return;

    getWorkspaceState(ctx.cwd).flags[key] = event.enabled;
    refreshUI(ctx);
  }

  function applyCavemanEvent(ctx: ExtensionContext | undefined, event: CavemanFlagEvent): void {
    const targetCwd = event.cwd ?? ctx?.cwd;
    if (!targetCwd) return;

    const flags = getWorkspaceState(targetCwd).flags;
    if (event.name) flags.cavemanName = event.name;
    if (typeof event.enabled === "boolean") flags.cavemanEnabled = event.enabled;
    if (event.enhancements) flags.cavemanEnhancements = [...event.enhancements];
    if (event.powerSource) flags.cavemanPowerSource = event.powerSource;
    if (typeof event.hasSessionOverride === "boolean") {
      flags.cavemanHasSessionOverride = event.hasSessionOverride;
    }
    if (ctx && ctx.cwd === targetCwd) refreshUI(ctx);
  }

  function applyFocusEvent(ctx: ExtensionContext | undefined, event: FocusFlagEvent): void {
    if (!ctx) return;
    if (event.cwd && event.cwd !== ctx.cwd) return;

    const flags = getWorkspaceState(ctx.cwd).flags;
    if (typeof event.enabled === "boolean") flags.focusEnabled = event.enabled;
    if (event.mode && event.mode !== "off") flags.focusMode = event.mode;
    if (event.mode === "off") flags.focusEnabled = false;
    refreshUI(ctx);
  }

  async function hydrateContext(ctx: ExtensionContext): Promise<void> {
    await ensurePrefs(ctx.cwd);
    await refreshFlags(ctx);
    refreshTokenTotals(ctx);
    setCurrentContext(ctx);
  }

  pi.events.on(CRUMBS_EVENT_FAST_CHANGED, (event) => {
    applyFlagEvent(lastContext, asStatusFlagEvent(event), "fastEnabled");
  });

  pi.events.on(CRUMBS_EVENT_CAVEMAN_CHANGED, (event) => {
    applyCavemanEvent(lastContext, asCavemanFlagEvent(event));
  });

  pi.events.on(CRUMBS_EVENT_THINKING_CHANGED, (event) => {
    const cwdEvent = asCwdEvent(event);
    if (!lastContext) return;
    if (cwdEvent.cwd && cwdEvent.cwd !== lastContext.cwd) return;
    refreshUI(lastContext);
  });

  pi.events.on(CRUMBS_EVENT_FOCUS_ADV_CHANGED, (event) => {
    applyFocusEvent(lastContext, asFocusFlagEvent(event));
  });

  pi.registerCommand("status-table", {
    description: "Toggle status table or configure visible blocks",
    getArgumentCompletions: (prefix) => {
      const options = ["config"];
      const filtered = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
      if (filtered.length === 0) return null;
      return filtered.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const current = await ensurePrefs(ctx.cwd);
      await refreshFlags(ctx);
      refreshTokenTotals(ctx);

      if (!trimmed) {
        const next = { ...current, enabled: !current.enabled };
        await setPrefs(ctx.cwd, next);
        if (next.enabled) {
          scheduleUIRefresh(ctx);
        } else {
          clearStatusTable(ctx);
        }
        if (ctx.hasUI) {
          ctx.ui.notify(next.enabled ? "Status table enabled." : "Status table disabled.", "info");
        }
        scheduleGitRefresh(ctx);
        return;
      }

      if (trimmed !== "config") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /status-table [config]", "warning");
        return;
      }

      const visibleBlocks = await openStatusTableConfig(ctx, current.visibleBlocks);
      if (!visibleBlocks) return;

      const next = { enabled: true, visibleBlocks };
      await setPrefs(ctx.cwd, next);
      scheduleUIRefresh(ctx);
      if (ctx.hasUI) ctx.ui.notify("Status table config saved.", "info");
      scheduleGitRefresh(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    await hydrateContext(ctx);
    startGitPolling(ctx);
    scheduleUIRefresh(ctx);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
    scheduleGitRefresh(ctx);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
    scheduleGitRefresh(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
    scheduleGitRefresh(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await hydrateContext(ctx);
    scheduleUIRefresh(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopGitPolling();
    lastContext = undefined;
    clearStatusTable(ctx);
  });
}
