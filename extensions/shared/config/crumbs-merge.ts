import { asObject, type JsonObject } from "../io/json-file.js";

const UNION_ARRAY_PATHS = new Set([
  "extensions.quietMarkdownlint.excludeGlobs",
  "extensions.quietMiseTask.excludeGlobs",
  "extensions.quietMiseTask.trackedExtensions",
]);

function normalizeTrackedExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeArray(path: string, globalValue: unknown[], projectValue: unknown[]): unknown[] {
  const projectStrings = projectValue.filter((value): value is string => typeof value === "string");
  const globalStrings = globalValue.filter((value): value is string => typeof value === "string");

  if (UNION_ARRAY_PATHS.has(path)) {
    const combined = [...globalStrings, ...projectStrings];
    if (path === "extensions.quietMiseTask.trackedExtensions") {
      return uniqueStrings(combined.map(normalizeTrackedExtension).filter(Boolean));
    }
    return uniqueStrings(combined);
  }

  return projectValue;
}

function mergeNode(path: string, globalValue: unknown, projectValue: unknown): unknown {
  if (Array.isArray(globalValue) && Array.isArray(projectValue)) {
    return mergeArray(path, globalValue, projectValue);
  }

  const globalObject = asObject(globalValue);
  const projectObject = asObject(projectValue);
  if (globalObject && projectObject) {
    const merged: JsonObject = { ...globalObject };
    for (const key of Object.keys(projectObject)) {
      const nextPath = path ? `${path}.${key}` : key;
      merged[key] = mergeNode(nextPath, merged[key], projectObject[key]);
    }
    return merged;
  }

  return projectValue === undefined ? globalValue : projectValue;
}

export function mergeCrumbsConfigs(
  globalConfig: JsonObject,
  projectConfig: JsonObject,
): JsonObject {
  return (mergeNode("", globalConfig, projectConfig) as JsonObject) ?? {};
}
