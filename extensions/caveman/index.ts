/**
 * Caveman Extension
 *
 * What it does:
 * - Adds `/caveman` to toggle a caveman system prompt on/off.
 * - Replaces the full system prompt per turn when enabled.
 * - Supports two user modes: `minimal` and `self-improving`.
 *
 * How to use it:
 * - Persist defaults in crumbs config: `extensions.caveman` in `.pi/crumbs.json`.
 * - Run `/caveman on` for minimal caveman coding mode.
 * - Run `/caveman improve` for caveman mode with Pi-doc/self-improvement guidance.
 * - Run `/caveman off` to restore normal prompt behavior.
 *
 * Example:
 * - `/caveman improve`
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CRUMBS_EVENT_CAVEMAN_CHANGED } from "../shared/crumbs-events.js";
import {
  loadEffectiveExtensionConfig,
  loadProjectCrumbsConfig,
  updateGlobalCrumbsConfig,
} from "../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../shared/io/json-file.js";
import {
  buildCavemanSystemPrompt,
  normalizeCavemanMode,
  type CavemanMode,
} from "./src/system-prompt.js";

type CavemanState = {
  enabled: boolean;
  mode: CavemanMode;
};

const DEFAULT_STATE: CavemanState = { enabled: false, mode: "minimal" };

const require = createRequire(import.meta.url);

function parseState(section: JsonObject | null): CavemanState {
  if (!section) return { ...DEFAULT_STATE };

  const enabled = typeof section.enabled === "boolean" ? section.enabled : DEFAULT_STATE.enabled;
  const mode = normalizeCavemanMode(section.mode) ?? DEFAULT_STATE.mode;
  return { enabled, mode };
}

async function saveState(state: CavemanState): Promise<void> {
  await updateGlobalCrumbsConfig((current) => {
    const next = { ...current };
    const extensions = asObject(next.extensions) ?? {};
    const caveman = asObject(extensions.caveman) ?? {};

    extensions.caveman = {
      ...caveman,
      enabled: state.enabled,
      mode: state.mode,
    };

    next.extensions = extensions;
    return next;
  });
}

async function loadState(cwd: string): Promise<CavemanState> {
  const config = asObject(await loadEffectiveExtensionConfig(cwd, "caveman"));
  return parseState(config);
}

async function hasProjectOverride(cwd: string): Promise<boolean> {
  const project = await loadProjectCrumbsConfig(cwd);
  const extensions = asObject(project.extensions);
  const caveman = asObject(extensions?.caveman);
  return Boolean(caveman);
}

function getPiDocsPaths(): { root: string; readme: string; docs: string; examples: string } {
  try {
    const entryPath = (() => {
      if (typeof import.meta.resolve === "function") {
        return fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent"));
      }
      return require.resolve("@mariozechner/pi-coding-agent/dist/index.js");
    })();

    let root = dirname(entryPath);

    while (true) {
      if (existsSync(join(root, "package.json"))) break;
      const parent = dirname(root);
      if (parent === root) throw new Error("package root not found");
      root = parent;
    }

    return {
      root,
      readme: join(root, "README.md"),
      docs: join(root, "docs"),
      examples: join(root, "examples"),
    };
  } catch {
    return {
      root: ".",
      readme: "README.md",
      docs: "docs",
      examples: "examples",
    };
  }
}

function notifyMode(ctx: ExtensionContext, state: CavemanState): void {
  if (!ctx.hasUI) return;
  if (!state.enabled) {
    ctx.ui.notify("Caveman mode disabled.", "info");
    return;
  }
  const label = state.mode === "improve" ? "self-improving" : "minimal";
  ctx.ui.notify(`Caveman mode enabled (${label}).`, "info");
}

export default function cavemanExtension(pi: ExtensionAPI): void {
  const stateByCwd = new Map<string, CavemanState>();
  const loadedCwds = new Set<string>();

  async function getState(cwd: string): Promise<CavemanState> {
    if (!loadedCwds.has(cwd)) {
      loadedCwds.add(cwd);
      stateByCwd.set(cwd, await loadState(cwd));
    }

    const cached = stateByCwd.get(cwd);
    return cached ?? { ...DEFAULT_STATE };
  }

  async function setState(
    ctx: ExtensionContext,
    next: CavemanState,
    options?: { notify?: boolean },
  ): Promise<void> {
    loadedCwds.add(ctx.cwd);
    await saveState(next);
    const effective = await loadState(ctx.cwd);
    stateByCwd.set(ctx.cwd, effective);

    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: effective.enabled,
      mode: effective.mode,
    });

    if (options?.notify !== false) {
      notifyMode(ctx, effective);
      if ((effective.enabled !== next.enabled || effective.mode !== next.mode) && ctx.hasUI) {
        const projectOverride = await hasProjectOverride(ctx.cwd);
        if (projectOverride) {
          ctx.ui.notify(
            "Project crumbs override is active (.pi/crumbs.json -> extensions.caveman). Global toggle saved but local override still wins.",
            "warning",
          );
        }
      }
    }
  }

  function applyArg(current: CavemanState, rawArgs: string): CavemanState | "usage" {
    const trimmed = rawArgs.trim().toLowerCase();
    if (!trimmed) {
      return { ...current, enabled: !current.enabled };
    }

    if (trimmed === "off") {
      return { ...current, enabled: false };
    }

    if (trimmed === "on") {
      return { enabled: true, mode: "minimal" };
    }

    if (trimmed === "improve") {
      return { enabled: true, mode: "improve" };
    }

    return "usage";
  }

  pi.registerCommand("caveman", {
    description: "Toggle caveman mode: /caveman [on|off|improve]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim().toLowerCase();
      const options = ["off", "on", "improve"];
      const filtered = options.filter((item) => item.startsWith(value));
      return filtered.length > 0 ? filtered.map((item) => ({ value: item, label: item })) : null;
    },
    handler: async (args, ctx) => {
      const current = await getState(ctx.cwd);
      const result = applyArg(current, args);

      if (result === "usage") {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /caveman [on|off|improve]", "warning");
        }
        return;
      }

      await setState(ctx, result);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = await getState(ctx.cwd);
    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: state.enabled,
      mode: state.mode,
    });
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getState(ctx.cwd);
    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: state.enabled,
      mode: state.mode,
    });
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getState(ctx.cwd);
    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: state.enabled,
      mode: state.mode,
    });
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const state = await getState(ctx.cwd);
    if (!state.enabled) return undefined;

    const docs = getPiDocsPaths();
    const systemPrompt = buildCavemanSystemPrompt({
      cwd: ctx.cwd,
      date: new Date().toISOString().slice(0, 10),
      mode: state.mode,
      tools: pi.getActiveTools(),
      docs,
    });

    return { systemPrompt };
  });
}
