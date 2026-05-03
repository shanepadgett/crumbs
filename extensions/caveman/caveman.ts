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
 * - Run `/caveman powers` to edit project or session powers.
 * - Run `/caveman off` to restore normal prompt behavior.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { CRUMBS_EVENT_CAVEMAN_CHANGED } from "../shared/crumbs-events.js";
import {
  loadEffectiveExtensionConfig,
  updateProjectCrumbsConfig,
} from "../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../shared/io/json-file.js";
import { MultiSelectList, type MultiSelectItem } from "../shared/ui/multi-select-list.js";
import {
  getAdditionalContextConfig,
  loadAdditionalContext,
  type AdditionalContextConfig,
} from "./src/additional-context.js";
import {
  buildCavemanSystemPrompt,
  CAVEMAN_NAME,
  normalizeCavemanEnhancement,
  normalizeCavemanEnhancements,
  pickRandomCavemanName,
  type CavemanEnhancement,
} from "./src/system-prompt.js";

type CavemanState = {
  enabled: boolean;
  enhancements: CavemanEnhancement[];
  additionalContext: AdditionalContextConfig;
};

type PowersScope = "project" | "session";
type PowerSource = "session" | "project" | "global" | "none";

const DEFAULT_STATE: CavemanState = {
  enabled: false,
  enhancements: [],
  additionalContext: { all: [], powers: {} },
};
const CAVEMAN_NAME_ENTRY = "caveman-name";
const CAVEMAN_SESSION_POWERS_ENTRY = "caveman-session-powers";
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
  {
    id: "architecture",
    label: "Architecture",
    description:
      "Push harder on ownership, boundaries, abstractions, and concrete design pressure.",
  },
  {
    id: "swiftui",
    label: "SwiftUI",
    description:
      "Use modern Swift and SwiftUI patterns with stronger state and view structure calls.",
  },
  {
    id: "typescript",
    label: "TypeScript",
    description: "Use stronger TypeScript boundary, union, and explicit type-shape judgment.",
  },
];

const require = createRequire(import.meta.url);

function parseState(section: JsonObject | null): CavemanState {
  if (!section) return { ...DEFAULT_STATE };

  const enabled = typeof section.enabled === "boolean" ? section.enabled : DEFAULT_STATE.enabled;
  const enhancements = normalizeCavemanEnhancements(section.powers ?? section.enhancements);
  const additionalContext = getAdditionalContextConfig(section);
  if (enhancements.length > 0) return { enabled, enhancements, additionalContext };

  if (section.mode === "improve") {
    return { enabled, enhancements: ["improve"], additionalContext };
  }

  return { enabled, enhancements: [], additionalContext };
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

function enhancementsEqual(a: CavemanEnhancement[], b: CavemanEnhancement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((enhancement, index) => enhancement === b[index]);
}

function parseEnhancements(values: string[]): CavemanEnhancement[] {
  return values
    .map((value) => normalizeCavemanEnhancement(value))
    .filter((value): value is CavemanEnhancement => Boolean(value));
}

function getBranchEntries(ctx: ExtensionContext) {
  const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & {
    getBranch?: () => ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;
  };

  return typeof manager.getBranch === "function"
    ? manager.getBranch()
    : ctx.sessionManager.getEntries();
}

function loadSessionEnhancements(ctx: ExtensionContext): {
  hasOverride: boolean;
  enhancements: CavemanEnhancement[];
} {
  let hasOverride = false;
  let enhancements: CavemanEnhancement[] = [];

  for (const entry of getBranchEntries(ctx)) {
    if (entry.type !== "custom" || entry.customType !== CAVEMAN_SESSION_POWERS_ENTRY) continue;
    hasOverride = true;
    const data = asObject(entry.data);
    enhancements = Array.isArray(data?.powers) ? normalizeCavemanEnhancements(data.powers) : [];
  }

  return { hasOverride, enhancements };
}

async function openScopePicker(
  ctx: ExtensionContext,
  cavemanName: string,
): Promise<PowersScope | null> {
  if (!ctx.hasUI) return null;

  const items: SelectItem[] = [
    {
      value: "project",
      label: "Project powers",
      description: "Save in .pi/crumbs.json",
    },
    {
      value: "session",
      label: "Session powers",
      description: "Current session only",
    },
  ];

  return ctx.ui.custom<PowersScope | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(`${cavemanName} powers`)), 1, 0));
    container.addChild(new Text(theme.fg("muted", "Choose scope first."), 1, 0));

    const list = new SelectList(items, items.length, {
      selectedPrefix: (text: string) => theme.fg("accent", text),
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });

    list.onSelect = (item) => done(item.value as PowersScope);
    list.onCancel = () => done(null);

    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • Enter select • Esc close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render(width: number): string[] {
        return container.render(width);
      },
      invalidate(): void {
        container.invalidate();
      },
      handleInput(data: string): void {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function openEnhancementPicker(
  ctx: ExtensionContext,
  scope: PowersScope,
  cavemanName: string,
  currentEnhancements: CavemanEnhancement[],
): Promise<CavemanEnhancement[] | null> {
  if (!ctx.hasUI) return null;

  let draft = [...currentEnhancements];

  return ctx.ui.custom<CavemanEnhancement[] | null>((tui, theme, _kb, done) => {
    const items: MultiSelectItem[] = ENHANCEMENTS.map((enhancement) => ({
      value: enhancement.id,
      label: enhancement.label,
      description: enhancement.description,
    }));

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(
      new Text(
        theme.fg(
          "accent",
          theme.bold(`${cavemanName} ${scope === "project" ? "project powers" : "session powers"}`),
        ),
        1,
        0,
      ),
    );
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          scope === "project"
            ? "Saved in .pi/crumbs.json"
            : "Saved for current session only. First time starts blank.",
        ),
        1,
        0,
      ),
    );

    const powersList = new MultiSelectList(items, Math.min(items.length + 2, 10), {
      selectedText: (text: string) => theme.fg("accent", text),
      description: (text: string) => theme.fg("muted", text),
      scrollInfo: (text: string) => theme.fg("dim", text),
      noMatch: (text: string) => theme.fg("warning", text),
    });
    powersList.setCheckedValues(draft);
    powersList.onToggle = (values) => {
      draft = parseEnhancements(values);
    };
    powersList.onConfirm = (values) => {
      done(parseEnhancements(values));
    };
    powersList.onCancel = () => done(null);

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
}

export default function cavemanExtension(pi: ExtensionAPI): void {
  const stateByCwd = new Map<string, CavemanState>();
  const nameBySession = new Map<string, string>();
  const loadedCwds = new Set<string>();
  const shownAdditionalContextWarnings = new Set<string>();

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

  function persistSessionEnhancements(enhancements: CavemanEnhancement[]): void {
    pi.appendEntry(CAVEMAN_SESSION_POWERS_ENTRY, { powers: [...enhancements] });
  }

  function emitCavemanChanged(
    ctx: ExtensionContext,
    state: CavemanState,
    powerSource?: PowerSource,
  ): void {
    const sessionState = loadSessionEnhancements(ctx);

    pi.events.emit(CRUMBS_EVENT_CAVEMAN_CHANGED, {
      cwd: ctx.cwd,
      enabled: state.enabled,
      enhancements: [...state.enhancements],
      name: getCavemanName(ctx),
      powerSource,
      hasSessionOverride: sessionState.hasOverride,
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

  async function getEffectiveState(ctx: ExtensionContext): Promise<CavemanState> {
    const projectState = await getState(ctx.cwd);
    const sessionState = loadSessionEnhancements(ctx);
    return {
      enabled: projectState.enabled,
      enhancements: sessionState.hasOverride
        ? sessionState.enhancements
        : projectState.enhancements,
      additionalContext: projectState.additionalContext,
    };
  }

  async function setState(
    ctx: ExtensionContext,
    next: CavemanState,
    options?: { notify?: boolean },
  ): Promise<void> {
    loadedCwds.add(ctx.cwd);
    await saveState(ctx.cwd, next);
    const projectState = await loadState(ctx.cwd);
    stateByCwd.set(ctx.cwd, projectState);
    const effectiveState = await getEffectiveState(ctx);

    emitCavemanChanged(ctx, effectiveState, "project");

    if (options?.notify !== false) {
      notifyMode(ctx, effectiveState, getCavemanName(ctx));
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
    description: "Toggle caveman mode or manage powers: /caveman [on|off|powers|minimal]",
    getArgumentCompletions(prefix) {
      const value = prefix.trim().toLowerCase();
      const options = ["off", "on", "powers", "minimal"];
      const filtered = options.filter((item) => item.startsWith(value));
      return filtered.length > 0 ? filtered.map((item) => ({ value: item, label: item })) : null;
    },
    handler: async (args, ctx) => {
      const current = await getState(ctx.cwd);
      const arg = args.trim().toLowerCase();

      if (arg === "minimal") {
        const sessionState = loadSessionEnhancements(ctx);
        if (sessionState.hasOverride && sessionState.enhancements.length === 0) return;

        assignCavemanName(ctx);
        persistSessionEnhancements([]);
        const effectiveState = await getEffectiveState(ctx);
        emitCavemanChanged(ctx, effectiveState, "session");
        notifyMode(ctx, effectiveState, getCavemanName(ctx));
        return;
      }

      if (arg === "powers") {
        if (!ctx.hasUI) return;

        const cavemanName = assignCavemanName(ctx);
        const scope = await openScopePicker(ctx, cavemanName);
        if (!scope) return;

        if (scope === "project") {
          const nextEnhancements = await openEnhancementPicker(
            ctx,
            scope,
            cavemanName,
            current.enhancements,
          );
          if (!nextEnhancements || enhancementsEqual(current.enhancements, nextEnhancements))
            return;
          await setState(ctx, { ...current, enhancements: nextEnhancements });
          return;
        }

        const sessionState = loadSessionEnhancements(ctx);
        const nextEnhancements = await openEnhancementPicker(
          ctx,
          scope,
          cavemanName,
          sessionState.hasOverride ? sessionState.enhancements : [],
        );
        if (!nextEnhancements) return;
        if (
          sessionState.hasOverride &&
          enhancementsEqual(sessionState.enhancements, nextEnhancements)
        ) {
          return;
        }

        persistSessionEnhancements(nextEnhancements);
        const effectiveState = await getEffectiveState(ctx);
        emitCavemanChanged(ctx, effectiveState, "session");
        notifyMode(ctx, effectiveState, getCavemanName(ctx));
        return;
      }

      const result = applyArg(current, args);

      if (result === "usage") {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /caveman [on|off|powers|minimal]", "warning");
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
    const state = await getEffectiveState(ctx);
    emitCavemanChanged(ctx, state);

    if (ctx.hasUI && !hadName) {
      ctx.ui.notify(`${name} join chat.`, "info");
    }

    return { action: "continue" as const };
  });

  pi.on("session_start", async (_event, ctx) => {
    const state = await getEffectiveState(ctx);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  (pi as any).on("session_switch", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getEffectiveState(ctx);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  (pi as any).on("session_tree", async (_event: unknown, ctx: ExtensionContext) => {
    const state = await getEffectiveState(ctx);
    assignCavemanName(ctx);
    emitCavemanChanged(ctx, state);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    const state = await getEffectiveState(ctx);
    if (!state.enabled) return undefined;

    const docs = getPiDocsPaths();
    const additionalContext = await loadAdditionalContext({
      cwd: ctx.cwd,
      config: state.additionalContext,
      enhancements: state.enhancements,
    });
    if (ctx.hasUI) {
      const sessionKey = getSessionKey(ctx);
      for (const warning of additionalContext.warnings) {
        const warningKey = `${sessionKey}::${warning}`;
        if (shownAdditionalContextWarnings.has(warningKey)) continue;
        shownAdditionalContextWarnings.add(warningKey);
        ctx.ui.notify(warning, "warning");
      }
    }

    const systemPrompt = buildCavemanSystemPrompt({
      name: assignCavemanName(ctx),
      cwd: ctx.cwd,
      date: new Date().toISOString().slice(0, 10),
      enhancements: state.enhancements,
      tools: pi.getActiveTools(),
      docs,
      additionalContext: additionalContext.context,
    });

    return { systemPrompt };
  });
}
