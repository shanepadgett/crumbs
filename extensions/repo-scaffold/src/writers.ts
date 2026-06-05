import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { updateProjectCrumbsConfig } from "../../shared/config/crumbs-loader.js";
import {
  asObject,
  readJsonObject,
  type JsonObject,
  writeJsonObject,
} from "../../shared/io/json-file.js";
import { STANDARD_MISE_TASK_DIR, taskConfigIncludesStandardDir } from "./mise-tasks.js";
import type { MiseToolValue, ScaffoldFile, ScaffoldPlan } from "./types.js";

type WritePlanOptions = {
  overwriteFiles: boolean;
  overwriteTaskFiles: boolean;
  overwritePackageDevDependencies: boolean;
  overwriteMiseTools: boolean;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function quoteTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function renderTomlValue(value: MiseToolValue): string {
  if (typeof value === "string") return JSON.stringify(value);
  const entries = Object.entries(value).map(
    ([key, item]) => `${quoteTomlKey(key)} = ${JSON.stringify(item)}`,
  );
  return `{ ${entries.join(", ")} }`;
}

function mergeTaskConfigIncludes(lines: string[]): string[] {
  const output: string[] = [];
  let inTaskConfig = false;
  let collectingIncludes = false;
  let updated = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)?.[1];
    if (section) inTaskConfig = section === "task_config";

    if (inTaskConfig) {
      const inline = line.match(/^(\s*includes\s*=\s*\[)(.*)(]\s*)$/);
      if (inline && !line.includes(`"${STANDARD_MISE_TASK_DIR}"`)) {
        const separator = inline[2].trim().length > 0 ? ", " : "";
        output.push(
          `${inline[1]}${inline[2]}${separator}${JSON.stringify(STANDARD_MISE_TASK_DIR)}${inline[3]}`,
        );
        updated = true;
        continue;
      }

      if (/^\s*includes\s*=\s*\[\s*$/.test(line)) collectingIncludes = true;
      if (collectingIncludes && /^\s*]/.test(line) && !updated) {
        output.push(`  ${JSON.stringify(STANDARD_MISE_TASK_DIR)},`);
        updated = true;
      }
    }

    output.push(line);
    if (collectingIncludes && /^\s*]/.test(line)) collectingIncludes = false;
  }

  return output;
}

function normalizeWriteOptions(options: boolean | Partial<WritePlanOptions>): WritePlanOptions {
  if (typeof options === "boolean") {
    return {
      overwriteFiles: options,
      overwriteTaskFiles: options,
      overwritePackageDevDependencies: options,
      overwriteMiseTools: options,
    };
  }
  return {
    overwriteFiles: options.overwriteFiles ?? false,
    overwriteTaskFiles: options.overwriteTaskFiles ?? false,
    overwritePackageDevDependencies: options.overwritePackageDevDependencies ?? false,
    overwriteMiseTools: options.overwriteMiseTools ?? false,
  };
}

async function mergeMiseToml(
  cwd: string,
  tools: Record<string, MiseToolValue>,
  needsStandardTaskDir: boolean,
  overwriteMiseTools: boolean,
  removeTomlTaskNames: Set<string>,
): Promise<string> {
  const path = join(cwd, "mise.toml");
  const existing = (await fileExists(path)) ? await readFile(path, "utf8") : "";
  const lines = existing.trimEnd().length > 0 ? existing.trimEnd().split(/\r?\n/) : [];
  const inputLines =
    needsStandardTaskDir && !taskConfigIncludesStandardDir(existing)
      ? mergeTaskConfigIncludes(lines)
      : lines;
  const taskCleanedLines =
    removeTomlTaskNames.size > 0
      ? removeTomlTaskBlocks(inputLines, removeTomlTaskNames)
      : inputLines;
  const output: string[] = [];
  let inTools = false;
  let sawTools = false;
  const remaining = { ...tools };

  function appendRemainingTools(): void {
    for (const [key, version] of Object.entries(remaining)) {
      output.push(`${quoteTomlKey(key)} = ${renderTomlValue(version)}`);
      delete remaining[key];
    }
  }

  for (const line of taskCleanedLines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)?.[1];
    if (section) {
      if (inTools) appendRemainingTools();
      inTools = section === "tools";
      if (inTools) sawTools = true;
    }
    if (inTools) {
      const key = line.match(/^\s*("[^"]+"|[A-Za-z0-9_:-]+)\s*=/)?.[1]?.replace(/^"|"$/g, "");
      if (key && remaining[key]) {
        output.push(
          overwriteMiseTools ? `${quoteTomlKey(key)} = ${renderTomlValue(remaining[key])}` : line,
        );
        delete remaining[key];
        continue;
      }
    }
    output.push(line);
  }

  if (inTools) appendRemainingTools();

  const entries = Object.entries(remaining);
  if (entries.length > 0) {
    if (!sawTools) {
      if (output.length > 0) output.push("");
      output.push("[tools]");
    }
    for (const [key, version] of entries)
      output.push(`${quoteTomlKey(key)} = ${renderTomlValue(version)}`);
  }

  await writeFile(path, `${output.join("\n")}\n`, "utf8");
  return "mise.toml";
}

function parseTomlTaskSectionName(section: string): string | null {
  const quoted = section.match(/^tasks\."(.+)"$/)?.[1];
  if (quoted) return quoted;
  const bare = section.match(/^tasks\.([A-Za-z0-9_-]+)$/)?.[1];
  return bare ?? null;
}

function removeTomlTaskBlocks(lines: string[], taskNames: Set<string>): string[] {
  const output: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/)?.[1];
    if (section) {
      const taskName = parseTomlTaskSectionName(section);
      skipping = !!taskName && taskNames.has(taskName);
    }
    if (!skipping) output.push(line);
  }

  return output;
}

async function mergePackageJson(
  cwd: string,
  devDependencies: Record<string, string>,
  overwrite: boolean,
): Promise<string | null> {
  if (Object.keys(devDependencies).length === 0) return null;
  const path = join(cwd, "package.json");
  const current = await readJsonObject(path);
  const next: JsonObject = { ...current };
  const existingDevDependencies = asObject(next.devDependencies) ?? {};
  const mergedDevDependencies = { ...existingDevDependencies };
  for (const [name, version] of Object.entries(devDependencies)) {
    if (!overwrite && typeof mergedDevDependencies[name] === "string") continue;
    mergedDevDependencies[name] = version;
  }
  next.devDependencies = mergedDevDependencies;
  if (!next.private && !next.name) next.private = true;
  await writeJsonObject(path, next);
  return "package.json";
}

async function writeScaffoldFile(
  cwd: string,
  file: ScaffoldFile,
  overwriteFiles: boolean,
  overwriteTaskFiles: boolean,
): Promise<string | null> {
  const path = join(cwd, file.path);
  const overwrite =
    overwriteFiles || (overwriteTaskFiles && file.path.startsWith(`${STANDARD_MISE_TASK_DIR}/`));
  if (!overwrite && (await fileExists(path))) return null;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.content, "utf8");
  if (file.executable) await chmod(path, 0o755);
  return file.path;
}

async function mergeQuietValidators(cwd: string, plan: ScaffoldPlan): Promise<string | null> {
  if (plan.quietValidators.length === 0) return null;
  await updateProjectCrumbsConfig(cwd, (current) => {
    const extensions = asObject(current.extensions) ?? {};
    const quietMiseTask = asObject(extensions.quietMiseTask) ?? {};
    const existingConfigs = Array.isArray(quietMiseTask.configs)
      ? quietMiseTask.configs.filter(
          (item) => !!item && typeof item === "object" && !Array.isArray(item),
        )
      : [];
    const byName = new Map<string, Record<string, unknown>>();
    for (const entry of existingConfigs) {
      const config = entry as Record<string, unknown>;
      const name =
        typeof config.name === "string"
          ? config.name
          : typeof config.task === "string"
            ? config.task
            : JSON.stringify(config);
      byName.set(name, config);
    }
    for (const config of plan.quietValidators)
      byName.set(config.name, {
        enabled: config.enabled ?? true,
        excludeGlobs: config.excludeGlobs ?? [],
        ...config,
      });
    return {
      ...current,
      extensions: {
        ...extensions,
        quietMiseTask: { ...quietMiseTask, configs: [...byName.values()] },
      },
    };
  });
  return ".agents/crumbs/crumbs.json";
}

export async function writePlan(
  cwd: string,
  plan: ScaffoldPlan,
  options: boolean | Partial<WritePlanOptions>,
): Promise<string[]> {
  const writeOptions = normalizeWriteOptions(options);
  const touched: string[] = [];
  const needsStandardTaskDir = plan.files.some((file) =>
    file.path.startsWith(`${STANDARD_MISE_TASK_DIR}/`),
  );
  const generatedTaskNames = new Set(
    plan.files
      .filter((file) => file.path.startsWith(`${STANDARD_MISE_TASK_DIR}/`))
      .map((file) => file.path.slice(`${STANDARD_MISE_TASK_DIR}/`.length))
      .filter((name) => name.length > 0 && !name.startsWith("lib/"))
      .map((name) => name.replaceAll("/", ":")),
  );
  if (Object.keys(plan.miseTools).length > 0 || needsStandardTaskDir)
    touched.push(
      await mergeMiseToml(
        cwd,
        plan.miseTools,
        needsStandardTaskDir,
        writeOptions.overwriteMiseTools,
        writeOptions.overwriteTaskFiles ? generatedTaskNames : new Set<string>(),
      ),
    );
  const packagePath = await mergePackageJson(
    cwd,
    plan.packageDevDependencies,
    writeOptions.overwritePackageDevDependencies,
  );
  if (packagePath) touched.push(packagePath);
  for (const file of plan.files) {
    const path = await writeScaffoldFile(
      cwd,
      file,
      writeOptions.overwriteFiles,
      writeOptions.overwriteTaskFiles,
    );
    if (path) touched.push(path);
  }
  const crumbsPath = await mergeQuietValidators(cwd, plan);
  if (crumbsPath) touched.push(crumbsPath);
  return [...new Set(touched)].sort();
}

export async function previewPlan(cwd: string, plan: ScaffoldPlan): Promise<string[]> {
  const lines: string[] = [];
  const needsStandardTaskDir = plan.files.some((file) =>
    file.path.startsWith(`${STANDARD_MISE_TASK_DIR}/`),
  );
  if (Object.keys(plan.miseTools).length > 0 || needsStandardTaskDir)
    lines.push(`${(await fileExists(join(cwd, "mise.toml"))) ? "merge" : "create"} mise.toml`);
  if (Object.keys(plan.packageDevDependencies).length > 0)
    lines.push(
      `${(await fileExists(join(cwd, "package.json"))) ? "merge" : "create"} package.json`,
    );
  for (const file of plan.files)
    lines.push(
      `${(await fileExists(join(cwd, file.path))) ? "skip/replace" : "create"} ${file.path}`,
    );
  if (plan.quietValidators.length > 0) lines.push("merge .agents/crumbs/crumbs.json");
  return [...new Set(lines)].sort();
}
