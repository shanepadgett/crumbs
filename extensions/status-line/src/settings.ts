import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  CAVEMAN_NAME,
  normalizeCavemanEnhancements,
  type CavemanEnhancement,
} from "../../caveman/src/system-prompt.js";
import {
  loadEffectiveCrumbsExtensionsConfig,
  loadGlobalCrumbsConfig,
  loadProjectCrumbsConfig,
  updateGlobalCrumbsConfig,
} from "../../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../../shared/io/json-file.js";
import type { StatusFlags, StatusLinePrefs } from "./types.js";

const STATUS_LINE_EXTENSION_KEY = "statusLine";
const CODEX_COMPAT_EXTENSION_KEY = "codexCompat";
const CAVEMAN_EXTENSION_KEY = "caveman";

const DEFAULT_PREFS: StatusLinePrefs = { enabled: true };

function readEnabled(section: JsonObject | null): boolean {
  return typeof section?.enabled === "boolean" ? section.enabled : false;
}

function getBranchEntries(ctx: ExtensionContext) {
  const manager = ctx.sessionManager as ExtensionContext["sessionManager"] & {
    getBranch?: () => ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;
  };

  return typeof manager.getBranch === "function"
    ? manager.getBranch()
    : ctx.sessionManager.getEntries();
}

function normalizeLegacyCavemanMode(value: unknown): CavemanEnhancement[] {
  return value === "improve" ? ["improve"] : [];
}

function normalizeLegacyCavemanName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCavemanEnhancements(section: JsonObject | null): CavemanEnhancement[] {
  const enhancements = normalizeCavemanEnhancements(section?.powers ?? section?.enhancements);
  return enhancements.length > 0 ? enhancements : normalizeLegacyCavemanMode(section?.mode);
}

function hasExplicitPowers(section: JsonObject | null): boolean {
  if (!section) return false;
  return (
    Array.isArray(section.powers) ||
    Array.isArray(section.enhancements) ||
    section.mode === "improve"
  );
}

function loadBranchCavemanState(ctx: ExtensionContext): {
  name: string;
  hasSessionOverride: boolean;
  sessionEnhancements: CavemanEnhancement[];
} {
  let name = CAVEMAN_NAME;
  let hasSessionOverride = false;
  let sessionEnhancements: CavemanEnhancement[] = [];

  for (const entry of getBranchEntries(ctx)) {
    if (entry.type !== "custom") continue;

    if (entry.customType === "caveman-name") {
      const data = asObject(entry.data);
      name = normalizeLegacyCavemanName(data?.name) ?? name;
      continue;
    }

    if (entry.customType === "caveman-session-powers") {
      const data = asObject(entry.data);
      hasSessionOverride = true;
      sessionEnhancements = Array.isArray(data?.powers)
        ? normalizeCavemanEnhancements(data.powers)
        : [];
    }
  }

  return { name, hasSessionOverride, sessionEnhancements };
}

export async function loadStatusLinePrefs(cwd: string): Promise<StatusLinePrefs> {
  const extensions = await loadEffectiveCrumbsExtensionsConfig(cwd);
  const section = asObject(extensions[STATUS_LINE_EXTENSION_KEY]);

  return {
    enabled: typeof section?.enabled === "boolean" ? section.enabled : DEFAULT_PREFS.enabled,
  };
}

export async function saveStatusLinePrefs(_cwd: string, prefs: StatusLinePrefs): Promise<void> {
  await updateGlobalCrumbsConfig((current) => {
    const next = { ...current };
    const extensions = asObject(next.extensions) ?? {};
    const statusLine = asObject(extensions[STATUS_LINE_EXTENSION_KEY]) ?? {};

    extensions[STATUS_LINE_EXTENSION_KEY] = {
      ...statusLine,
      enabled: prefs.enabled,
    };

    next.extensions = extensions;
    return next;
  });
}

export async function loadStatusFlags(ctx: ExtensionContext): Promise<StatusFlags> {
  const extensions = await loadEffectiveCrumbsExtensionsConfig(ctx.cwd);
  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalCrumbsConfig(),
    loadProjectCrumbsConfig(ctx.cwd),
  ]);
  const codexCompatSection = asObject(extensions[CODEX_COMPAT_EXTENSION_KEY]);
  const cavemanSection = asObject(extensions[CAVEMAN_EXTENSION_KEY]);
  const globalCavemanSection = asObject(asObject(globalConfig.extensions)?.[CAVEMAN_EXTENSION_KEY]);
  const projectCavemanSection = asObject(
    asObject(projectConfig.extensions)?.[CAVEMAN_EXTENSION_KEY],
  );
  const branch = loadBranchCavemanState(ctx);
  const effectiveEnhancements = branch.hasSessionOverride
    ? branch.sessionEnhancements
    : readCavemanEnhancements(cavemanSection);

  return {
    fastEnabled: typeof codexCompatSection?.fast === "boolean" ? codexCompatSection.fast : false,
    cavemanName: branch.name,
    cavemanEnabled: readEnabled(cavemanSection),
    cavemanEnhancements: effectiveEnhancements,
    cavemanPowerSource: branch.hasSessionOverride
      ? "session"
      : hasExplicitPowers(projectCavemanSection)
        ? "project"
        : hasExplicitPowers(globalCavemanSection)
          ? "global"
          : "none",
    cavemanHasSessionOverride: branch.hasSessionOverride,
  };
}
