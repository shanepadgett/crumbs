import { asObject, type JsonObject } from "../io/json-file.js";

export function mergeLegacyWithDefault<T extends object>(legacy: T, defaultConfig: T): T {
  return (mergeNode(legacy, defaultConfig) as T) ?? ({} as T);
}

function mergeNode(legacyValue: unknown, defaultValue: unknown): unknown {
  const legacyObject = asObject(legacyValue);
  const defaultObject = asObject(defaultValue);
  if (legacyObject && defaultObject) {
    const merged: JsonObject = { ...legacyObject };
    for (const [key, value] of Object.entries(defaultObject)) {
      merged[key] = mergeNode(merged[key], value);
    }
    return merged;
  }

  return defaultValue === undefined ? legacyValue : defaultValue;
}
