import { access } from "node:fs/promises";
import { homedir } from "node:os";
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
  const isHome = resolve(path) === resolve(homedir());
  return (
    (!isHome && (await pathExists(join(path, ".agents", "crumbs", "crumbs.json")))) ||
    (!isHome && (await pathExists(join(path, ".agents", "crumbs", "agents")))) ||
    (!isHome && (await pathExists(join(path, ".agents", "crumbs", "mcp.json")))) ||
    (await pathExists(join(path, ".pi", "crumbs.json"))) ||
    (!isHome && (await pathExists(join(path, ".pi", "crumbs", "agents")))) ||
    (await pathExists(join(path, ".pi", "mcp.json"))) ||
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
