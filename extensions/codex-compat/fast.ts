import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CRUMBS_EVENT_FAST_CHANGED } from "../shared/crumbs-events.js";
import {
  loadEffectiveExtensionConfig,
  updateGlobalCrumbsConfig,
} from "../shared/config/crumbs-loader.js";
import { asObject } from "../shared/io/json-file.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadPersistedFastState(cwd: string): Promise<boolean | undefined> {
  const config = asObject(await loadEffectiveExtensionConfig(cwd, "codexCompat"));
  return typeof config?.fast === "boolean" ? config.fast : undefined;
}

async function persistFastState(enabled: boolean): Promise<void> {
  await updateGlobalCrumbsConfig((current) => {
    const next = { ...current };
    const extensions = asObject(next.extensions) ?? {};
    const codexCompat = asObject(extensions.codexCompat) ?? {};

    extensions.codexCompat = {
      ...codexCompat,
      fast: enabled,
    };

    next.extensions = extensions;
    return next;
  });
}

function isFastEligible(model: Pick<Model<any>, "provider" | "id"> | undefined): boolean {
  return model?.provider === "openai" || model?.provider === "openai-codex";
}

function updateFastStatus(ctx: ExtensionContext, enabled: boolean): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("fast", enabled && isFastEligible(ctx.model) ? "⚡" : undefined);
}

export default function codexCompatFastExtension(pi: ExtensionAPI) {
  let fastEnabled = false;
  let settingsWriteQueue: Promise<void> = Promise.resolve();

  function persistEnabled(nextEnabled: boolean, ctx: ExtensionContext): void {
    settingsWriteQueue = settingsWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await persistFastState(nextEnabled);
      });

    void settingsWriteQueue.catch((error) => {
      if (!ctx.hasUI) return;
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`fast: failed to write settings: ${message}`, "warning");
    });
  }

  function setFastEnabled(
    nextEnabled: boolean,
    ctx: ExtensionContext,
    options?: { persist?: boolean },
  ): void {
    fastEnabled = nextEnabled;
    if (options?.persist !== false) {
      persistEnabled(nextEnabled, ctx);
    }
    updateFastStatus(ctx, fastEnabled);
    pi.events.emit(CRUMBS_EVENT_FAST_CHANGED, { cwd: ctx.cwd, enabled: fastEnabled });
  }

  async function reloadFastEnabledState(ctx: ExtensionContext): Promise<void> {
    await settingsWriteQueue.catch(() => undefined);
    fastEnabled = false;

    try {
      const persistedEnabled = await loadPersistedFastState(ctx.cwd);
      if (typeof persistedEnabled === "boolean") {
        fastEnabled = persistedEnabled;
      }
    } catch (error) {
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`fast: failed to load settings: ${message}`, "warning");
      }
    }

    updateFastStatus(ctx, fastEnabled);
    pi.events.emit(CRUMBS_EVENT_FAST_CHANGED, { cwd: ctx.cwd, enabled: fastEnabled });
  }

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (service_tier=priority)",
    handler: async (_args, ctx) => {
      const nextEnabled = !fastEnabled;
      setFastEnabled(nextEnabled, ctx);
      if (!ctx.hasUI) return;
      if (!nextEnabled) {
        ctx.ui.notify("Fast mode disabled.", "info");
        return;
      }

      if (isFastEligible(ctx.model)) {
        ctx.ui.notify("Fast mode enabled. Requests will send service_tier=priority.", "info");
        return;
      }

      const modelLabel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no active model";
      ctx.ui.notify(
        `Fast mode enabled. It will apply once you switch to an OpenAI or OpenAI Codex model (current: ${modelLabel}).`,
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await reloadFastEnabledState(ctx);
    updateFastStatus(ctx, fastEnabled);
  });

  pi.on("model_select", async (_event, ctx) => {
    await reloadFastEnabledState(ctx);
    updateFastStatus(ctx, fastEnabled);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    await reloadFastEnabledState(ctx);
    updateFastStatus(ctx, fastEnabled);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    await reloadFastEnabledState(ctx);
    updateFastStatus(ctx, fastEnabled);
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!fastEnabled || !isFastEligible(ctx.model) || !isRecord(event.payload)) {
      return;
    }
    if (event.payload.service_tier) {
      return;
    }

    return {
      ...event.payload,
      service_tier: "priority",
    };
  });
}
