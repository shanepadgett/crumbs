import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ApplyPatchSummary } from "./patch-executor.js";

const ATTEMPT_DIR = ".pi/local/apply-patch-attempts";
const MAX_ATTEMPT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPT_FILES = 50;

export interface PatchInputSource {
  input: string;
  referencePath?: string;
}

export interface PatchRecoveryArtifact {
  path: string;
  failedSections: number;
}

function ensureRelativeInsideCwd(cwd: string, inputPath: string): string {
  if (!inputPath || isAbsolute(inputPath)) {
    throw new Error("Patch reference must be a relative path inside current workspace.");
  }

  const absolutePath = resolve(cwd, inputPath);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Patch reference must stay inside current workspace.");
  }

  return relativePath;
}

function ensureAttemptPath(cwd: string, inputPath: string): string {
  const relativePath = ensureRelativeInsideCwd(cwd, inputPath);
  if (!relativePath.startsWith(`${ATTEMPT_DIR}/`)) {
    throw new Error(`Patch reference must be under ${ATTEMPT_DIR}/.`);
  }
  if (!relativePath.endsWith(".patch")) {
    throw new Error("Patch reference must point to a .patch file.");
  }
  return relativePath;
}

function sectionHeaderKind(line: string): boolean {
  return (
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Replace File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  );
}

function isTopLevelBoundary(line: string): boolean {
  return line === "*** End Patch" || sectionHeaderKind(line);
}

function extractRawSections(input: string): Map<number, string> {
  const sections = new Map<number, string>();
  const lines = input.replace(/\r\n/g, "\n").trim().split("\n");
  let sectionIndex = 0;
  let index = lines.indexOf("*** Begin Patch") + 1;
  if (index === 0) return sections;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") break;
    if (!sectionHeaderKind(line)) {
      index += 1;
      continue;
    }

    sectionIndex += 1;
    const sectionStart = index;
    let nextBoundary = index + 1;
    while (nextBoundary < lines.length && !isTopLevelBoundary(lines[nextBoundary])) {
      nextBoundary += 1;
    }
    sections.set(sectionIndex, lines.slice(sectionStart, nextBoundary).join("\n"));
    index = nextBoundary;
  }

  return sections;
}

function buildRetryPatch(
  input: string,
  summary: ApplyPatchSummary,
): { content: string; sectionCount: number } | undefined {
  const rawSections = extractRawSections(input);
  const sections: string[] = [];
  const seen = new Set<string>();

  for (const failure of summary.failures) {
    const rawSection =
      failure.sectionIndex > 0
        ? rawSections.get(failure.sectionIndex)
        : failure.rawSection && sectionHeaderKind(failure.rawSection.split("\n")[0] ?? "")
          ? failure.rawSection
          : undefined;
    if (!rawSection || seen.has(rawSection)) continue;
    sections.push(rawSection);
    seen.add(rawSection);
  }

  if (sections.length === 0) return undefined;
  return {
    content: ["*** Begin Patch", ...sections, "*** End Patch"].join("\n"),
    sectionCount: sections.length,
  };
}

async function cleanupStaleAttempts(cwd: string): Promise<void> {
  const attemptDir = resolve(cwd, ATTEMPT_DIR);
  let entries: Array<{ path: string; mtimeMs: number }> = [];

  try {
    const names = await readdir(attemptDir);
    entries = await Promise.all(
      names
        .filter((name) => name.endsWith(".patch"))
        .map(async (name) => {
          const path = join(attemptDir, name);
          const info = await stat(path);
          return { path, mtimeMs: info.mtimeMs };
        }),
    );
  } catch {
    return;
  }

  const now = Date.now();
  const stale = entries.filter((entry) => now - entry.mtimeMs > MAX_ATTEMPT_AGE_MS);
  const overflow = entries
    .filter((entry) => now - entry.mtimeMs <= MAX_ATTEMPT_AGE_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(MAX_ATTEMPT_FILES);

  await Promise.all([...stale, ...overflow].map((entry) => unlink(entry.path).catch(() => {})));
}

export async function resolvePatchInput(cwd: string, rawInput: string): Promise<PatchInputSource> {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("@")) return { input: rawInput };

  const referencePath = ensureAttemptPath(cwd, trimmed.slice(1).trim());
  const input = await readFile(resolve(cwd, referencePath), "utf8");
  return { input, referencePath };
}

export async function saveFailedPatchAttempt(
  cwd: string,
  input: string,
  summary: ApplyPatchSummary,
): Promise<PatchRecoveryArtifact | undefined> {
  if (summary.status === "completed") return undefined;

  const retryPatch = buildRetryPatch(input, summary);
  if (!retryPatch) return undefined;

  await cleanupStaleAttempts(cwd);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const relativePath = `${ATTEMPT_DIR}/${id}.failed.patch`;
  const absolutePath = resolve(cwd, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${retryPatch.content}\n`, "utf8");

  return { path: relativePath, failedSections: retryPatch.sectionCount };
}

export async function cleanupPatchReference(cwd: string, referencePath: string): Promise<void> {
  const relativePath = ensureAttemptPath(cwd, referencePath);
  await unlink(resolve(cwd, relativePath)).catch(() => {});

  const base = basename(relativePath, ".failed.patch");
  if (base === basename(relativePath)) return;

  const attemptDir = resolve(cwd, ATTEMPT_DIR);
  const names = await readdir(attemptDir).catch(() => []);
  await Promise.all(
    names
      .filter((name) => name.startsWith(base) && name !== basename(relativePath))
      .map((name) => unlink(join(attemptDir, name)).catch(() => {})),
  );
}
