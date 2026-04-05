import { access, lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function normalizePathArgument(path: string): string {
  return path.replace(/^@/, "").trim();
}

function isInsideDirectory(targetPath: string, rootPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function canonicalizeExisting(path: string): Promise<string> {
  return realpath(path);
}

async function findExistingAncestor(path: string): Promise<string> {
  let current = resolve(path);

  while (true) {
    try {
      await access(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`No existing ancestor found for ${path}`);
      }
      current = parent;
    }
  }
}

async function resolveCanonicalCandidate(
  cwd: string,
  rawPath: string,
): Promise<{
  inputPath: string;
  absolutePath: string;
  canonicalPath: string;
  allowedRoot: string;
}> {
  const inputPath = normalizePathArgument(rawPath);
  if (!inputPath) throw new Error("Path must not be empty.");

  const absolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(cwd, inputPath);
  const allowedRoot = await realpath(cwd).catch(() => resolve(cwd));

  try {
    const canonicalPath = await canonicalizeExisting(absolutePath);
    return { inputPath, absolutePath, canonicalPath, allowedRoot };
  } catch {
    const existingAncestor = await findExistingAncestor(dirname(absolutePath));
    const canonicalAncestor = await realpath(existingAncestor);
    const relativeTail = relative(existingAncestor, absolutePath);
    const canonicalPath = resolve(canonicalAncestor, relativeTail);
    return { inputPath, absolutePath, canonicalPath, allowedRoot };
  }
}

export interface ResolvedPath {
  inputPath: string;
  absolutePath: string;
  canonicalPath: string;
  allowedRoot: string;
}

export async function resolveMutationPath(cwd: string, rawPath: string): Promise<ResolvedPath> {
  const resolved = await resolveCanonicalCandidate(cwd, rawPath);
  if (!isInsideDirectory(resolved.canonicalPath, resolved.allowedRoot)) {
    throw new Error(`Path escapes the allowed root: ${rawPath}`);
  }
  return resolved;
}

export async function resolveExistingPath(
  cwd: string,
  rawPath: string,
  kind: "file" | "directory",
): Promise<ResolvedPath> {
  const inputPath = normalizePathArgument(rawPath);
  if (!inputPath) throw new Error("Path must not be empty.");

  const absolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(cwd, inputPath);
  const canonicalPath = await canonicalizeExisting(absolutePath).catch(() => {
    throw new Error(`Path does not exist: ${rawPath}`);
  });
  const allowedRoot = await realpath(cwd).catch(() => resolve(cwd));

  if (!isInsideDirectory(canonicalPath, allowedRoot)) {
    throw new Error(`Path escapes the allowed root: ${rawPath}`);
  }

  const info = await stat(canonicalPath);
  if (kind === "file" && !info.isFile()) {
    throw new Error(`Expected a file: ${rawPath}`);
  }
  if (kind === "directory" && !info.isDirectory()) {
    throw new Error(`Expected a directory: ${rawPath}`);
  }

  return { inputPath, absolutePath, canonicalPath, allowedRoot };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}
