import { asBoolean, asRecord, asStringArray, readExtensionConfig } from "../config.js";

const DEFAULT_TASK = "check";

export type MiseTaskConfig = {
  enabled: boolean;
  name: string | null;
  task: string;
  trackedExtensions: string[];
  excludeGlobs: string[];
};

function normalizeTrackedExtension(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith(".") ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
}

export function asTrackedExtensions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const extension = normalizeTrackedExtension(item);
    if (extension) normalized.add(extension);
  }
  return [...normalized];
}

function asOptionalName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asTask(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_TASK;
}

function parseConfigEntry(value: unknown): MiseTaskConfig | null {
  const config = asRecord(value);
  if (!config) return null;

  return {
    enabled: asBoolean(config.enabled, true),
    name: asOptionalName(config.name),
    task: asTask(config.task),
    trackedExtensions: asTrackedExtensions(config.trackedExtensions),
    excludeGlobs: asStringArray(config.excludeGlobs),
  };
}

export function parseMiseTaskConfigs(value: unknown): MiseTaskConfig[] {
  const config = asRecord(value);
  if (!config) {
    return [
      { enabled: true, name: null, task: DEFAULT_TASK, trackedExtensions: [], excludeGlobs: [] },
    ];
  }

  if (Array.isArray(config.configs)) {
    const parentEnabled = asBoolean(config.enabled, true);
    return config.configs.flatMap((entry) => {
      const parsed = parseConfigEntry(entry);
      if (parsed && !parentEnabled) parsed.enabled = false;
      return parsed ? [parsed] : [];
    });
  }

  return [parseConfigEntry(config)].filter((entry): entry is MiseTaskConfig => !!entry);
}

export async function loadMiseTaskConfigs(cwd: string): Promise<MiseTaskConfig[]> {
  const extensions = await readExtensionConfig(cwd);
  return parseMiseTaskConfigs(extensions?.quietMiseTask);
}
