import { homedir } from "node:os";
import { join } from "node:path";
import { resolveProjectRoot } from "./project-root.js";

export function getGlobalCrumbsPath(): string {
  return getDefaultGlobalCrumbsPath();
}

export function getDefaultGlobalCrumbsPath(): string {
  return join(homedir(), ".agents", "crumbs", "crumbs.json");
}

export function getLegacyGlobalCrumbsPath(): string {
  return join(homedir(), ".pi", "agent", "crumbs.json");
}

export function getGlobalCrumbsReadPaths(): string[] {
  return [getLegacyGlobalCrumbsPath(), getDefaultGlobalCrumbsPath()];
}

export async function getProjectCrumbsPath(cwd: string): Promise<string> {
  const projectRoot = await resolveProjectRoot(cwd);
  return getDefaultProjectCrumbsPathForRoot(projectRoot);
}

export function getDefaultProjectCrumbsPathForRoot(projectRoot: string): string {
  return join(projectRoot, ".agents", "crumbs", "crumbs.json");
}

export function getLegacyProjectCrumbsPathForRoot(projectRoot: string): string {
  return join(projectRoot, ".pi", "crumbs.json");
}

export async function getProjectCrumbsReadPaths(cwd: string): Promise<string[]> {
  const projectRoot = await resolveProjectRoot(cwd);
  return [
    getLegacyProjectCrumbsPathForRoot(projectRoot),
    getDefaultProjectCrumbsPathForRoot(projectRoot),
  ];
}
