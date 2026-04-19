/**
 * Caveman Extension
 *
 * What it does:
 * - Adds `/caveman` to toggle a caveman system prompt on/off.
 * - Replaces the full system prompt per turn when enabled.
 * - Adds optional powers that layer extra guidance onto base caveman behavior.
 *
 * How to use it:
 * - Persist defaults in crumbs config: `extensions.caveman` in `.pi/crumbs.json`.
 * - Run `/caveman on` to enable caveman mode.
 * - Run `/caveman powers` to toggle optional powers.
 * - Run `/caveman off` to restore normal prompt behavior.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { CRUMBS_EVENT_CAVEMAN_CHANGED } from "../shared/crumbs-events.js";
import {
  loadEffectiveExtensionConfig,
  updateProjectCrumbsConfig,
} from "../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../shared/io/json-file.js";
import { MultiSelectList, type MultiSelectItem } from "../shared/ui/multi-select-list.js";
import {
  buildCavemanSystemPrompt,
  CAVEMAN_NAME,
  normalizeCavemanEnhancements,
  pickRandomCavemanName,
  type CavemanEnhancement,
} from "./src/system-prompt.js";

type CavemanState = {
  enabled: boolean;
  enhancements: CavemanEnhancement[];
};

const DEFAULT_STATE: CavemanState = { enabled: false, enhancements: [] };
const CAVEMAN_NAME_ENTRY = "caveman-name";
const ENHANCEMENTS: Array<{
  id: CavemanEnhancement;
  label: string;
  description: string;
}> = [
  {
    id: "improve",
    label: "Improve",
    description: "Read Pi docs first and help modify Pi cleanly when asked.",
  },
  {
    id: "design",
    label: "Design",
    description: "Push harder on UX, naming, flows, and smallest viable interface shape.",
  },
];

const require = createRequire(import.meta.url);

function parseState(section: JsonObject | null): CavemanState {
  if (!section) return { ...DEFAULT_STATE };

  const enabled = typeof section.enabled === "boolean" ? section.enabled : DEFAULT_STATE.enabled;
  const enhancements = normalizeCavemanEnhancements(section.powers ?? section.enhancements);
  if (enhancements.length > 0) return { enabled, enhancements };

  if (section.mode === "improve") {
    return { enabled, enhancements: ["improve"] };
  }

  return { enabled, enhancements: [] };
}

async function saveState(cwd: string, state: CavemanState): Promise<void> {
  await updateProjectCrumbsConfig(cwd, (current) => {
    const next = { ...current };
    const extensions = asObject(next.extensions) ?? {};
    const caveman = { ...asObject(extensions.caveman) };

    delete caveman.mode;
    delete caveman.enhancements;

    extensions.caveman = {
      ...caveman,
      enabled: state.enabled,
      powers: [...state.enhancements],
    };

    next.extensions = extensions;
    return next;
  });
}

async function loadState(cwd: string): Promise<CavemanState> {
  const config = asObject(await loadEffectiveExtensionConfig(cwd, "caveman"));
  return parseState(config);
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

function notifyMode(ctx: ExtensionContext, state: CavemanState, name: string): void {
  if (!ctx.hasUI) return;
  if (!state.enabled) {
    ctx.ui.notify(`${name} sleep.`, "info");
    return;
  }

  if (state.enhancements.length === 0) {
    ctx.ui.notify(`${name} awake. Base powers only.`, "info");
    return;
  }

  ctx.ui.notify(`${name} awake. Powers: ${state.enhancements.join(", ")}.`, "info");
}

function stateEquals(a: CavemanState, b: CavemanState): boolean {
  if (a.enabled !== b.enabled) return false;
  if (a.enhancements.length !== b.enhancements.length) return false;
  return a.enhancements.every((enhancement, index) => enhancement === b.enhancements[index]);
}

async function openEnhancementPicker(
  ctx: ExtensionContext,
  current: CavemanState,
): Promise<CavemanState> {
  if (!ctx.hasUI) return current;

  let draft: CavemanState = {
    enabled: current.enabled,
    enhancements: [...current.enhancements],
  };

  await ctx.ui.custom((tui, theme, _kb, done) => {
    const items: MultiSelectItem[] = ENHANCEMENTS.map((enhancement) => ({
      value: enhancement.id,
      label: enhancement.label,
      description: enhancement.description,
    }));

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(`${CAVEMAN_NAME} powers`)), 1, 0));
    container.addChild(
      new Text(theme.fg("muted", "Toggle extra brain clubs. Base caveman stays same."), 1, 0),
    );

    const powersList = new MultiSelectList(items, Math.min(items.length + 2, 10), {
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });
    powersList.setCheckedValues(draft.enhancements);
    powersList.onToggle = (values) => {
      draft = {
        ...draft,
        enhancements: values.filter(
          (value): value is CavemanEnhancement => value === "improve" || value === "design",
        ),
      };
    };
    powersList.onConfirm = (values) => {
      draft = {
        ...draft,
        enhancements: values.filter(
          (value): value is CavemanEnhancement => value === "improve" || value === "design",
        ),
      };
      done(undefined);
    };
    powersList.onCancel = () => done(undefined);

    container.addChild(powersList);
    container.addChild(new Text(theme.fg("dim", "Space toggle • Enter accept • Esc close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render(width: number): string[] {
        return container.render(width);
      },
      invalidate(): void {
        container.invalidate();
      },
      handleInput(data: string): void {
        powersList.handleInput?.(data);
        tui.requestRender();
      },
    };
  });

  return draft;
}

export default function cavemanExtension(pi: ExtensionAPI): void {
  const stateByCwd = new Map<string, CavemanState>();
  const nameBySession = new Map<string, string>();
  const loadedCwds = new Set<string>();

  function getSessionKey(ctx: ExtensionContext): string {
    return `${ctx.cwd}::${ctx.sessionManager.getSessionFile() ?? "ephemeral"}`;
  }

  function getCavemanName(ctx: ExtensionContext): string {
    return nameBySession.get(getSessionKey(ctx)) ?? CAVEMAN_NAME;
  }

  function restoreCavemanName(ctx: ExtensionContext): string | undefined {
    const sessionKey = getSessionKey(ctx);
    const cached = nameBySession.get(sessionKey);
    if (cached) return cached;

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== CAVEMAN_NAME_ENTRY) continue;
      const data = asObject(entry.data);
      const name = typeof data?.name === "string" ? data.name : undefined;
      if (!name) continue;
      nameBySession.set(sessionKey, name);
    }

    return nameBySession.get(sessionKey);
  }

  function assignCavemanName(ctx: ExtensionContext): string {
    const sessionKey = getSessionKey(ctx);
    const existing = restoreCavemanName(ctx);
    if (existing) return existing;

    const name = pickRandomCavemanName();
    nameBySession.set(sessionKey, name);
    pi.appendEntry(CAVEMAN_NAME_ENTRY, { name });
    return name;
  }

  function emitCavemanChanged(ctx: ExtensionContext, state: CavemanState): void {
    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: state.enabled,
      enhancements: [...state.enhancements],
      name: getCavemanName(ctx),
    });
  }

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
    await saveState(ctx.cwd, next);
    const effective = await loadState(ctx.cwd);
    stateByCwd.set(ctx.cwd, effective);

    emitCavemanChanged(ctx, effective);

    if (options?.notify !== false) {
      notifyMode(ctx, effective, getCavemanName(ctx));
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
      return { ...current, enabled: true };
    }

    return "usage";
  }

  pi.registerCommand("caveman", {
    description: "Toggle caveman mode or open powers: /caveman [on|off|powers]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim().toLowerCase();
      const options = ["off", "on", "powers"];
      const filtered = options.filter((item) => item.startsWith(value));
      return filtered.length > 0 ? filtered.map((item) => ({ value: item, label: item })) : null;
    },
    handler: async (args, ctx) => {
      const current = await getState(ctx.cwd);
      if (args.trim().toLowerCase() === "powers") {
        if (!ctx.hasUI) {
          return;
        }
        const next = await openEnhancementPicker(ctx, current);
        if (stateEquals(current, next)) return;
        await setState(ctx, next);
        return;
      }

      const result = applyArg(current, args);

      if (result === "usage") {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /caveman [on|off|powers]", "warning");
        }
        return;
      }

      await setState(ctx, result);
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" as const };

    const hadName = Boolean(restoreCavemanName(ctx));
    const name = assignCavemanName(ctx);
    const state = await getState(ctx.cwd);
    emitCavemanChanged(ctx, state);

    if (ctx.hasUI && !hadName) {
      ctx.ui.notify(`${name} join chat.`, "info");
    }

    return { action: "continue" as const };
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = await getState(ctx.cwd);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getState(ctx.cwd);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getState(ctx.cwd);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const state = await getState(ctx.cwd);
    if (!state.enabled) return undefined;

    const docs = getPiDocsPaths();
    const systemPrompt = buildCavemanSystemPrompt({
      name: assignCavemanName(ctx),
      cwd: ctx.cwd,
      date: new Date().toISOString().slice(0, 10),
      enhancements: state.enhancements,
      tools: pi.getActiveTools(),
      docs,
    });

    return { systemPrompt };
  });
}
