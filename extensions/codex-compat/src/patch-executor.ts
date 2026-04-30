import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import {
  countLogicalLines,
  seekSequence,
  serializeLinesWithTrailingNewline,
  splitLogicalLines,
  type UpdateFileChunk,
} from "./patch-matcher.js";
import {
  formatContextHint,
  parsePatch,
  type PatchFailure,
  type PatchOperation,
} from "./patch-parser.js";
import { pathExists, resolveExistingPath, resolveMutationPath } from "./path-policy.js";

export interface ApplyPatchChange {
  sectionIndex: number;
  kind: "add" | "replace" | "update" | "delete";
  path: string;
  move?: { from: string; to: string };
  linesAdded: number;
  linesRemoved: number;
}

export interface ApplyPatchSummary {
  status: "completed" | "partial" | "failed";
  added: string[];
  updated: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
  linesAdded: number;
  linesRemoved: number;
  changes: ApplyPatchChange[];
  failures: PatchFailure[];
  completedOperations: number;
  totalOperations: number;
}

class UpdateChunkApplyError extends Error {
  chunkIndex: number;
  totalChunks: number;
  contextHint?: string;

  constructor(message: string, chunkIndex: number, totalChunks: number, contextHint?: string) {
    super(message);
    this.name = "UpdateChunkApplyError";
    this.chunkIndex = chunkIndex;
    this.totalChunks = totalChunks;
    this.contextHint = contextHint;
  }
}

async function withMutationQueuePaths<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
  const unique = Array.from(new Set(paths)).sort();

  let current = fn;
  for (const path of unique.reverse()) {
    const next = current;
    current = () => withFileMutationQueue(path, next);
  }

  return current();
}

function buildOperationPaths(operations: PatchOperation[]): string[] {
  const paths = new Set<string>();

  for (const operation of operations) {
    paths.add(operation.path);
    if (operation.type === "update" && operation.movePath) {
      paths.add(operation.movePath);
    }
  }

  return Array.from(paths);
}

function applyChunksWithChunkErrors(
  currentContent: string,
  chunks: UpdateFileChunk[],
  _path: string,
): string {
  const lines = splitLogicalLines(currentContent);
  const replacements: Array<{ index: number; deleteCount: number; insert: string[] }> = [];
  let lineIndex = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const chunkIndex = index + 1;
    const contextHint = formatContextHint(chunk);

    if (chunk.changeContext) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex);
      if (contextIndex < 0) {
        throw new UpdateChunkApplyError(
          `could not find update context`,
          chunkIndex,
          chunks.length,
          contextHint,
        );
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push({ index: lines.length, deleteCount: 0, insert: [...chunk.newLines] });
      lineIndex = lines.length;
      continue;
    }

    let matchIndex = -1;
    if (chunk.isEndOfFile) {
      const eofIndex = lines.length - chunk.oldLines.length;
      if (eofIndex >= lineIndex && seekSequence(lines, chunk.oldLines, eofIndex) === eofIndex) {
        matchIndex = eofIndex;
      }
    }
    if (matchIndex < 0) {
      matchIndex = seekSequence(lines, chunk.oldLines, lineIndex);
    }
    if (matchIndex < 0) {
      throw new UpdateChunkApplyError(`could not match`, chunkIndex, chunks.length, contextHint);
    }

    replacements.push({
      index: matchIndex,
      deleteCount: chunk.oldLines.length,
      insert: [...chunk.newLines],
    });
    lineIndex = matchIndex + chunk.oldLines.length;
  }

  const output = [...lines];
  replacements
    .sort((a, b) => b.index - a.index)
    .forEach((replacement) => {
      output.splice(replacement.index, replacement.deleteCount, ...replacement.insert);
    });

  return serializeLinesWithTrailingNewline(output);
}

async function applyAdd(cwd: string, operation: Extract<PatchOperation, { type: "add" }>) {
  const target = await resolveMutationPath(cwd, operation.path);
  await mkdir(dirname(target.canonicalPath), { recursive: true });
  await writeFile(target.canonicalPath, operation.content, "utf8");
  return target.inputPath;
}

async function applyReplace(cwd: string, operation: Extract<PatchOperation, { type: "replace" }>) {
  const target = await resolveExistingPath(cwd, operation.path, "file");
  const current = await readFile(target.canonicalPath, "utf8");
  await writeFile(target.canonicalPath, operation.content, "utf8");
  return {
    replaced: target.inputPath,
    linesRemoved: countLogicalLines(current),
  };
}

async function applyDelete(cwd: string, operation: Extract<PatchOperation, { type: "delete" }>) {
  const target = await resolveExistingPath(cwd, operation.path, "file");
  const current = await readFile(target.canonicalPath, "utf8");
  await unlink(target.canonicalPath);
  return {
    deleted: target.inputPath,
    linesRemoved: countLogicalLines(current),
  };
}

async function applyUpdate(cwd: string, operation: Extract<PatchOperation, { type: "update" }>) {
  const source = await resolveExistingPath(cwd, operation.path, "file");
  const target = operation.movePath
    ? await resolveMutationPath(cwd, operation.movePath)
    : undefined;
  const current = await readFile(source.canonicalPath, "utf8");

  let next = current;
  if (operation.chunks.length > 0) {
    try {
      next = applyChunksWithChunkErrors(current, operation.chunks, source.inputPath);
    } catch (error) {
      if (error instanceof UpdateChunkApplyError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message);
    }
  }

  if (!target || target.canonicalPath === source.canonicalPath) {
    await writeFile(source.canonicalPath, next, "utf8");
    return {
      updated: source.inputPath,
      moved: undefined,
    };
  }

  await mkdir(dirname(target.canonicalPath), { recursive: true });
  await writeFile(target.canonicalPath, next, "utf8");
  try {
    await unlink(source.canonicalPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `move wrote target ${target.inputPath} but failed to remove source ${source.inputPath}: ${message}`,
    );
  }

  return {
    updated: source.inputPath,
    moved: { from: source.inputPath, to: target.inputPath },
  };
}

function collectCoupledOperations(operations: PatchOperation[]): Map<number, Set<number>> {
  const coupled = new Map<number, Set<number>>();

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    if (operation.type !== "update" || !operation.movePath) continue;

    for (let otherIndex = 0; otherIndex < operations.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = operations[otherIndex];
      const otherMovePath = other.type === "update" ? other.movePath : undefined;
      if (operation.movePath !== other.path && operation.movePath !== otherMovePath) continue;

      const left = coupled.get(index) ?? new Set<number>();
      left.add(otherIndex);
      coupled.set(index, left);

      const right = coupled.get(otherIndex) ?? new Set<number>();
      right.add(index);
      coupled.set(otherIndex, right);
    }
  }

  return coupled;
}

interface OperationPathUse {
  sectionIndex: number;
  path: string;
  displayPath: string;
  kind: PatchOperation["type"];
  role: "delete" | "write";
}

function describeConflictKind(left: OperationPathUse, right: OperationPathUse): string {
  if (left.role === "write" && right.role === "write") return "multiple writes";
  if (left.role === "delete" && right.role === "delete") return "multiple deletes";
  return "delete/write mix";
}

function replacementGuidanceFor(left: OperationPathUse, right: OperationPathUse): string {
  const kinds = new Set([left.kind, right.kind]);
  if (kinds.has("add") && kinds.has("delete")) return " Use *** Replace File: for full rewrites.";
  if (kinds.has("replace") && kinds.has("delete")) {
    return " Replace File already overwrites existing content; do not also delete it.";
  }
  return " Split dependent changes into separate patches or combine them into one section.";
}

async function collectPreflightFailures(
  cwd: string,
  operations: PatchOperation[],
): Promise<PatchFailure[]> {
  const pathUses = new Map<string, OperationPathUse[]>();
  const failures: PatchFailure[] = [];

  async function addPathUse(rawPath: string, use: Omit<OperationPathUse, "path" | "displayPath">) {
    const resolved = await resolveMutationPath(cwd, rawPath);
    const path = resolved.canonicalPath;
    const uses = pathUses.get(path) ?? [];
    uses.push({ ...use, path, displayPath: resolved.inputPath });
    pathUses.set(path, uses);
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const sectionIndex = index + 1;

    if (operation.type === "add" || operation.type === "replace") {
      await addPathUse(operation.path, { sectionIndex, kind: operation.type, role: "write" });
      continue;
    }

    if (operation.type === "delete") {
      await addPathUse(operation.path, { sectionIndex, kind: operation.type, role: "delete" });
      continue;
    }

    if (!operation.movePath) {
      await addPathUse(operation.path, { sectionIndex, kind: operation.type, role: "write" });
      continue;
    }

    const source = await resolveMutationPath(cwd, operation.path);
    const target = await resolveMutationPath(cwd, operation.movePath);
    if (source.canonicalPath === target.canonicalPath) {
      await addPathUse(operation.path, { sectionIndex, kind: operation.type, role: "write" });
      continue;
    }

    await addPathUse(operation.path, { sectionIndex, kind: operation.type, role: "delete" });
    await addPathUse(operation.movePath, { sectionIndex, kind: operation.type, role: "write" });

    if (await pathExists(target.canonicalPath)) {
      failures.push({
        phase: "apply",
        sectionIndex,
        kind: operation.type,
        path: operation.movePath,
        message: `move target already exists: ${operation.movePath}. Move targets must be unused to avoid overwriting existing files.`,
      });
    }
  }

  for (const uses of pathUses.values()) {
    const conflictedSections = new Set<number>();
    for (let index = 1; index < uses.length; index += 1) {
      const left = uses[index - 1];
      const right = uses[index];
      const message = `conflicting operations for same path: sections ${left.sectionIndex} and ${right.sectionIndex} (${left.kind}/${right.kind}, ${describeConflictKind(left, right)}).${replacementGuidanceFor(left, right)}`;
      if (!conflictedSections.has(left.sectionIndex)) {
        failures.push({
          phase: "apply",
          sectionIndex: left.sectionIndex,
          kind: left.kind,
          path: left.displayPath,
          message,
        });
        conflictedSections.add(left.sectionIndex);
      }
      if (conflictedSections.has(right.sectionIndex)) continue;
      failures.push({
        phase: "apply",
        sectionIndex: right.sectionIndex,
        kind: right.kind,
        path: right.displayPath,
        message,
      });
      conflictedSections.add(right.sectionIndex);
    }
  }

  return failures;
}

function progressSnapshot(
  summary: ApplyPatchSummary,
  completedOperations: number,
  totalOperations: number,
): ApplyPatchSummary {
  return {
    ...summary,
    added: [...summary.added],
    updated: [...summary.updated],
    deleted: [...summary.deleted],
    moved: summary.moved.map((move) => ({ ...move })),
    changes: summary.changes.map((change) => ({
      ...change,
      move: change.move ? { ...change.move } : undefined,
    })),
    failures: summary.failures.map((failure) => ({ ...failure })),
    completedOperations,
    totalOperations,
  };
}

export async function applyPatch(
  cwd: string,
  input: string,
  onProgress?: (summary: ApplyPatchSummary) => void | Promise<void>,
): Promise<ApplyPatchSummary> {
  const parsed = parsePatch(input);
  const { operations, parseFailures } = parsed;

  if (operations.length === 0 && parseFailures.length === 0) {
    throw new Error("empty patch");
  }

  const totalOperations = operations.length + parseFailures.length;
  const preflightFailures = await collectPreflightFailures(cwd, operations);
  if (preflightFailures.length > 0) {
    const summary: ApplyPatchSummary = {
      status: "failed",
      added: [],
      updated: [],
      deleted: [],
      moved: [],
      linesAdded: 0,
      linesRemoved: 0,
      changes: [],
      failures: [...parseFailures, ...preflightFailures],
      completedOperations: 0,
      totalOperations,
    };
    if (onProgress) await onProgress(progressSnapshot(summary, 0, totalOperations));
    return summary;
  }

  const coupled = collectCoupledOperations(operations);
  const skipOperations = new Set<number>();
  const queuePaths = await Promise.all(
    buildOperationPaths(operations).map(async (path) => {
      const resolved = await resolveMutationPath(cwd, path);
      return resolved.canonicalPath;
    }),
  );

  return withMutationQueuePaths(queuePaths, async () => {
    const summary: ApplyPatchSummary = {
      status: "completed",
      added: [],
      updated: [],
      deleted: [],
      moved: [],
      linesAdded: 0,
      linesRemoved: 0,
      changes: [],
      failures: [...parseFailures],
      completedOperations: 0,
      totalOperations,
    };

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const sectionIndex = index + 1;

      if (skipOperations.has(index)) {
        summary.failures.push({
          phase: "apply",
          sectionIndex,
          kind: operation.type,
          path: operation.path,
          message: "skipped: coupled op failed",
        });
        if (onProgress) {
          await onProgress(progressSnapshot(summary, summary.changes.length, totalOperations));
        }
        continue;
      }

      try {
        if (operation.type === "add") {
          const added = await applyAdd(cwd, operation);
          summary.added.push(added);
          summary.linesAdded += operation.linesAdded;
          summary.changes.push({
            sectionIndex,
            kind: "add",
            path: added,
            linesAdded: operation.linesAdded,
            linesRemoved: 0,
          });
        } else if (operation.type === "replace") {
          const result = await applyReplace(cwd, operation);
          summary.updated.push(result.replaced);
          summary.linesAdded += operation.linesAdded;
          summary.linesRemoved += result.linesRemoved;
          summary.changes.push({
            sectionIndex,
            kind: "replace",
            path: result.replaced,
            linesAdded: operation.linesAdded,
            linesRemoved: result.linesRemoved,
          });
        } else if (operation.type === "delete") {
          const result = await applyDelete(cwd, operation);
          summary.deleted.push(result.deleted);
          summary.linesRemoved += result.linesRemoved;
          summary.changes.push({
            sectionIndex,
            kind: "delete",
            path: result.deleted,
            linesAdded: 0,
            linesRemoved: result.linesRemoved,
          });
        } else {
          const result = await applyUpdate(cwd, operation);
          summary.updated.push(result.updated);
          if (result.moved) summary.moved.push(result.moved);
          summary.linesAdded += operation.linesAdded;
          summary.linesRemoved += operation.linesRemoved;
          summary.changes.push({
            sectionIndex,
            kind: "update",
            path: result.moved?.to ?? result.updated,
            move: result.moved,
            linesAdded: operation.linesAdded,
            linesRemoved: operation.linesRemoved,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure: PatchFailure = {
          phase: "apply",
          sectionIndex,
          kind: operation.type,
          path: operation.path,
          message,
        };
        if (error instanceof UpdateChunkApplyError) {
          failure.chunkIndex = error.chunkIndex;
          failure.totalChunks = error.totalChunks;
          failure.contextHint = error.contextHint;
        }
        summary.failures.push(failure);

        const partners = coupled.get(index);
        if (partners) {
          for (const partner of partners) {
            skipOperations.add(partner);
          }
        }
      }

      if (onProgress) {
        await onProgress(progressSnapshot(summary, summary.changes.length, totalOperations));
      }
    }

    summary.completedOperations = summary.changes.length;
    summary.status =
      summary.changes.length === 0
        ? "failed"
        : summary.failures.length > 0
          ? "partial"
          : "completed";

    return summary;
  });
}
