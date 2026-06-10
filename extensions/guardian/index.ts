/**
 * Guardian Extension
 *
 * What it does: gates tool execution with deterministic allow/block/prompt rules and auto approval.
 * How to use it: configure `extensions.guardian` in crumbs config, then run tools normally.
 * Example: `{ "extensions": { "guardian": { "mutation": { "rules": [{ "paths": ["README.md"], "action": "prompt" }] } } } }`
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createDefaultGuardianConfig, loadGuardianConfig } from "./src/config.js";
import { handleGuardianToolCall } from "./src/gate.js";
import type { GuardianConfig } from "./src/types.js";

const CRUMBS_EVENT_USER_INPUT_REQUIRED = "crumbs:user-input-required";

function warningNotifier(ctx: ExtensionContext): ((message: string) => void) | undefined {
  if (!ctx.hasUI) return undefined;
  return (message) => ctx.ui.notify(message, "warning");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function guardianExtension(pi: ExtensionAPI): void {
  let config: GuardianConfig | undefined;
  let configLoad: Promise<GuardianConfig> | undefined;
  let guardianUnavailableNotified = false;

  async function reloadConfig(cwd: string, ctx: ExtensionContext): Promise<GuardianConfig> {
    try {
      const loaded = await loadGuardianConfig(cwd, warningNotifier(ctx));
      config = loaded;
      guardianUnavailableNotified = false;
      return loaded;
    } catch (error) {
      const message = formatError(error);
      warningNotifier(ctx)?.(`guardian: failed to load config; using defaults: ${message}`);
      config = createDefaultGuardianConfig();
      guardianUnavailableNotified = false;
      return config;
    }
  }

  async function getConfig(ctx: ExtensionContext): Promise<GuardianConfig> {
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
    return handleGuardianToolCall(event, ctx, currentConfig, {
      notifyGuardianUnavailable(reason) {
        if (guardianUnavailableNotified || !ctx.hasUI) return;
        guardianUnavailableNotified = true;
        ctx.ui.notify(`guardian: autoApprove unavailable: ${reason}`, "warning");
      },
      notifyUserInputRequired() {
        pi.events.emit(CRUMBS_EVENT_USER_INPUT_REQUIRED, undefined);
      },
    });
  });
}
