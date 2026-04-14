import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { GIT_REFRESH_INTERVAL_MS, WIDGET_KEY } from "./constants.js";
import {
  CRUMBS_EVENT_CAVEMAN_CHANGED,
  CRUMBS_EVENT_FAST_CHANGED,
  CRUMBS_EVENT_THINKING_CHANGED,
} from "../../shared/crumbs-events.js";
import { loadGitSummary } from "./git.js";
import { renderFullTable } from "./render-full.js";
import { renderMinimalTable } from "./render-minimal.js";
import { loadStatusFlags, loadStatusTablePrefs, saveStatusTablePrefs } from "./settings.js";
import { buildSnapshot, getSessionTokenTotals } from "./snapshot.js";
import type {
  GitSummary,
  SessionTokenTotals,
  StatusFlags,
  StatusTableMode,
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

function asStatusFlagEvent(value: unknown): StatusFlagEvent {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
  };
}

function asCwdEvent(value: unknown): { cwd?: string } {
  if (!value || typeof value !== "object") return {};

  const record = value as Record<string, unknown>;
  return {
    cwd: typeof record.cwd === "string" ? record.cwd : undefined,
  };
}

const DEFAULT_PREFS: StatusTablePrefs = { enabled: true, mode: "full" };
const DEFAULT_FLAGS: StatusFlags = { fastEnabled: false, cavemanEnabled: false };
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

function parseModeArg(args: string): StatusTableMode | undefined {
  const value = args.trim();
  if (value === "full" || value === "minimal") return value;
  return undefined;
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

  async function refreshFlags(cwd: string): Promise<StatusFlags> {
    const flags = await loadStatusFlags(cwd);
    getWorkspaceState(cwd).flags = flags;
    return flags;
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

          return prefs.mode === "minimal"
            ? renderMinimalTable(theme, width, snapshot)
            : renderFullTable(theme, width, snapshot);
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
    key: keyof StatusFlags,
  ): void {
    if (!ctx) return;
    if (event.cwd && event.cwd !== ctx.cwd) return;
    if (typeof event.enabled !== "boolean") return;

    getWorkspaceState(ctx.cwd).flags[key] = event.enabled;
    refreshUI(ctx);
  }

  async function hydrateContext(ctx: ExtensionContext): Promise<void> {
    await ensurePrefs(ctx.cwd);
    await refreshFlags(ctx.cwd);
    refreshTokenTotals(ctx);
    setCurrentContext(ctx);
  }

  pi.events.on(CRUMBS_EVENT_FAST_CHANGED, (event) => {
    applyFlagEvent(lastContext, asStatusFlagEvent(event), "fastEnabled");
  });

  pi.events.on(CRUMBS_EVENT_CAVEMAN_CHANGED, (event) => {
    applyFlagEvent(lastContext, asStatusFlagEvent(event), "cavemanEnabled");
  });

  pi.events.on(CRUMBS_EVENT_THINKING_CHANGED, (event) => {
    const cwdEvent = asCwdEvent(event);
    if (!lastContext) return;
    if (cwdEvent.cwd && cwdEvent.cwd !== lastContext.cwd) return;
    refreshUI(lastContext);
  });

  pi.registerCommand("status-table", {
    description: "Toggle the status table or switch between full and minimal modes",
    getArgumentCompletions: (prefix) => {
      const options = ["full", "minimal"];
      const filtered = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
      if (filtered.length === 0) return null;
      return filtered.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const current = await ensurePrefs(ctx.cwd);
      await refreshFlags(ctx.cwd);
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
          ctx.ui.notify(
            next.enabled
              ? `Status table enabled (${next.mode}).`
              : `Status table disabled (${current.mode} preserved).`,
            "info",
          );
        }
        scheduleGitRefresh(ctx);
        return;
      }

      const mode = parseModeArg(trimmed);
      if (!mode) {
        if (ctx.hasUI) ctx.ui.notify("Usage: /status-table [full|minimal]", "warning");
        return;
      }

      const next = { enabled: true, mode };
      await setPrefs(ctx.cwd, next);
      scheduleUIRefresh(ctx);
      if (ctx.hasUI) ctx.ui.notify(`Status table enabled (${mode}).`, "info");
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
