import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { resolveProjectRoot } from "../../shared/config/project-root.js";
import { asObject, type JsonObject } from "../../shared/io/json-file.js";
import {
  normalizeCavemanEnhancement,
  type AdditionalContextFile,
  type AdditionalContextInput,
  type CavemanEnhancement,
} from "./system-prompt.js";

export type AdditionalContextConfig = {
  all: string[];
  powers: Partial<Record<CavemanEnhancement, string[]>>;
};

export type LoadedAdditionalContext = {
  context: AdditionalContextInput;
  warnings: string[];
};

const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 192 * 1024;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
}

export function normalizeAdditionalContextConfig(value: unknown): AdditionalContextConfig {
  const section = asObject(value);
  if (!section) return { all: [], powers: {} };

  const powers: Partial<Record<CavemanEnhancement, string[]>> = {};
  const rawPowers = asObject(section.powers);
  if (rawPowers) {
    for (const [key, paths] of Object.entries(rawPowers)) {
      const power = normalizeCavemanEnhancement(key);
      if (!power) continue;
      const normalizedPaths = normalizePathList(paths);
      if (normalizedPaths.length > 0) powers[power] = normalizedPaths;
    }
  }

  return {
    all: normalizePathList(section.all),
    powers,
  };
}

function resolveConfiguredPath(projectRoot: string, configuredPath: string): string {
  if (configuredPath === "~") return homedir();
  if (configuredPath.startsWith("~/")) return join(homedir(), configuredPath.slice(2));
  if (isAbsolute(configuredPath)) return configuredPath;
  return join(projectRoot, configuredPath);
}

async function readContextFile(path: string): Promise<{ content: string; truncated: boolean }> {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    const bytesToRead = Math.min(stat.size, MAX_CONTEXT_FILE_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      content: buffer.subarray(0, result.bytesRead).toString("utf8"),
      truncated: stat.size > MAX_CONTEXT_FILE_BYTES,
    };
  } finally {
    await handle.close();
  }
}

function estimateBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function truncateToBytes(value: string, maxBytes: number): string {
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

async function loadFiles(
  projectRoot: string,
  paths: string[],
  remainingBytes: { value: number },
): Promise<{ files: AdditionalContextFile[]; warnings: string[] }> {
  const files: AdditionalContextFile[] = [];
  const warnings: string[] = [];

  for (const configuredPath of paths) {
    if (remainingBytes.value <= 0) {
      warnings.push(`Additional context total limit reached before ${configuredPath}.`);
      continue;
    }

    try {
      const resolvedPath = resolveConfiguredPath(projectRoot, configuredPath);
      const read = await readContextFile(resolvedPath);
      const contentBytes = estimateBytes(read.content);
      const content =
        contentBytes > remainingBytes.value
          ? truncateToBytes(read.content, remainingBytes.value)
          : read.content;
      const wasTotalTruncated = contentBytes > remainingBytes.value;

      files.push({ source: configuredPath, content });
      remainingBytes.value -= estimateBytes(content);

      if (read.truncated || wasTotalTruncated) {
        warnings.push(`Additional context truncated: ${configuredPath}.`);
      }
    } catch {
      warnings.push(`Additional context file unavailable: ${configuredPath}.`);
    }
  }

  return { files, warnings };
}

export async function loadAdditionalContext(input: {
  cwd: string;
  config: AdditionalContextConfig;
  enhancements: CavemanEnhancement[];
}): Promise<LoadedAdditionalContext> {
  const projectRoot = await resolveProjectRoot(input.cwd);
  const remainingBytes = { value: MAX_CONTEXT_TOTAL_BYTES };
  const warnings: string[] = [];
  const context: AdditionalContextInput = { all: [], powers: {} };

  const all = await loadFiles(projectRoot, input.config.all, remainingBytes);
  context.all = all.files;
  warnings.push(...all.warnings);

  for (const enhancement of input.enhancements) {
    const paths = input.config.powers[enhancement] ?? [];
    if (paths.length === 0) continue;
    const loaded = await loadFiles(projectRoot, paths, remainingBytes);
    context.powers[enhancement] = loaded.files;
    warnings.push(...loaded.warnings);
  }

  return { context, warnings };
}

export function getAdditionalContextConfig(section: JsonObject | null): AdditionalContextConfig {
  return normalizeAdditionalContextConfig(section?.additionalContext);
}
