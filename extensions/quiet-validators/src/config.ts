import { loadEffectiveCrumbsExtensionsConfig } from "../../shared/config/crumbs-loader.js";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function readExtensionConfig(cwd: string): Promise<Record<string, unknown> | null> {
  const extensions = await loadEffectiveCrumbsExtensionsConfig(cwd);
  return asRecord(extensions);
}

export function normalizePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

export function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      const next = glob[index + 1];
      if (next === "*") {
        pattern += ".*";
        index += 1;
        continue;
      }
      pattern += "[^/]*";
      continue;
    }

    if (char === "?") {
      pattern += "[^/]";
      continue;
    }

    pattern += escapeRegex(char);
  }

  pattern += "$";
  return new RegExp(pattern);
}

export function matchesAny(pathValue: string, globs: string[]): boolean {
  return globs.some((glob) => globToRegExp(normalizePath(glob)).test(pathValue));
}
