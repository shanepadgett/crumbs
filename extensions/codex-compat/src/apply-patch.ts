import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { resolveExistingPath, resolveMutationPath } from "./path-policy.js";

export interface ApplyPatchSummary {
  added: string[];
  updated: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
  linesAdded: number;
  linesRemoved: number;
  changes: ApplyPatchChange[];
  completedOperations: number;
  totalOperations: number;
}

export interface ApplyPatchChange {
  kind: "add" | "update" | "delete";
  path: string;
  move?: { from: string; to: string };
  linesAdded: number;
  linesRemoved: number;
}

type PatchOperation =
  | {
      type: "add";
      path: string;
      content: string;
      linesAdded: number;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "update";
      path: string;
      movePath?: string;
      chunks: UpdateFileChunk[];
      linesAdded: number;
      linesRemoved: number;
    };

interface UpdateFileChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

interface MutableChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
  hasLines: boolean;
}

interface ParsedPatch {
  operations: PatchOperation[];
}

function isOperationBoundary(line: string): boolean {
  return (
    line === "*** End Patch" ||
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  );
}

function requirePath(line: string, prefix: string): string {
  const value = line.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`Missing path for patch directive: ${line}`);
  }
  return value;
}

function createChunk(changeContext?: string): MutableChunk {
  return {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
    hasLines: false,
  };
}

function finalizeChunk(target: MutableChunk | undefined, chunks: UpdateFileChunk[], path: string) {
  if (!target) return;
  if (!target.hasLines) {
    throw new Error(`Update file patch has an empty chunk: ${path}`);
  }

  chunks.push({
    changeContext: target.changeContext,
    oldLines: target.oldLines,
    newLines: target.newLines,
    isEndOfFile: target.isEndOfFile,
  });
}

function parseChunkLine(rawLine: string): { prefix: " " | "+" | "-"; text: string } {
  if (rawLine.length === 0) {
    return { prefix: " ", text: "" };
  }

  const prefix = rawLine[0] as " " | "+" | "-" | undefined;
  if (prefix !== " " && prefix !== "+" && prefix !== "-") {
    throw new Error(`Invalid update hunk line: ${rawLine}`);
  }

  return { prefix, text: rawLine.slice(1) };
}

function parseAddBody(
  lines: string[],
  startIndex: number,
): { content: string; lineCount: number; nextIndex: number } {
  const body: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("+")) {
      body.push(line.slice(1));
      index += 1;
      continue;
    }
    break;
  }

  return {
    content: body.length === 0 ? "" : `${body.join("\n")}\n`,
    lineCount: body.length,
    nextIndex: index,
  };
}

function parseUpdateBody(
  lines: string[],
  startIndex: number,
  operationPath: string,
): {
  movePath?: string;
  chunks: UpdateFileChunk[];
  linesAdded: number;
  linesRemoved: number;
  nextIndex: number;
} {
  const chunks: UpdateFileChunk[] = [];
  let index = startIndex;
  let movePath: string | undefined;
  let current: MutableChunk | undefined;
  let sawAnyChunk = false;
  let linesAdded = 0;
  let linesRemoved = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isOperationBoundary(line)) break;

    if (line.startsWith("*** Move to: ")) {
      if (sawAnyChunk || current) {
        throw new Error(`Move to must appear before update chunks: ${operationPath}`);
      }
      movePath = requirePath(line, "*** Move to: ");
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      finalizeChunk(current, chunks, operationPath);
      const context = line.slice(2).trim();
      current = createChunk(context.length > 0 ? context : undefined);
      sawAnyChunk = true;
      index += 1;
      continue;
    }

    if (line === "*** End of File") {
      if (!current) {
        throw new Error(`*** End of File requires an active chunk: ${operationPath}`);
      }
      current.isEndOfFile = true;
      index += 1;
      continue;
    }

    if (!current) {
      if (sawAnyChunk || chunks.length > 0) {
        throw new Error(`Only the first update chunk may omit @@: ${operationPath}`);
      }
      current = createChunk();
      sawAnyChunk = true;
    }

    const parsedLine = parseChunkLine(line);
    current.hasLines = true;

    if (parsedLine.prefix === "+") linesAdded += 1;
    if (parsedLine.prefix === "-") linesRemoved += 1;

    if (parsedLine.prefix === " " || parsedLine.prefix === "-") {
      current.oldLines.push(parsedLine.text);
    }
    if (parsedLine.prefix === " " || parsedLine.prefix === "+") {
      current.newLines.push(parsedLine.text);
    }

    index += 1;
  }

  finalizeChunk(current, chunks, operationPath);
  if (chunks.length === 0) {
    throw new Error(`Update file patch is missing chunk content: ${operationPath}`);
  }

  return { movePath, chunks, linesAdded, linesRemoved, nextIndex: index };
}

export function extractPatchPaths(input: string): string[] {
  const matches = input.matchAll(/^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm);
  const moveMatches = input.matchAll(/^\*\*\* Move to: (.+)$/gm);
  const paths = new Set<string>();

  for (const match of matches) {
    const value = match[1]?.trim();
    if (value) paths.add(value);
  }
  for (const match of moveMatches) {
    const value = match[1]?.trim();
    if (value) paths.add(value);
  }

  return Array.from(paths);
}

export function parsePatch(input: string): ParsedPatch {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  const lines = normalized.length === 0 ? [] : normalized.split("\n");

  if (lines.length === 0 || lines[0] !== "*** Begin Patch") {
    throw new Error("Patch must start with *** Begin Patch.");
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "*** End Patch") {
      return { operations };
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = requirePath(line, "*** Add File: ");
      const body = parseAddBody(lines, index + 1);
      operations.push({ type: "add", path, content: body.content, linesAdded: body.lineCount });
      index = body.nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = requirePath(line, "*** Delete File: ");
      operations.push({ type: "delete", path });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = requirePath(line, "*** Update File: ");
      const updateBody = parseUpdateBody(lines, index + 1, path);
      operations.push({
        type: "update",
        path,
        movePath: updateBody.movePath,
        chunks: updateBody.chunks,
        linesAdded: updateBody.linesAdded,
        linesRemoved: updateBody.linesRemoved,
      });
      index = updateBody.nextIndex;
      continue;
    }

    throw new Error(`Unexpected patch line: ${line}`);
  }

  throw new Error("Patch must end with *** End Patch.");
}

function splitLogicalLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function countLogicalLines(content: string): number {
  return splitLogicalLines(content).length;
}

function serializeLinesWithTrailingNewline(lines: string[]): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

function normalizeUnicodeText(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
}

function matchesAt(
  source: string[],
  pattern: string[],
  start: number,
  normalize: (value: string) => string,
): boolean {
  if (start < 0 || start + pattern.length > source.length) return false;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (normalize(source[start + offset]) !== normalize(pattern[offset])) {
      return false;
    }
  }
  return true;
}

function seekSequence(lines: string[], pattern: string[], start: number): number {
  if (pattern.length === 0) {
    return Math.min(Math.max(start, 0), lines.length);
  }

  const normalizers: Array<(value: string) => string> = [
    (value) => value,
    (value) => value.trimEnd(),
    (value) => value.trim(),
    (value) => normalizeUnicodeText(value),
  ];

  for (const normalize of normalizers) {
    for (let index = Math.max(start, 0); index <= lines.length - pattern.length; index += 1) {
      if (matchesAt(lines, pattern, index, normalize)) {
        return index;
      }
    }
  }

  return -1;
}

function applyChunks(currentContent: string, chunks: UpdateFileChunk[], path: string): string {
  const lines = splitLogicalLines(currentContent);
  const replacements: Array<{ index: number; deleteCount: number; insert: string[] }> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex);
      if (contextIndex < 0) {
        throw new Error(`Could not find update context in ${path}: ${chunk.changeContext}`);
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
      throw new Error(`Could not match update chunk for ${path}`);
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

async function applyAdd(cwd: string, operation: Extract<PatchOperation, { type: "add" }>) {
  const target = await resolveMutationPath(cwd, operation.path);
  await mkdir(dirname(target.canonicalPath), { recursive: true });
  await writeFile(target.canonicalPath, operation.content, "utf8");
  return target.inputPath;
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
  const next = applyChunks(current, operation.chunks, source.inputPath);

  if (!target || target.canonicalPath === source.canonicalPath) {
    await writeFile(source.canonicalPath, next, "utf8");
  } else {
    await mkdir(dirname(target.canonicalPath), { recursive: true });
    await writeFile(target.canonicalPath, next, "utf8");
    await unlink(source.canonicalPath);
  }

  return {
    updated: source.inputPath,
    moved: target ? { from: source.inputPath, to: target.inputPath } : undefined,
  };
}

function cloneApplyPatchSummary(summary: ApplyPatchSummary): ApplyPatchSummary {
  return {
    added: [...summary.added],
    updated: [...summary.updated],
    deleted: [...summary.deleted],
    moved: summary.moved.map((move) => ({ ...move })),
    linesAdded: summary.linesAdded,
    linesRemoved: summary.linesRemoved,
    changes: summary.changes.map((change) => ({
      ...change,
      move: change.move ? { ...change.move } : undefined,
    })),
    completedOperations: summary.completedOperations,
    totalOperations: summary.totalOperations,
  };
}

async function notifyProgress(
  onProgress: ((summary: ApplyPatchSummary) => void | Promise<void>) | undefined,
  summary: ApplyPatchSummary,
) {
  if (!onProgress) return;
  await onProgress(cloneApplyPatchSummary(summary));
}

export async function applyPatch(
  cwd: string,
  input: string,
  onProgress?: (summary: ApplyPatchSummary) => void | Promise<void>,
): Promise<ApplyPatchSummary> {
  const parsed = parsePatch(input);
  if (parsed.operations.length === 0) {
    throw new Error("No files were modified.");
  }

  const queuePaths = await Promise.all(
    buildOperationPaths(parsed.operations).map(async (path) => {
      const resolved = await resolveMutationPath(cwd, path);
      return resolved.canonicalPath;
    }),
  );

  return withMutationQueuePaths(queuePaths, async () => {
    const summary: ApplyPatchSummary = {
      added: [],
      updated: [],
      deleted: [],
      moved: [],
      linesAdded: 0,
      linesRemoved: 0,
      changes: [],
      completedOperations: 0,
      totalOperations: parsed.operations.length,
    };

    for (const operation of parsed.operations) {
      if (operation.type === "add") {
        const added = await applyAdd(cwd, operation);
        summary.added.push(added);
        summary.linesAdded += operation.linesAdded;
        summary.changes.push({
          kind: "add",
          path: added,
          linesAdded: operation.linesAdded,
          linesRemoved: 0,
        });
        summary.completedOperations += 1;
        await notifyProgress(onProgress, summary);
        continue;
      }

      if (operation.type === "delete") {
        const result = await applyDelete(cwd, operation);
        summary.deleted.push(result.deleted);
        summary.linesRemoved += result.linesRemoved;
        summary.changes.push({
          kind: "delete",
          path: result.deleted,
          linesAdded: 0,
          linesRemoved: result.linesRemoved,
        });
        summary.completedOperations += 1;
        await notifyProgress(onProgress, summary);
        continue;
      }

      const result = await applyUpdate(cwd, operation);
      summary.updated.push(result.updated);
      if (result.moved) summary.moved.push(result.moved);
      summary.linesAdded += operation.linesAdded;
      summary.linesRemoved += operation.linesRemoved;
      summary.changes.push({
        kind: "update",
        path: result.moved?.to ?? result.updated,
        move: result.moved,
        linesAdded: operation.linesAdded,
        linesRemoved: operation.linesRemoved,
      });
      summary.completedOperations += 1;
      await notifyProgress(onProgress, summary);
    }

    return summary;
  });
}
