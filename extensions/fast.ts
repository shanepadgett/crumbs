/**
 * Fast Toggle Extension
 *
 * What this does:
 * - Adds `/fast` to toggle OpenAI/OpenAI Codex priority mode for provider requests.
 * - Persists the toggle state in global settings, so it survives session switches and restarts.
 * - Applies automatically whenever you are on a supported model.
 *
 * How to use:
 * - Run `/fast` to enable or disable fast mode.
 * - Switch models freely; fast mode stays in the last state you set.
 *
 * Example:
 * - Select an OpenAI Codex model.
 * - Run `/fast`.
 * - Status line shows `⚡` and requests include `service_tier: "priority"`.
 */

import {
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "fast";
const SETTINGS_KEY = "crumbs-fast";

const settingsManagers = new Map<string, SettingsManager>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCodexSupportedProvider(ctx: ExtensionContext): boolean {
  return ctx.model?.provider === "openai" || ctx.model?.provider === "openai-codex";
}

function updateStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) return;
  if (!enabled || !isCodexSupportedProvider(ctx)) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", "⚡"));
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getSettingsManager(cwd: string): SettingsManager {
  const existing = settingsManagers.get(cwd);
  if (existing) return existing;

  const manager = SettingsManager.create(cwd);
  settingsManagers.set(cwd, manager);
  return manager;
}

function mergeSettings(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = merged[key];
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      merged[key] = mergeSettings(baseValue, overrideValue);
      continue;
    }
    merged[key] = overrideValue;
  }
  return merged;
}

function getEffectiveSettings(settingsManager: SettingsManager): Record<string, unknown> {
  return mergeSettings(
    settingsManager.getGlobalSettings() as Record<string, unknown>,
    settingsManager.getProjectSettings() as Record<string, unknown>,
  );
}

function loadPersistedState(cwd: string): boolean | undefined {
  const settingsManager = getSettingsManager(cwd);
  settingsManager.reload();
  const settings = getEffectiveSettings(settingsManager);
  const extensionSettings = asObject(settings[SETTINGS_KEY]);
  return typeof extensionSettings?.enabled === "boolean" ? extensionSettings.enabled : undefined;
}

function persistState(enabled: boolean, cwd: string): SettingsManager {
  const settingsManager = getSettingsManager(cwd);
  const internal = settingsManager as unknown as {
    globalSettings: Record<string, unknown>;
    markModified(field: string, nestedKey?: string): void;
    save(): void;
  };
  settingsManager.reload();

  const globalSettings = settingsManager.getGlobalSettings() as Record<string, unknown>;
  const extensionSettings = asObject(globalSettings[SETTINGS_KEY]) ?? {};

  internal.globalSettings[SETTINGS_KEY] = {
    ...extensionSettings,
    enabled,
  };

  internal.markModified(SETTINGS_KEY);
  internal.save();
  return settingsManager;
}

function reportSettingsErrors(
  settingsManager: SettingsManager,
  ctx: ExtensionContext,
  action: "load" | "write",
): void {
  if (!ctx.hasUI) return;
  for (const { scope, error } of settingsManager.drainErrors()) {
    ctx.ui.notify(`fast: failed to ${action} ${scope} settings: ${error.message}`, "warning");
  }
}

export default function fastExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let settingsWriteQueue: Promise<void> = Promise.resolve();

  function persistEnabled(nextEnabled: boolean, ctx: ExtensionContext): void {
    const cwd = ctx.cwd;
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(async () => {
        const settingsManager = persistState(nextEnabled, cwd);
        await settingsManager.flush();
        reportSettingsErrors(settingsManager, ctx, "write");
      });

    void settingsWriteQueue.catch((error) => {
      if (!ctx.hasUI) return;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`fast: failed to write settings: ${message}`, "warning");
    });
  }

  function setEnabled(
    nextEnabled: boolean,
    ctx: ExtensionContext,
    options?: { persist?: boolean },
  ): void {
    enabled = nextEnabled;
    if (options?.persist !== false) {
      persistEnabled(nextEnabled, ctx);
    }
    updateStatus(ctx, enabled);
  }

  async function reloadEnabledState(ctx: ExtensionContext): Promise<void> {
    await settingsWriteQueue.catch(() => undefined);
    enabled = false;

    try {
      const settingsManager = getSettingsManager(ctx.cwd);
      const persistedEnabled = loadPersistedState(ctx.cwd);
      reportSettingsErrors(settingsManager, ctx, "load");
      if (typeof persistedEnabled === "boolean") {
        enabled = persistedEnabled;
      }
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`fast: failed to load settings: ${message}`, "warning");
      }
    }

    updateStatus(ctx, enabled);
  }

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (service_tier=priority)",
    handler: async (_args, ctx) => {
      const nextEnabled = !enabled;
      setEnabled(nextEnabled, ctx);
      if (ctx.hasUI) {
        if (!nextEnabled) {
          ctx.ui.notify("Fast mode disabled.", "info");
          return;
        }

        if (isCodexSupportedProvider(ctx)) {
          ctx.ui.notify("Fast mode enabled. Requests will send service_tier=priority.", "info");
          return;
        }

        const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no active model";
        ctx.ui.notify(
          `Fast mode enabled. It will apply once you switch to an OpenAI or OpenAI Codex model (current: ${modelLabel}).`,
          "info",
        );
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await reloadEnabledState(ctx);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: any) => {
    await reloadEnabledState(ctx);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: any) => {
    await reloadEnabledState(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatus(ctx, enabled);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !isCodexSupportedProvider(ctx) || !isRecord(event.payload)) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(event.payload, "service_tier")) {
      return;
    }

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
