/**
 * Plan Cue Extension
 *
 * What it does:
 * - Watches user input for words that start with `plan`.
 * - Offers a popup to switch into a heavier planning setup.
 * - Sets thinking to `xhigh`.
 * - Switches permissions to `workspace-open` live.
 *
 * How to use it:
 * - Keep the extension enabled and reload Pi.
 * - Type a message containing words like `plan`, `planning`, or `planned`.
 * - Confirm the popup to boost thinking and switch permissions immediately.
 *
 * Example:
 * - Type `help me plan this refactor`.
 * - Confirm the popup.
 * - Pi keeps your message and continues with `xhigh` thinking and `workspace-open` permissions.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { setPermissionsMode } from "./permissions/bridge.js";

const PLAN_WORD_PATTERN = /\bplan[a-z-]*\b/i;
const TARGET_PERMISSION_MODE = "workspace-open";

function hasPlanCue(text: string): boolean {
  return PLAN_WORD_PATTERN.test(text);
}

export default function planCueExtension(pi: ExtensionAPI): void {
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };
    if (!ctx.hasUI) return { action: "continue" };
    if (!hasPlanCue(event.text)) return { action: "continue" };

    const confirmed = await ctx.ui.confirm(
      "Switch into plan mode?",
      "This will set thinking to xhigh and switch permissions to workspace-open with network access.",
    );

    if (!confirmed) return { action: "continue" };

    pi.setThinkingLevel("xhigh");

    const permissionsChanged = await setPermissionsMode(TARGET_PERMISSION_MODE, ctx);
    if (permissionsChanged) {
      ctx.ui.notify("Plan mode ready: xhigh thinking + workspace-open permissions.", "info");
      return { action: "continue" };
    }

    ctx.ui.notify(
      "Plan mode ready: xhigh thinking enabled. Permissions extension could not switch to workspace-open.",
      "warning",
    );
    return { action: "continue" };
  });
}
