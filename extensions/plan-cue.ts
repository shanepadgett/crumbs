/**
 * Plan Cue Extension
 *
 * What it does:
 * - Watches user input for words that start with `plan`.
 * - Offers a popup to switch to optimal settings for planning.
 * - Sets thinking to `xhigh`.
 * - Switches permissions to `workspace-open` live.
 *
 * How to use it:
 * - Keep the extension enabled and reload Pi.
 * - Type a message containing words like `plan`, `planning`, or `planned`.
 * - Confirm the popup to switch thinking and permissions immediately.
 *
 * Example:
 * - Type `help me plan this refactor`.
 * - Confirm the popup.
 * - Pi keeps your message and continues with `xhigh` thinking and `workspace-open` permissions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PLAN_WORD_PATTERN = /\bplan[a-z-]*\b/i;
const TARGET_PERMISSION_MODE = "workspace-open";

interface PlanningSettingsState {
  needsThinking: boolean;
  needsPermissions: boolean;
}

function hasPlanCue(text: string): boolean {
  return PLAN_WORD_PATTERN.test(text);
}

function getCurrentPermissionMode(): string | undefined {
  const mode = process.env.CRUMBS_PERMISSIONS_MODE?.trim();
  return mode ? mode : undefined;
}

function getPlanningSettingsState(pi: ExtensionAPI): PlanningSettingsState {
  return {
    needsThinking: pi.getThinkingLevel() !== "xhigh",
    needsPermissions: getCurrentPermissionMode() !== TARGET_PERMISSION_MODE,
  };
}

function getConfirmationMessage(state: PlanningSettingsState): string {
  const changes: string[] = [];

  if (state.needsThinking) changes.push("- thinking: xhigh");
  if (state.needsPermissions) {
    changes.push("- permissions: workspace-open (workspace + internet open)");
  }

  return `This will switch to optimal settings for planning:\n${changes.join("\n")}`;
}

function getSuccessMessage(state: PlanningSettingsState): string {
  const applied: string[] = [];

  if (state.needsThinking) applied.push("xhigh thinking");
  if (state.needsPermissions) applied.push("workspace-open permissions");

  return `Optimal planning settings enabled: ${applied.join(" + ")}.`;
}

async function switchPermissionsMode(
  pi: ExtensionAPI,
  mode: string,
  ctx: unknown,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    pi.events.emit("permissions:set-mode", { mode, ctx, done: finish });
    setTimeout(() => finish(false), 250);
  });
}

export default function planCueExtension(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (!ctx.hasUI) return { action: "continue" };
    if (!hasPlanCue(event.text)) return { action: "continue" };

    const state = getPlanningSettingsState(pi);
    if (!state.needsThinking && !state.needsPermissions) {
      return { action: "continue" };
    }

    const confirmed = await ctx.ui.confirm(
      "Switch to optimal settings for planning?",
      getConfirmationMessage(state),
    );

    if (!confirmed) return { action: "continue" };

    if (state.needsThinking) {
      pi.setThinkingLevel("xhigh");
    }

    const permissionsChanged = state.needsPermissions
      ? await switchPermissionsMode(pi, TARGET_PERMISSION_MODE, ctx)
      : true;

    if (permissionsChanged) {
      ctx.ui.notify(getSuccessMessage(state), "info");
      return { action: "continue" };
    }

    ctx.ui.notify(
      "Optimal planning settings partly applied: permissions could not switch to workspace-open.",
      "warning",
    );
    return { action: "continue" };
  });
}
