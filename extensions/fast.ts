/**
 * Fast Toggle Extension
 *
 * What this does:
 * - Adds `/fast` to toggle OpenAI Codex priority mode for provider requests.
 * - Shows a lightning-bolt status item while fast mode is active.
 *
 * How to use:
 * - Run `/fast` to enable or disable fast mode.
 * - Fast mode can only be enabled when the active model provider is `openai` or `openai-codex`.
 *
 * Example:
 * - Select an OpenAI Codex model.
 * - Run `/fast`.
 * - Status line shows `⚡` and requests include `service_tier: "priority"`.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "fast";
const STATE_ENTRY_TYPE = "crumbs.fast.state";

interface FastState {
  enabled: boolean;
}

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

function loadSessionState(ctx: ExtensionContext): boolean {
  const branch = ctx.sessionManager.getBranch();
  let nextEnabled = false;

  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    if (!entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) continue;
    if (typeof (entry.data as { enabled?: unknown }).enabled !== "boolean") continue;
    nextEnabled = (entry.data as FastState).enabled;
  }

  return nextEnabled;
}

export default function fastExtension(pi: ExtensionAPI): void {
  let enabled = false;

  function setEnabled(nextEnabled: boolean, ctx: ExtensionContext): void {
    enabled = nextEnabled;
    pi.appendEntry<FastState>(STATE_ENTRY_TYPE, { enabled: nextEnabled });
    updateStatus(ctx, enabled);
  }

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (service_tier=priority)",
    handler: async (_args, ctx) => {
      if (enabled) {
        setEnabled(false, ctx);
        if (ctx.hasUI) {
          ctx.ui.notify("Fast mode disabled.", "info");
        }
        return;
      }

      if (!isCodexSupportedProvider(ctx)) {
        if (ctx.hasUI) {
          const modelLabel = ctx.model
            ? `${ctx.model.provider}/${ctx.model.id}`
            : "no active model";
          ctx.ui.notify(
            `Fast mode requires OpenAI/OpenAI Codex model (current: ${modelLabel}).`,
            "warning",
          );
        }
        return;
      }

      setEnabled(true, ctx);
      if (ctx.hasUI) {
        ctx.ui.notify("Fast mode enabled. Requests will send service_tier=priority.", "info");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    enabled = loadSessionState(ctx);
    updateStatus(ctx, enabled);
  });

  pi.on("session_switch", async (_event, ctx) => {
    enabled = loadSessionState(ctx);
    updateStatus(ctx, enabled);
  });

  pi.on("session_tree", async (_event, ctx) => {
    enabled = loadSessionState(ctx);
    updateStatus(ctx, enabled);
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
