import { promises as fs } from "node:fs";
import { extname, join, relative } from "node:path";
import { matchesAny, normalizePath } from "../config.js";
import type { Snapshot } from "../core/types.js";
import type { MiseTaskConfig } from "./config.js";

const IGNORED_DIRECTORIES = new Set([
  ".build",
  ".git",
  ".pi",
  ".swiftpm",
  "DerivedData",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "tmp",
]);

export function shouldSkipDirectory(relativePath: string, config: MiseTaskConfig): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (normalizedPath.length === 0) return false;
  return matchesAny(`${normalizedPath}/__pi_probe__`, config.excludeGlobs);
}

export function shouldTrackPath(relativePath: string, config: MiseTaskConfig): boolean {
  const normalizedPath = normalizePath(relativePath);
  if (matchesAny(normalizedPath, config.excludeGlobs)) return false;
  if (config.trackedExtensions.length === 0) return false;
  return config.trackedExtensions.includes(extname(normalizedPath).toLowerCase());
}

export async function scanMiseInputs(root: string, config: MiseTaskConfig): Promise<Snapshot> {
  const snapshot: Snapshot = new Map();

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        const directoryKey = normalizePath(relative(root, join(currentPath, entry.name)));
        if (shouldSkipDirectory(directoryKey, config)) continue;
        await walk(join(currentPath, entry.name));
        continue;
      }

      if (!entry.isFile()) continue;

      const fullPath = join(currentPath, entry.name);
      const fileKey = normalizePath(relative(root, fullPath));
      if (!shouldTrackPath(fileKey, config)) continue;

      const stats = await fs.stat(fullPath);
      snapshot.set(fileKey, `${stats.size}:${stats.mtimeMs}`);
    }
  }

  await walk(root);
  return snapshot;
}
