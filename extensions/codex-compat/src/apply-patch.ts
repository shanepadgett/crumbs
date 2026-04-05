import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { pathExists, resolveExistingPath, resolveMutationPath } from "./path-policy.js";

export interface ApplyPatchSummary {
  added: string[];
  updated: string[];
  deleted: string[];
  moved: Array<{ from: string; to: string }>;
}

type PatchOperation =
  | {
      type: "add";
      path: string;
      content: string;
    }
  | {
      type: "delete";
      path: string;
    }
  | {
      type: "update";
      path: string;
      moveTo?: string;
      hunks: PatchHunk[];
    };

interface PatchHunk {
  header?: string;
  lines: Array<{ prefix: " " | "+" | "-"; text: string }>;
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

function parseUpdateBody(lines: string[]): PatchHunk[] {
  if (lines.length === 0) {
    throw new Error("Update file patch is missing hunk content.");
  }

  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      if (current && current.lines.length > 0) hunks.push(current);
      current = { header: line, lines: [] };
      continue;
    }

    if (line === "\\ No newline at end of file") {
      continue;
    }

    const prefix = line[0] as " " | "+" | "-" | undefined;
    if (prefix !== " " && prefix !== "+" && prefix !== "-") {
      throw new Error(`Invalid update hunk line: ${line}`);
    }

    const target = current ?? { lines: [] };
    if (!current) current = target;
    target.lines.push({ prefix, text: line.slice(1) });
  }

  if (current && current.lines.length > 0) {
    hunks.push(current);
  }

  if (hunks.length === 0) {
    throw new Error("Update file patch did not contain any usable hunks.");
  }

  return hunks;
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
  const normalized = input.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "*** Begin Patch") {
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
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !isOperationBoundary(lines[index])) {
        const bodyLine = lines[index];
        body.push(bodyLine.startsWith("+") ? bodyLine.slice(1) : bodyLine);
        index += 1;
      }
      operations.push({ type: "add", path, content: body.join("\n") });
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
      index += 1;
      let moveTo: string | undefined;
      const body: string[] = [];

      while (index < lines.length && !isOperationBoundary(lines[index])) {
        const bodyLine = lines[index];
        if (bodyLine.startsWith("*** Move to: ")) {
          moveTo = requirePath(bodyLine, "*** Move to: ");
          index += 1;
          continue;
        }
        body.push(bodyLine);
        index += 1;
      }

      operations.push({ type: "update", path, moveTo, hunks: parseUpdateBody(body) });
      continue;
    }

    throw new Error(`Unexpected patch line: ${line}`);
  }

  throw new Error("Patch must end with *** End Patch.");
}

function splitLines(content: string): { lines: string[]; endsWithNewline: boolean } {
  if (content.length === 0) {
    return { lines: [], endsWithNewline: false };
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const rawLines = normalized.split("\n");
  const lines = endsWithNewline ? rawLines.slice(0, -1) : rawLines;

  return {
    lines,
    endsWithNewline,
  };
}

function joinLines(lines: string[], endsWithNewline: boolean): string {
  if (lines.length === 0) return "";
  const joined = lines.join("\n");
  return endsWithNewline ? `${joined}\n` : joined;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function findMatchIndexes(lines: string[], pattern: string[], start: number): number[] {
  if (pattern.length === 0) return [];

  const matches: number[] = [];
  for (let index = start; index <= lines.length - pattern.length; index += 1) {
    if (arraysEqual(lines.slice(index, index + pattern.length), pattern)) {
      matches.push(index);
    }
  }

  if (matches.length === 0 && start > 0) {
    for (let index = 0; index <= lines.length - pattern.length; index += 1) {
      if (arraysEqual(lines.slice(index, index + pattern.length), pattern)) {
        matches.push(index);
      }
    }
  }

  return matches;
}

function applyHunks(currentContent: string, hunks: PatchHunk[]): string {
  const split = splitLines(currentContent);
  let lines = split.lines;
  let searchStart = 0;

  for (const hunk of hunks) {
    const before = hunk.lines
      .filter((line) => line.prefix === " " || line.prefix === "-")
      .map((line) => line.text);
    const after = hunk.lines
      .filter((line) => line.prefix === " " || line.prefix === "+")
      .map((line) => line.text);

    if (before.length === 0) {
      if (after.length === 0) continue;
      if (lines.length === 0) {
        lines = after;
        searchStart = after.length;
        continue;
      }
      throw new Error(`Hunk has no anchor${hunk.header ? ` (${hunk.header})` : ""}.`);
    }

    const matches = findMatchIndexes(lines, before, searchStart);
    if (matches.length === 0) {
      throw new Error(`Could not match update hunk${hunk.header ? ` (${hunk.header})` : ""}.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Update hunk matched multiple locations${hunk.header ? ` (${hunk.header})` : ""}.`,
      );
    }

    const matchIndex = matches[0];
    lines = [...lines.slice(0, matchIndex), ...after, ...lines.slice(matchIndex + before.length)];
    searchStart = matchIndex + after.length;
  }

  return joinLines(lines, split.endsWithNewline);
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

async function applyAdd(cwd: string, operation: Extract<PatchOperation, { type: "add" }>) {
  const target = await resolveMutationPath(cwd, operation.path);
  if (await pathExists(target.canonicalPath)) {
    throw new Error(`Cannot add existing file: ${operation.path}`);
  }

  await withMutationQueuePaths([target.canonicalPath], async () => {
    await mkdir(dirname(target.canonicalPath), { recursive: true });
    await writeFile(target.canonicalPath, operation.content, "utf8");
  });

  return target.inputPath;
}

async function applyDelete(cwd: string, operation: Extract<PatchOperation, { type: "delete" }>) {
  const target = await resolveExistingPath(cwd, operation.path, "file");
  await withMutationQueuePaths([target.canonicalPath], async () => {
    await unlink(target.canonicalPath);
  });
  return target.inputPath;
}

async function applyUpdate(cwd: string, operation: Extract<PatchOperation, { type: "update" }>) {
  const source = await resolveExistingPath(cwd, operation.path, "file");
  const target = operation.moveTo ? await resolveMutationPath(cwd, operation.moveTo) : undefined;

  if (
    target &&
    target.canonicalPath !== source.canonicalPath &&
    (await pathExists(target.canonicalPath))
  ) {
    throw new Error(`Move target already exists: ${operation.moveTo}`);
  }

  await withMutationQueuePaths(
    [source.canonicalPath, ...(target ? [target.canonicalPath] : [])],
    async () => {
      const current = await readFile(source.canonicalPath, "utf8");
      const next = applyHunks(current, operation.hunks);

      if (!target || target.canonicalPath === source.canonicalPath) {
        await writeFile(source.canonicalPath, next, "utf8");
        return;
      }

      await mkdir(dirname(target.canonicalPath), { recursive: true });
      await writeFile(source.canonicalPath, next, "utf8");
      await rename(source.canonicalPath, target.canonicalPath);
    },
  );

  return {
    updated: source.inputPath,
    moved: target ? { from: source.inputPath, to: target.inputPath } : undefined,
  };
}

export async function applyPatch(cwd: string, input: string): Promise<ApplyPatchSummary> {
  const parsed = parsePatch(input);
  const summary: ApplyPatchSummary = {
    added: [],
    updated: [],
    deleted: [],
    moved: [],
  };

  for (const operation of parsed.operations) {
    if (operation.type === "add") {
      summary.added.push(await applyAdd(cwd, operation));
      continue;
    }

    if (operation.type === "delete") {
      summary.deleted.push(await applyDelete(cwd, operation));
      continue;
    }

    const result = await applyUpdate(cwd, operation);
    summary.updated.push(result.updated);
    if (result.moved) summary.moved.push(result.moved);
  }

  return summary;
}
