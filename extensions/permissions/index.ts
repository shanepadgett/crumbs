/**
 * Permissions Extension
 *
 * What it does: provides a unified `permissions` extension that manages mode
 * selection, direct-tool fencing, sandboxed shell execution,
 * destructive-operation prompts, and status output.
 *
 * How to use it: configure `.pi/crumbs.json` with a `permissions` block, then
 * use `/permission` to choose a mode from a popup.
 *
 * Example:
 * {
 *   "permissions": {
 *     "mode": "workspace",
 *     "modes": {
 *       "research": {
 *         "label": "research",
 *         "base": "read-only",
 *         "networkMode": "open",
 *         "direct": {
 *           "allowPaths": ["research/*.md"]
 *         }
 *       }
 *     }
 *   }
 * }
 */

import {
  createBashTool,
  createLocalBashOperations,
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { loadPermissionsConfig, withSelectedMode } from "./config.js";
import { evaluateMutationPath, evaluateReadPath } from "./direct-tools.js";
import { findInterlockMatch } from "./interlock.js";
import { createBashOperations, initializeSandbox, resetSandbox } from "./sandbox.js";
import { renderStatus, syncStatus } from "./status.js";
import type { PermissionsConfig, RuntimeStatus } from "./types.js";

async function confirmProtectedMutation(path: string, ctx: ExtensionContext): Promise<boolean> {
  return ctx.ui.confirm("Protected file mutation", `Allow a direct mutation to ${path}?`);
}

async function confirmDestructiveOperation(
  command: string,
  reason: string,
  ctx: ExtensionContext,
): Promise<boolean> {
  return ctx.ui.confirm("Destructive operation", `${reason}\n\nCommand:\n${command}`);
}

export default function permissionsExtension(pi: ExtensionAPI) {
  const localCwd = process.cwd();
  const localBash = createBashTool(localCwd);
  let currentConfig: PermissionsConfig | undefined;
  const runtime: RuntimeStatus = {
    modeKey: "workspace",
    modeLabel: "workspace",
    networkMode: "restricted",
    sandboxState: "off",
  };

  function syncRuntime(config: PermissionsConfig) {
    runtime.modeKey = config.activeMode.key;
    runtime.modeLabel = config.activeMode.label;
    runtime.networkMode = config.activeMode.networkMode;
  }

  async function ensureConfig(cwd: string): Promise<PermissionsConfig> {
    if (currentConfig) return currentConfig;
    currentConfig = await loadPermissionsConfig(cwd);
    process.env.CRUMBS_PERMISSIONS_MODE = currentConfig.mode;
    syncRuntime(currentConfig);
    return currentConfig;
  }

  async function reloadConfig(cwd: string): Promise<PermissionsConfig> {
    currentConfig = await loadPermissionsConfig(cwd);
    process.env.CRUMBS_PERMISSIONS_MODE = currentConfig.mode;
    syncRuntime(currentConfig);
    return currentConfig;
  }

  async function switchMode(nextMode: string, ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx.cwd);
    currentConfig = withSelectedMode(config, nextMode);
    process.env.CRUMBS_PERMISSIONS_MODE = currentConfig.mode;
    syncRuntime(currentConfig);
    await resetSandbox();
    await initializeSandbox(ctx, runtime, currentConfig);
    syncStatus(ctx, runtime, currentConfig.ui.showFooterStatus);
  }

  pi.registerTool({
    ...localBash,
    label: "bash (permissions)",
    async execute(id, params, signal, onUpdate) {
      const config = await ensureConfig(localCwd);
      const operations = createBashOperations(runtime, config);
      if (!operations) {
        return localBash.execute(id, params, signal, onUpdate);
      }

      const sandboxedBash = createBashTool(localCwd, { operations });
      return sandboxedBash.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const config = await reloadConfig(ctx.cwd);
    await initializeSandbox(ctx, runtime, config);
    syncStatus(ctx, runtime, config.ui.showFooterStatus);

    if (runtime.sandboxReason) {
      const message = config.activeMode.sandbox
        ? `permissions: ${renderStatus(runtime)} (${runtime.sandboxReason})`
        : `permissions: ${runtime.sandboxReason}`;
      ctx.ui.notify(message, "warning");
    }
  });

  pi.on("session_shutdown", async () => {
    await resetSandbox();
  });

  pi.on("tool_call", async (event, ctx) => {
    const config = await ensureConfig(ctx.cwd);

    if (isToolCallEventType("read", event)) {
      const blocked = await evaluateReadPath(ctx.cwd, event.input.path, config);
      if (blocked) {
        return {
          block: true,
          reason: `Blocked by permissions: read target matches blocked path (${blocked})`,
        };
      }
      return undefined;
    }

    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const outcome = await evaluateMutationPath(ctx.cwd, event.input.path, config);
      if (!outcome) return undefined;

      if (outcome.type === "protected") {
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `Blocked by permissions: protected mutation target (${outcome.match}) requires UI confirmation`,
          };
        }

        if (await confirmProtectedMutation(event.input.path, ctx)) return undefined;
        return {
          block: true,
          reason: `Blocked by permissions: direct mutation denied for protected path (${outcome.match})`,
        };
      }

      if (outcome.type === "outside-workspace") {
        return {
          block: true,
          reason: `Blocked by permissions: direct mutations must stay inside the repo root (${outcome.match})`,
        };
      }

      return {
        block: true,
        reason: `Blocked by permissions: mutation target is not allowed in mode ${config.activeMode.key} (${outcome.match})`,
      };
    }

    if (isToolCallEventType("bash", event)) {
      const interlock = findInterlockMatch(event.input.command);
      if (!interlock) return undefined;

      if (config.activeMode.destructivePolicy === "allow") {
        return undefined;
      }

      if (config.activeMode.destructivePolicy === "block") {
        return {
          block: true,
          reason: `Blocked by permissions: ${interlock.label} is not allowed in mode ${config.activeMode.key}. ${interlock.reason}`,
        };
      }

      if (!ctx.hasUI) {
        if (config.destructive.onNoUi === "allow") return undefined;
        return {
          block: true,
          reason: `Blocked by permissions: ${interlock.label} requires confirmation but no UI is available`,
        };
      }

      if (await confirmDestructiveOperation(event.input.command, interlock.reason, ctx)) {
        return undefined;
      }
      return {
        block: true,
        reason: `Blocked by permissions: user denied ${interlock.label}`,
      };
    }

    return undefined;
  });

  pi.on("user_bash", async (event, ctx) => {
    const config = await ensureConfig(ctx.cwd);
    const interlock = findInterlockMatch(event.command);

    if (interlock) {
      if (config.activeMode.destructivePolicy === "block") {
        return {
          result: {
            output: `Blocked by permissions: ${interlock.label} is not allowed in mode ${config.activeMode.key}.`,
            exitCode: 1,
            cancelled: false,
            truncated: false,
          },
        };
      }

      if (config.activeMode.destructivePolicy === "prompt") {
        if (!ctx.hasUI) {
          if (config.destructive.onNoUi !== "allow") {
            return {
              result: {
                output: `Blocked by permissions: ${interlock.label} requires confirmation but no UI is available.`,
                exitCode: 1,
                cancelled: false,
                truncated: false,
              },
            };
          }
        } else if (!(await confirmDestructiveOperation(event.command, interlock.reason, ctx))) {
          return {
            result: {
              output: `Blocked by permissions: user denied ${interlock.label}.`,
              exitCode: 1,
              cancelled: false,
              truncated: false,
            },
          };
        }
      }
    }

    const operations = createBashOperations(runtime, config);
    if (operations) return { operations };
    return { operations: createLocalBashOperations() };
  });

  async function setModeWithConfirmation(modeKey: string, ctx: ExtensionContext): Promise<boolean> {
    const config = await ensureConfig(ctx.cwd);
    const mode = config.modes[modeKey];
    if (!mode) return false;

    if (!mode.sandbox) {
      const confirmed =
        !ctx.hasUI ||
        (await ctx.ui.confirm(`Enter ${mode.label}?`, "This disables the sandbox completely."));
      if (!confirmed) {
        ctx.ui.notify(`permissions: ${mode.label} cancelled`, "info");
        return false;
      }
    }

    await switchMode(modeKey, ctx);
    const updatedConfig = await ensureConfig(ctx.cwd);
    if (updatedConfig.activeMode.sandbox) {
      ctx.ui.notify(`permissions: ${renderStatus(runtime)}`, "info");
    }
    if (runtime.sandboxReason) {
      ctx.ui.notify(`permissions: ${runtime.sandboxReason}`, "warning");
    }
    return true;
  }

  pi.registerCommand("permission", {
    description: "Choose permissions mode",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      const config = await ensureConfig(ctx.cwd);
      const choices = config.modeOrder.map((modeKey) => {
        const mode = config.modes[modeKey];
        const parts = [mode.label];
        if (mode.sandbox) parts.push(`net: ${mode.networkMode}`);
        else parts.push("sbx: off");
        const label = parts.join(" · ");
        return {
          key: modeKey,
          label: modeKey === config.mode ? `${label} (current)` : label,
        };
      });

      const choice = await ctx.ui.select(
        "Choose permissions mode",
        choices.map((entry) => entry.label),
      );

      if (!choice) return;

      const selected = choices.find((entry) => entry.label === choice);
      if (!selected) return;

      await setModeWithConfirmation(selected.key, ctx);
    },
  });
}
