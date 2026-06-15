import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeCavemanEnhancement } from "../../caveman/src/system-prompt.js";
import {
  CRUMBS_EVENT_CAVEMAN_CHANGED,
  CRUMBS_EVENT_FAST_CHANGED,
  CRUMBS_EVENT_GIT_STATUS_REFRESH_REQUESTED,
} from "../../shared/crumbs-events.js";
import { loadGitSummary } from "./git.js";
import { renderStatusLine } from "./render.js";
import { loadStatusFlags, loadStatusLinePrefs, saveStatusLinePrefs } from "./settings.js";
import type { CavemanEnhancement, GitSummary, StatusFlags, StatusLinePrefs } from "./types.js";

type WorkspaceState = {
  prefs?: StatusLinePrefs;
  flags: StatusFlags;
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

const DEFAULT_PREFS: StatusLinePrefs = { enabled: true };
const DEFAULT_FLAGS: StatusFlags = {
  fastEnabled: false,
  cavemanName: "Grug",
  cavemanEnabled: false,
  cavemanEnhancements: [],
  cavemanPowerSource: "none",
  cavemanHasSessionOverride: false,
};
const DEFAULT_GIT: GitSummary = { branch: "", summary: "" };

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
          .map((entry) => normalizeCavemanEnhancement(entry))
          .filter((entry): entry is CavemanEnhancement => Boolean(entry))
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

function asGitRefreshEvent(value: unknown): { cwd?: string } {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return { cwd: typeof record.cwd === "string" ? record.cwd : undefined };
}

export default function statusLineExtension(pi: ExtensionAPI): void {
  let lastContext: ExtensionContext | undefined;
  let lastCwd: string | undefined;
  let requestFooterRender: (() => void) | undefined;
  let footerMounted = false;
  const unsubscribeEventHandlers: Array<() => void> = [];
  const stateByCwd = new Map<string, WorkspaceState>();

  function getWorkspaceState(cwd: string): WorkspaceState {
    const cached = stateByCwd.get(cwd);
    if (cached) return cached;

    const state: WorkspaceState = {
      flags: { ...DEFAULT_FLAGS },
      git: { ...DEFAULT_GIT },
      gitRefreshNonce: 0,
    };
    stateByCwd.set(cwd, state);
    return state;
  }

  function setCurrentContext(ctx: ExtensionContext): void {
    lastContext = ctx;
    lastCwd = ctx.cwd;
  }

  function clearCurrentContext(ctx?: ExtensionContext): void {
    if (!ctx || lastContext === ctx) {
      lastContext = undefined;
      lastCwd = undefined;
    }
  }

  async function ensurePrefs(cwd: string): Promise<StatusLinePrefs> {
    const state = getWorkspaceState(cwd);
    if (state.prefs) return state.prefs;
    state.prefs = await loadStatusLinePrefs(cwd);
    return state.prefs;
  }

  async function setPrefs(cwd: string, prefs: StatusLinePrefs): Promise<void> {
    getWorkspaceState(cwd).prefs = prefs;
    await saveStatusLinePrefs(cwd, prefs);
  }

  async function refreshFlags(ctx: ExtensionContext): Promise<void> {
    getWorkspaceState(ctx.cwd).flags = await loadStatusFlags(ctx);
  }

  async function refreshGit(ctx: ExtensionContext): Promise<void> {
    const state = getWorkspaceState(ctx.cwd);
    const nonce = ++state.gitRefreshNonce;
    const git = await loadGitSummary(pi, ctx.cwd);
    if (nonce !== state.gitRefreshNonce) return;
    state.git = git;
  }

  function requestRender(ctx?: ExtensionContext): void {
    if (requestFooterRender) {
      requestFooterRender();
      return;
    }
    if (ctx) syncStatusLine(ctx);
  }

  function clearStatusLine(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    requestFooterRender = undefined;
    footerMounted = false;
    ctx.ui.setFooter(undefined);
  }

  function syncStatusLine(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    setCurrentContext(ctx);
    const state = getWorkspaceState(ctx.cwd);
    const prefs = state.prefs ?? DEFAULT_PREFS;
    if (!prefs.enabled) {
      clearStatusLine(ctx);
      return;
    }

    if (footerMounted && requestFooterRender) {
      requestFooterRender();
      return;
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribeBranchChange = footerData.onBranchChange(() => tui.requestRender());
      requestFooterRender = () => tui.requestRender();
      footerMounted = true;

      return {
        dispose(): void {
          unsubscribeBranchChange();
          requestFooterRender = undefined;
          footerMounted = false;
        },
        invalidate(): void {},
        render(width: number): string[] {
          const activeCtx = lastContext ?? ctx;
          try {
            const activeState = getWorkspaceState(activeCtx.cwd);
            const activePrefs = activeState.prefs ?? DEFAULT_PREFS;
            if (!activePrefs.enabled) return [];
            return renderStatusLine(
              theme,
              width,
              {
                ctx: activeCtx,
                footerData,
                flags: activeState.flags,
                git: activeState.git,
              },
              pi.getThinkingLevel(),
            );
          } catch {
            clearCurrentContext(activeCtx);
            return [];
          }
        },
      };
    });
  }

  async function hydrateContext(ctx: ExtensionContext): Promise<void> {
    await ensurePrefs(ctx.cwd);
    await refreshFlags(ctx);
    await refreshGit(ctx);
    setCurrentContext(ctx);
  }

  function applyFlagEvent(
    ctx: ExtensionContext | undefined,
    cwd: string | undefined,
    event: StatusFlagEvent,
    key: "fastEnabled" | "cavemanEnabled",
  ): void {
    const targetCwd = event.cwd ?? cwd;
    if (!targetCwd) return;
    if (cwd && event.cwd && event.cwd !== cwd) return;
    if (typeof event.enabled !== "boolean") return;

    getWorkspaceState(targetCwd).flags[key] = event.enabled;
    if (ctx && cwd === targetCwd) requestRender(ctx);
  }

  function applyCavemanEvent(
    ctx: ExtensionContext | undefined,
    cwd: string | undefined,
    event: CavemanFlagEvent,
  ): void {
    const targetCwd = event.cwd ?? cwd;
    if (!targetCwd) return;

    const flags = getWorkspaceState(targetCwd).flags;
    if (event.name) flags.cavemanName = event.name;
    if (typeof event.enabled === "boolean") flags.cavemanEnabled = event.enabled;
    if (event.enhancements) flags.cavemanEnhancements = [...event.enhancements];
    if (event.powerSource) flags.cavemanPowerSource = event.powerSource;
    if (typeof event.hasSessionOverride === "boolean") {
      flags.cavemanHasSessionOverride = event.hasSessionOverride;
    }
    if (ctx && cwd === targetCwd) requestRender(ctx);
  }

  unsubscribeEventHandlers.push(
    pi.events.on(CRUMBS_EVENT_FAST_CHANGED, (event) => {
      applyFlagEvent(lastContext, lastCwd, asStatusFlagEvent(event), "fastEnabled");
    }),
  );

  unsubscribeEventHandlers.push(
    pi.events.on(CRUMBS_EVENT_CAVEMAN_CHANGED, (event) => {
      applyCavemanEvent(lastContext, lastCwd, asCavemanFlagEvent(event));
    }),
  );

  unsubscribeEventHandlers.push(
    pi.events.on(CRUMBS_EVENT_GIT_STATUS_REFRESH_REQUESTED, (event) => {
      const { cwd } = asGitRefreshEvent(event);
      const ctx = lastContext;
      if (!ctx || !lastCwd || (cwd && cwd !== lastCwd)) return;

      void refreshGit(ctx).then(() => requestRender(ctx));
    }),
  );

  pi.registerCommand("status-line", {
    description: "Toggle Crumbs status line footer",
    handler: async (_args, ctx) => {
      const current = await ensurePrefs(ctx.cwd);
      const next = { enabled: !current.enabled };
      await setPrefs(ctx.cwd, next);
      await refreshFlags(ctx);

      if (next.enabled) {
        syncStatusLine(ctx);
      } else {
        clearStatusLine(ctx);
      }

      if (ctx.hasUI) {
        ctx.ui.notify(next.enabled ? "Status line enabled." : "Status line disabled.", "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("thinking_level_select", async (_event, ctx) => {
    setCurrentContext(ctx);
    requestRender(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await hydrateContext(ctx);
    syncStatusLine(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    for (const unsubscribe of unsubscribeEventHandlers.splice(0)) unsubscribe();
    clearCurrentContext();
    clearStatusLine(ctx);
  });
}
