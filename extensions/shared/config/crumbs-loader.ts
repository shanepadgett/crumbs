import {
  getGlobalCrumbsPath,
  getGlobalCrumbsReadPaths,
  getProjectCrumbsPath,
  getProjectCrumbsReadPaths,
} from "./crumbs-paths.js";
import { mergeLegacyWithDefault } from "./legacy-default-merge.js";
import { mergeCrumbsConfigs } from "./crumbs-merge.js";
import { asObject, readJsonObject, type JsonObject, writeJsonObject } from "../io/json-file.js";
import { invalidateProjectRootCache, resolveProjectRoot } from "./project-root.js";

let globalCrumbsCache: JsonObject | undefined;
const projectCrumbsByRoot = new Map<string, JsonObject>();
const effectiveCrumbsByRoot = new Map<string, JsonObject>();

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

async function resolveProjectContext(cwd: string): Promise<{ root: string; path: string }> {
  const root = await resolveProjectRoot(cwd);
  return { root, path: await getProjectCrumbsPath(cwd) };
}

async function readMergedJsonObjects(paths: string[]): Promise<JsonObject> {
  const configs = await Promise.all(paths.map((path) => readJsonObject(path)));
  return configs.reduce<JsonObject>((merged, config) => mergeLegacyWithDefault(merged, config), {});
}

export async function loadGlobalCrumbsConfig(): Promise<JsonObject> {
  if (!globalCrumbsCache) {
    globalCrumbsCache = await readMergedJsonObjects(getGlobalCrumbsReadPaths());
  }
  return cloneJsonObject(globalCrumbsCache);
}

export async function loadProjectCrumbsConfig(cwd: string): Promise<JsonObject> {
  const { root } = await resolveProjectContext(cwd);
  let cached = projectCrumbsByRoot.get(root);
  if (!cached) {
    cached = await readMergedJsonObjects(await getProjectCrumbsReadPaths(cwd));
    projectCrumbsByRoot.set(root, cached);
  }
  return cloneJsonObject(cached);
}

export async function loadEffectiveCrumbsConfig(cwd: string): Promise<JsonObject> {
  const { root } = await resolveProjectContext(cwd);
  let cached = effectiveCrumbsByRoot.get(root);
  if (!cached) {
    const [globalConfig, projectConfig] = await Promise.all([
      loadGlobalCrumbsConfig(),
      loadProjectCrumbsConfig(cwd),
    ]);
    cached = mergeCrumbsConfigs(globalConfig, projectConfig);
    effectiveCrumbsByRoot.set(root, cached);
  }

  return cloneJsonObject(cached);
}

export async function loadEffectiveCrumbsExtensionsConfig(cwd: string): Promise<JsonObject> {
  const root = await loadEffectiveCrumbsConfig(cwd);
  return asObject(root.extensions) ?? {};
}

export async function loadEffectiveExtensionConfig(cwd: string, key: string): Promise<JsonObject> {
  const extensions = await loadEffectiveCrumbsExtensionsConfig(cwd);
  return asObject(extensions[key]) ?? {};
}

export async function updateGlobalCrumbsConfig(
  updater: (current: JsonObject) => JsonObject,
): Promise<void> {
  const path = getGlobalCrumbsPath();
  const current = await readJsonObject(path);
  await writeJsonObject(path, updater(current));
  invalidateGlobalCrumbsCache();
}

export async function updateProjectCrumbsConfig(
  cwd: string,
  updater: (current: JsonObject) => JsonObject,
): Promise<void> {
  const { path } = await resolveProjectContext(cwd);
  const current = await readJsonObject(path);
  await writeJsonObject(path, updater(current));
  await invalidateCrumbsCache(cwd);
}

export function invalidateGlobalCrumbsCache(): void {
  globalCrumbsCache = undefined;
  effectiveCrumbsByRoot.clear();
}

export async function invalidateCrumbsCache(cwd?: string): Promise<void> {
  if (!cwd) {
    globalCrumbsCache = undefined;
    projectCrumbsByRoot.clear();
    effectiveCrumbsByRoot.clear();
    invalidateProjectRootCache();
    return;
  }

  const root = await resolveProjectRoot(cwd);
  projectCrumbsByRoot.delete(root);
  effectiveCrumbsByRoot.delete(root);
  invalidateProjectRootCache(cwd);
}
