/**
 * Workspaces Extension
 *
 * What it does:
 * - Adds a Git worktree manager with a searchable list UI.
 * - Supports open, create, return to lobby, and remove.
 * - Shows whether the current session is in the lobby or a workspace.
 *
 * How to use it:
 * - Install this package with `pi install .` and keep the extension enabled.
 * - Reload extensions with `/reload`.
 * - Open the manager with `/workspaces` or `Ctrl+Shift+W`.
 *
 * Example:
 * - Run `/workspaces`, select a row, and press `Enter` to open it.
 * - Press `Ctrl+N` to create a workspace from a new branch.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  createWorkspace,
  openWorkspace,
  removeWorkspace,
  returnToLobby,
} from "./src/workspace-actions.js";
import { listWorkspaces } from "./src/git-worktrees.js";
import { resolveRepoContext } from "./src/repo-context.js";
import { clearOrientationStatus, updateOrientationStatus } from "./src/status.js";
import type { RepoContext, UiState, WorkspaceSelectorAction } from "./src/types.js";
import { WorkspaceSelector, normalizeSelection } from "./src/ui/workspaces-selector.js";
import { rememberLobbySession } from "./src/workspace-sessions.js";

function formatRepoError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository|not inside a work tree/i.test(message)) {
    return "Not inside a Git worktree";
  }
  return message;
}

export default function workspacesExtension(pi: ExtensionAPI): void {
  const preferredLobbySessionByPath = new Map<string, string>();
  let sessionControls:
    | {
        switchSession: ExtensionCommandContext["switchSession"];
      }
    | undefined;

  function rememberSessionControls(ctx: ExtensionContext): void {
    if (!("switchSession" in ctx) || typeof ctx.switchSession !== "function") return;
    sessionControls = {
      switchSession: ctx.switchSession.bind(ctx) as ExtensionCommandContext["switchSession"],
    };
  }

  function getActionContext(ctx: ExtensionContext): ExtensionContext {
    if (!sessionControls) return ctx;
    return { ...ctx, switchSession: sessionControls.switchSession } as ExtensionContext;
  }

  async function showWorkspaceSelector(
    ctx: ExtensionContext,
    repo: RepoContext,
    state: UiState,
  ): Promise<WorkspaceSelectorAction | undefined> {
    return ctx.ui.custom<WorkspaceSelectorAction | undefined>(
      (tui, _theme, _kb, done) =>
        new WorkspaceSelector(ctx, repo, state, () => tui.requestRender(), done),
      {
        overlay: true,
        overlayOptions: {
          anchor: "bottom-center",
          width: "100%",
          maxHeight: "48%",
          margin: { left: 0, right: 0, bottom: 3 },
        },
      },
    );
  }

  async function openWorkspaces(ctx: ExtensionContext): Promise<void> {
    rememberSessionControls(ctx);

    let repo: RepoContext;
    try {
      repo = await resolveRepoContext(pi.exec, ctx.cwd);
    } catch (error) {
      ctx.ui.notify(formatRepoError(error), "error");
      return;
    }

    const state: UiState = {
      query: "",
      selectedIndex: 0,
      rows: [],
      message: undefined,
    };

    const refresh = async (): Promise<void> => {
      state.rows = await listWorkspaces(pi.exec, repo);
      normalizeSelection(state);
    };

    while (true) {
      try {
        await refresh();
      } catch (error) {
        ctx.ui.notify(formatRepoError(error), "error");
        return;
      }

      const action = await showWorkspaceSelector(ctx, repo, state);
      if (!action) return;

      try {
        const actionCtx = getActionContext(ctx);
        const result =
          action.type === "open"
            ? await openWorkspace(actionCtx, pi.exec, action.workspace, preferredLobbySessionByPath)
            : action.type === "create"
              ? await createWorkspace(actionCtx, pi.exec, repo, preferredLobbySessionByPath)
              : action.type === "lobby"
                ? await returnToLobby(actionCtx, repo, preferredLobbySessionByPath)
                : await removeWorkspace(actionCtx, pi.exec, repo, action.workspace);

        state.message = result.message;
        if (result.close) return;
      } catch (error) {
        state.message = { type: "error", text: formatRepoError(error) };
      }
    }
  }

  pi.registerCommand("workspaces", {
    description: "Open workspaces manager",
    handler: async (_args, ctx) => {
      await openWorkspaces(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+w", {
    description: "Open workspaces manager",
    handler: async (ctx) => {
      if (!sessionControls) {
        ctx.ui.notify("Run /workspaces once after reload, then the shortcut works", "info");
        return;
      }

      await openWorkspaces(ctx);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await rememberLobbySession(ctx, pi.exec, preferredLobbySessionByPath);
    await updateOrientationStatus(ctx, pi.exec);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: any) => {
    await rememberLobbySession(ctx, pi.exec, preferredLobbySessionByPath);
    await updateOrientationStatus(ctx, pi.exec);
  });

  (pi as any).on("session_before_switch", async (_event: unknown, ctx: any) => {
    await rememberLobbySession(ctx, pi.exec, preferredLobbySessionByPath);
    clearOrientationStatus(ctx);
  });

  (pi as any).on("session_shutdown", async (_event: unknown, ctx: any) => {
    await rememberLobbySession(ctx, pi.exec, preferredLobbySessionByPath);
    clearOrientationStatus(ctx);
  });
}
