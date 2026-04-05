import { realpath, stat } from "node:fs/promises";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";
import { resolveConfiguredPath } from "./config.js";
import type { PermissionsConfig } from "./types.js";

async function canonicalize(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function insideDirectory(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function compileMatcher(
  cwd: string,
  pattern: string,
): Promise<(path: string) => Promise<boolean>> {
  const absolutePattern = resolveConfiguredPath(cwd, pattern);
  const hasGlob = /[*?[\]{}]/.test(pattern);

  if (hasGlob) {
    return async (path) => matchesGlob(path, absolutePattern);
  }

  const canonicalPattern = await canonicalize(absolutePattern);
  const explicitDirectory = pattern.endsWith("/");

  if (explicitDirectory) {
    return async (path) =>
      insideDirectory(path, absolutePattern) || insideDirectory(path, canonicalPattern);
  }

  try {
    const info = await stat(canonicalPattern);
    if (info.isDirectory()) {
      return async (path) =>
        insideDirectory(path, absolutePattern) || insideDirectory(path, canonicalPattern);
    }
  } catch {
    // fall through
  }

  return async (path) => path === absolutePattern || path === canonicalPattern;
}

async function matchesAny(cwd: string, path: string, patterns: string[]): Promise<string | null> {
  const absolute = resolve(cwd, path.replace(/^@/, ""));
  const canonical = await canonicalize(absolute);

  for (const pattern of patterns) {
    const matcher = await compileMatcher(cwd, pattern);
    if ((await matcher(absolute)) || (await matcher(canonical))) return pattern;
  }

  return null;
}

export async function evaluateReadPath(
  cwd: string,
  path: string,
  config: PermissionsConfig,
): Promise<string | null> {
  return matchesAny(cwd, path, config.blockedPaths);
}

export async function evaluateMutationPath(
  cwd: string,
  path: string,
  config: PermissionsConfig,
): Promise<{ type: "blocked" | "protected" | "outside-workspace"; match: string } | null> {
  const mode = config.activeMode;

  const blocked = await matchesAny(cwd, path, config.blockedPaths);
  if (blocked) return { type: "blocked", match: blocked };

  const protectedMatch = await matchesAny(cwd, path, config.protectedMutationPaths);
  if (protectedMatch) return { type: "protected", match: protectedMatch };

  if (mode.directMutationPolicy === "none") {
    return { type: "blocked", match: mode.key };
  }

  if (mode.directMutationPolicy === "any") {
    return null;
  }

  const absolute = resolve(cwd, path.replace(/^@/, ""));

  if (mode.directMutationPolicy === "workspace") {
    if (!insideDirectory(absolute, cwd)) {
      return { type: "outside-workspace", match: cwd };
    }
    return null;
  }

  const allowed = await matchesAny(cwd, path, mode.directMutationPaths);
  if (allowed) return null;

  return { type: "blocked", match: mode.key };
}
