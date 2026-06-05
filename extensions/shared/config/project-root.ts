import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const projectRootByCwd = new Map<string, string>();

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isProjectMarker(path: string): Promise<boolean> {
  return (
    (await pathExists(join(path, ".agents", "crumbs", "crumbs.json"))) ||
    (await pathExists(join(path, ".pi", "crumbs.json"))) ||
    (await pathExists(join(path, ".git")))
  );
}

export async function resolveProjectRoot(cwd: string): Promise<string> {
  const start = resolve(cwd);
  const cached = projectRootByCwd.get(start);
  if (cached) return cached;

  let current = start;

  while (true) {
    if (await isProjectMarker(current)) {
      projectRootByCwd.set(start, current);
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      projectRootByCwd.set(start, start);
      return start;
    }
    current = parent;
  }
}

export function invalidateProjectRootCache(cwd?: string): void {
  if (!cwd) {
    projectRootByCwd.clear();
    return;
  }

  projectRootByCwd.delete(resolve(cwd));
}
