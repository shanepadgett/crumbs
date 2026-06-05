/**
 * Auto Guardian Extension
 *
 * What it does: gates tool execution with deterministic allow/block/prompt rules and optional LLM review.
 * How to use it: configure `extensions.autoGuardian` in crumbs config, then run tools normally.
 * Example: `{ "extensions": { "autoGuardian": { "bash": { "defaultAction": "prompt" } } } }`
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultAutoGuardianConfig, loadAutoGuardianConfig } from "./src/config.js";
import { handleAutoGuardianToolCall } from "./src/gate.js";
import type { AutoGuardianConfig } from "./src/types.js";

function warningNotifier(ctx: ExtensionContext): ((message: string) => void) | undefined {
  if (!ctx.hasUI) return undefined;
  return (message) => ctx.ui.notify(message, "warning");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function autoGuardianExtension(pi: ExtensionAPI): void {
  let config: AutoGuardianConfig | undefined;
  let configLoad: Promise<AutoGuardianConfig> | undefined;
  let guardianUnavailableNotified = false;

  async function reloadConfig(cwd: string, ctx: ExtensionContext): Promise<AutoGuardianConfig> {
    try {
      const loaded = await loadAutoGuardianConfig(cwd, warningNotifier(ctx));
      config = loaded;
      guardianUnavailableNotified = false;
      return loaded;
    } catch (error) {
      const message = formatError(error);
      warningNotifier(ctx)?.(`auto-guardian: failed to load config; using defaults: ${message}`);
      config = createDefaultAutoGuardianConfig();
      guardianUnavailableNotified = false;
      return config;
    }
  }

  async function getConfig(ctx: ExtensionContext): Promise<AutoGuardianConfig> {
    if (config) return config;
    configLoad ??= reloadConfig(ctx.cwd, ctx).finally(() => {
      configLoad = undefined;
    });
    return configLoad;
  }

  pi.on("session_start", async (_event, ctx) => {
    configLoad = reloadConfig(ctx.cwd, ctx).finally(() => {
      configLoad = undefined;
    });
    await configLoad;
  });

  pi.on("tool_call", async (event, ctx) => {
    const currentConfig = await getConfig(ctx);
    return handleAutoGuardianToolCall(event, ctx, currentConfig, {
      notifyGuardianUnavailable(reason) {
        if (guardianUnavailableNotified || !ctx.hasUI) return;
        guardianUnavailableNotified = true;
        ctx.ui.notify(`auto-guardian: guardian unavailable: ${reason}`, "warning");
      },
    });
  });
}
