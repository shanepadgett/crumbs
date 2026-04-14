import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CAVEMAN_SETTINGS_KEY, FAST_SETTINGS_KEY, STATUS_TABLE_SETTINGS_KEY } from "./constants.js";
import type { SettingsObject, StatusFlags, StatusTableMode, StatusTablePrefs } from "./types.js";

const DEFAULT_PREFS: StatusTablePrefs = {
  enabled: true,
  mode: "full",
};

function asObject(value: unknown): SettingsObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as SettingsObject;
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function getGlobalSettingsPath(): string | undefined {
  const home = process.env.HOME;
  if (!home) return undefined;
  return join(home, ".pi", "agent", "settings.json");
}

function mergeSettings(base: SettingsObject, overrides: SettingsObject): SettingsObject {
  const merged: SettingsObject = { ...base };

  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseObject = asObject(merged[key]);
    const overrideObject = asObject(overrideValue);
    merged[key] =
      baseObject && overrideObject ? mergeSettings(baseObject, overrideObject) : overrideValue;
  }

  return merged;
}

function readSettingsFileSync(path: string | undefined): SettingsObject {
  if (!path) return {};

  try {
    const content = readFileSync(path, "utf8");
    return asObject(JSON.parse(content)) ?? {};
  } catch {
    return {};
  }
}

async function readProjectSettings(cwd: string): Promise<SettingsObject> {
  try {
    const content = await readFile(getProjectSettingsPath(cwd), "utf8");
    return asObject(JSON.parse(content)) ?? {};
  } catch {
    return {};
  }
}

async function readEffectiveSettings(cwd: string): Promise<SettingsObject> {
  return mergeSettings(
    readSettingsFileSync(getGlobalSettingsPath()),
    await readProjectSettings(cwd),
  );
}

function normalizeMode(value: unknown): StatusTableMode {
  return value === "minimal" ? "minimal" : "full";
}

function readEnabledSetting(settings: SettingsObject, key: string): boolean {
  const section = asObject(settings[key]);
  return typeof section?.["enabled"] === "boolean" ? (section["enabled"] as boolean) : false;
}

export async function loadStatusTablePrefs(cwd: string): Promise<StatusTablePrefs> {
  const settings = await readEffectiveSettings(cwd);
  const section = asObject(settings[STATUS_TABLE_SETTINGS_KEY]);

  return {
    enabled:
      typeof section?.["enabled"] === "boolean"
        ? (section["enabled"] as boolean)
        : DEFAULT_PREFS.enabled,
    mode: normalizeMode(section?.["mode"]),
  };
}

export async function loadStatusFlags(cwd: string): Promise<StatusFlags> {
  const settings = await readEffectiveSettings(cwd);

  return {
    fastEnabled: readEnabledSetting(settings, FAST_SETTINGS_KEY),
    cavemanEnabled: readEnabledSetting(settings, CAVEMAN_SETTINGS_KEY),
  };
}

export async function saveStatusTablePrefs(cwd: string, prefs: StatusTablePrefs): Promise<void> {
  const settingsPath = getProjectSettingsPath(cwd);
  const settingsDir = join(cwd, ".pi");
  const projectSettings = await readProjectSettings(cwd);

  projectSettings[STATUS_TABLE_SETTINGS_KEY] = {
    enabled: prefs.enabled,
    mode: prefs.mode,
  };

  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(projectSettings, null, 2)}\n`, "utf8");
}
