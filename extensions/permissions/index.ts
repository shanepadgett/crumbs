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
import { clearPermissionsModeSetter, registerPermissionsModeSetter } from "./bridge.js";
import { loadPermissionsConfig, withSelectedMode } from "./config.js";
import { evaluateMutationPath, evaluateReadPath } from "./direct-tools.js";
import { findInterlockMatch } from "./interlock.js";
import { createBashOperations, initializeSandbox, resetSandbox } from "./sandbox.js";
import { renderStatus, syncStatus } from "./status.js";
import type { PermissionsConfig, RuntimeStatus } from "./types.js";

const PERMISSIONS_MODE_ENTRY = "permissions/mode";

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

function extractApplyPatchTargets(input: string): string[] {
  const paths = new Set<string>();

  for (const match of input.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm)) {
    const value = match[1]?.trim();
    if (value) paths.add(value);
  }

  for (const match of input.matchAll(/^\*\*\* Move to: (.+)$/gm)) {
    const value = match[1]?.trim();
    if (value) paths.add(value);
  }

  return Array.from(paths);
}

export default function permissionsExtension(pi: ExtensionAPI) {
  const baseBashTool = createBashTool(process.cwd());
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

  function resolveSessionMode(
    config: PermissionsConfig,
    ctx: ExtensionContext,
  ): string | undefined {
    const branchEntries = ctx.sessionManager.getBranch();

    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const entry = branchEntries[index] as {
        type?: string;
        customType?: string;
        data?: unknown;
      };

      if (entry.type !== "custom" || entry.customType !== PERMISSIONS_MODE_ENTRY) continue;
      if (!entry.data || typeof entry.data !== "object") continue;

      const mode = (entry.data as { mode?: unknown }).mode;
      if (typeof mode !== "string" || !config.modes[mode]) continue;
      return mode;
    }

    return undefined;
  }

  function persistSessionMode(mode: string) {
    pi.appendEntry(PERMISSIONS_MODE_ENTRY, { mode });
  }

  async function initializeSessionPermissions(ctx: ExtensionContext): Promise<PermissionsConfig> {
    const config = await reloadConfig(ctx.cwd);
    const sessionMode = resolveSessionMode(config, ctx);

    if (sessionMode) {
      currentConfig = withSelectedMode(config, sessionMode);
      process.env.CRUMBS_PERMISSIONS_MODE = currentConfig.mode;
      syncRuntime(currentConfig);
    }

    const activeConfig = currentConfig ?? config;
    await resetSandbox();
    await initializeSandbox(ctx, runtime, activeConfig, pi.exec);
    syncStatus(ctx, runtime, activeConfig.ui.showFooterStatus);
    return activeConfig;
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

  async function switchMode(
    nextMode: string,
    ctx: ExtensionContext,
    options?: { persist?: boolean },
  ): Promise<void> {
    const config = await ensureConfig(ctx.cwd);
    currentConfig = withSelectedMode(config, nextMode);
    process.env.CRUMBS_PERMISSIONS_MODE = currentConfig.mode;
    syncRuntime(currentConfig);
    if (options?.persist) persistSessionMode(currentConfig.mode);
    await resetSandbox();
    await initializeSandbox(ctx, runtime, currentConfig, pi.exec);
    syncStatus(ctx, runtime, currentConfig.ui.showFooterStatus);
  }

  const applyMode = async (modeKey: string, ctx: ExtensionContext): Promise<boolean> => {
    const config = await ensureConfig(ctx.cwd);
    if (!config.modes[modeKey]) return false;

    await switchMode(modeKey, ctx, { persist: true });
    return true;
  };

  registerPermissionsModeSetter(applyMode);

  pi.registerTool({
    ...baseBashTool,
    label: "bash (permissions)",
    async execute(id, params, signal, onUpdate, ctx) {
      const config = await ensureConfig(ctx.cwd);
      const operations = createBashOperations(runtime, config, pi.exec);
      if (!operations) {
        return createBashTool(ctx.cwd).execute(id, params, signal, onUpdate);
      }

      const sandboxedBash = createBashTool(ctx.cwd, { operations });
      return sandboxedBash.execute(id, params, signal, onUpdate);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const config = await initializeSessionPermissions(ctx);

    if (runtime.sandboxReason) {
      const message = config.activeMode.sandbox
        ? `permissions: ${renderStatus(runtime)} (${runtime.sandboxReason})`
        : `permissions: ${runtime.sandboxReason}`;
      ctx.ui.notify(message, "warning");
    }
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    await initializeSessionPermissions(ctx);
  });

  pi.on("session_shutdown", async () => {
    clearPermissionsModeSetter(applyMode);
    await resetSandbox();
  });

  pi.on("tool_call", async (event, ctx) => {
    const config = await ensureConfig(ctx.cwd);

    const blockMutationPath = async (path: string) => {
      const outcome = await evaluateMutationPath(ctx.cwd, path, config);
      if (!outcome) return undefined;

      if (outcome.type === "protected") {
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `Blocked by permissions: protected mutation target (${outcome.match}) requires UI confirmation`,
          };
        }

        if (await confirmProtectedMutation(path, ctx)) return undefined;
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
    };

    const blockDestructiveCommand = async (command: string) => {
      const interlock = findInterlockMatch(command);
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

      if (await confirmDestructiveOperation(command, interlock.reason, ctx)) {
        return undefined;
      }
      return {
        block: true,
        reason: `Blocked by permissions: user denied ${interlock.label}`,
      };
    };

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

    if (event.toolName === "view_image") {
      const input = event.input as { path?: string };
      if (typeof input.path !== "string") return undefined;
      const blocked = await evaluateReadPath(ctx.cwd, input.path, config);
      if (blocked) {
        return {
          block: true,
          reason: `Blocked by permissions: image target matches blocked path (${blocked})`,
        };
      }
      return undefined;
    }

    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      return blockMutationPath(event.input.path);
    }

    if (event.toolName === "apply_patch") {
      const input = event.input as { input?: string };
      if (typeof input.input !== "string") return undefined;
      for (const targetPath of extractApplyPatchTargets(input.input)) {
        const blocked = await blockMutationPath(targetPath);
        if (blocked) return blocked;
      }
      return undefined;
    }

    if (isToolCallEventType("bash", event)) {
      return blockDestructiveCommand(event.input.command);
    }

    if (event.toolName === "exec_command") {
      const input = event.input as { cmd?: string; command?: string };
      const command = typeof input.cmd === "string" ? input.cmd : input.command;
      if (typeof command !== "string") return undefined;
      return blockDestructiveCommand(command);
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

    await switchMode(modeKey, ctx, { persist: true });
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
      const requestedMode = _args.trim();

      if (requestedMode.length > 0) {
        if (!config.modes[requestedMode]) {
          ctx.ui.notify(`permissions: unknown mode ${requestedMode}`, "warning");
          return;
        }

        await setModeWithConfirmation(requestedMode, ctx);
        return;
      }

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
