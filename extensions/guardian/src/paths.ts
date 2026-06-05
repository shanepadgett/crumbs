import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { CompiledPattern, MutationOperation, ResolvedTargetPath } from "./types.js";

function normalizePathArgument(path: string): string {
  return path.replace(/^@/, "").trim();
}

function normalizeForGlob(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  return normalized || ".";
}

function segmentToRegex(segment: string): string {
  let source = "";
  for (const char of segment) {
    source += char === "*" ? "[^/]*" : char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return source;
}

async function findExistingAncestor(path: string): Promise<string> {
  let current = resolve(path);

  while (true) {
    try {
      await access(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(`No existing ancestor found for ${path}`);
      current = parent;
    }
  }
}

async function canonicalizeCandidate(
  cwd: string,
  rawPath: string,
): Promise<{
  inputPath: string;
  absolutePath: string;
  canonicalPath: string;
}> {
  const inputPath = normalizePathArgument(rawPath);
  if (!inputPath) throw new Error("Path must not be empty.");

  const absolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(cwd, inputPath);

  try {
    return { inputPath, absolutePath, canonicalPath: await realpath(absolutePath) };
  } catch {
    const existingAncestor = await findExistingAncestor(dirname(absolutePath));
    const canonicalAncestor = await realpath(existingAncestor);
    const relativeTail = relative(existingAncestor, absolutePath);
    return {
      inputPath,
      absolutePath,
      canonicalPath: resolve(canonicalAncestor, relativeTail),
    };
  }
}

export function globToRegExp(glob: string): RegExp {
  const normalized = normalizeForGlob(glob.trim());
  const segments = normalized.split("/");
  let source = "^";
  let needsSlash = false;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment === "**") {
      if (segments.length === 1) {
        source += ".*";
        needsSlash = false;
      } else if (index === segments.length - 1) {
        source += needsSlash ? "(?:/.*)?" : ".*";
        needsSlash = false;
      } else if (needsSlash) {
        source += "(?:/[^/]+)*";
        needsSlash = true;
      } else {
        source += "(?:[^/]+/)*";
        needsSlash = false;
      }
      continue;
    }

    if (needsSlash) source += "/";
    source += segmentToRegex(segment);
    needsSlash = true;
  }

  return new RegExp(`${source}$`);
}

export function isInsideDirectory(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export function matchesProtectedPath(
  relativePath: string,
  rules: readonly CompiledPattern[],
): boolean {
  const normalized = normalizeForGlob(relativePath);
  return rules.some((rule) => rule.regex.test(normalized));
}

export async function resolveCanonicalWorkspace(cwd: string): Promise<string> {
  return realpath(resolve(cwd));
}

export async function resolveTargetPath(
  cwd: string,
  canonicalWorkspace: string,
  rawPath: string,
  protectedRules: readonly CompiledPattern[],
  options?: { operation?: MutationOperation; byteSize?: number },
): Promise<ResolvedTargetPath> {
  const resolved = await canonicalizeCandidate(cwd, rawPath);
  const insideWorkspace = isInsideDirectory(canonicalWorkspace, resolved.canonicalPath);
  const relativePath = insideWorkspace
    ? relative(canonicalWorkspace, resolved.canonicalPath)
    : relative(canonicalWorkspace, resolved.canonicalPath);
  const isProtected = insideWorkspace && matchesProtectedPath(relativePath || ".", protectedRules);

  return {
    raw: resolved.inputPath,
    absolute: resolved.absolutePath,
    canonical: resolved.canonicalPath,
    insideWorkspace,
    isProtected,
    operation: options?.operation,
    byteSize: options?.byteSize,
  };
}
