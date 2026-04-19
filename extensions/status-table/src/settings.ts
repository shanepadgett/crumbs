import {
  CAVEMAN_NAME,
  normalizeCavemanEnhancements,
  type CavemanEnhancement,
} from "../../caveman/src/system-prompt.js";
import {
  loadGlobalCrumbsConfig,
  loadProjectCrumbsConfig,
  loadEffectiveCrumbsExtensionsConfig,
  updateGlobalCrumbsConfig,
} from "../../shared/config/crumbs-loader.js";
import { asObject, type JsonObject } from "../../shared/io/json-file.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { StatusFlags, StatusTableMode, StatusTablePrefs } from "./types.js";

const DEFAULT_PREFS: StatusTablePrefs = {
  enabled: true,
  mode: "full",
};

const STATUS_TABLE_EXTENSION_KEY = "statusTable";
const CODEX_COMPAT_EXTENSION_KEY = "codexCompat";
const CAVEMAN_EXTENSION_KEY = "caveman";
const FOCUS_ADV_EXTENSION_KEY = "focusAdvanced";

function normalizeMode(value: unknown): StatusTableMode {
  return value === "minimal" ? "minimal" : "full";
}

function normalizeLegacyCavemanMode(value: unknown): CavemanEnhancement[] {
  return value === "improve" ? ["improve"] : [];
}

function normalizeFocusMode(value: unknown): "soft" | "hidden" | "hard" {
  if (value === "soft" || value === "hidden" || value === "hard") return value;
  return "hidden";
}

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

export async function loadStatusTablePrefs(cwd: string): Promise<StatusTablePrefs> {
  const extensions = await loadEffectiveCrumbsExtensionsConfig(cwd);
  const section = asObject(extensions[STATUS_TABLE_EXTENSION_KEY]);

  return {
    enabled: typeof section?.enabled === "boolean" ? section.enabled : DEFAULT_PREFS.enabled,
    mode: normalizeMode(section?.mode),
  };
}

export async function loadStatusFlags(ctx: ExtensionContext): Promise<StatusFlags> {
  const cwd = ctx.cwd;
  const extensions = await loadEffectiveCrumbsExtensionsConfig(cwd);
  const [globalConfig, projectConfig] = await Promise.all([
    loadGlobalCrumbsConfig(),
    loadProjectCrumbsConfig(cwd),
  ]);
  const codexCompatSection = asObject(extensions[CODEX_COMPAT_EXTENSION_KEY]);
  const cavemanSection = asObject(extensions[CAVEMAN_EXTENSION_KEY]);
  const focusSection = asObject(extensions[FOCUS_ADV_EXTENSION_KEY]);
  const globalCavemanSection = asObject(asObject(globalConfig.extensions)?.[CAVEMAN_EXTENSION_KEY]);
  const projectCavemanSection = asObject(
    asObject(projectConfig.extensions)?.[CAVEMAN_EXTENSION_KEY],
  );
  const branch = loadBranchCavemanState(ctx);
  const effectiveEnhancements = branch.hasSessionOverride
    ? branch.sessionEnhancements
    : readCavemanEnhancements(cavemanSection);
  const cavemanPowerSource = branch.hasSessionOverride
    ? "session"
    : hasExplicitPowers(projectCavemanSection)
      ? "project"
      : hasExplicitPowers(globalCavemanSection)
        ? "global"
        : "none";

  return {
    fastEnabled: typeof codexCompatSection?.fast === "boolean" ? codexCompatSection.fast : false,
    cavemanName: branch.name,
    cavemanEnabled: readEnabled(cavemanSection),
    cavemanEnhancements: effectiveEnhancements,
    cavemanPowerSource,
    cavemanHasSessionOverride: branch.hasSessionOverride,
    focusEnabled: readEnabled(focusSection),
    focusMode: normalizeFocusMode(focusSection?.mode),
  };
}

export async function saveStatusTablePrefs(_cwd: string, prefs: StatusTablePrefs): Promise<void> {
  await updateGlobalCrumbsConfig((current) => {
    const next = { ...current };
    const extensions = asObject(next.extensions) ?? {};
    const statusTable = asObject(extensions[STATUS_TABLE_EXTENSION_KEY]) ?? {};

    extensions[STATUS_TABLE_EXTENSION_KEY] = {
      ...statusTable,
      enabled: prefs.enabled,
      mode: prefs.mode,
    };

    next.extensions = extensions;
    return next;
  });
}
