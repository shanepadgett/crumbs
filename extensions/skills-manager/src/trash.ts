import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DeletedOperation } from "./types.js";
import { getParentDir, getTrashDir } from "./paths.js";

function uniqueTrashPath(baseDir: string, sourcePath: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = basename(sourcePath);
  return join(baseDir, `${base}.skills-manager-${stamp}-${randomUUID().slice(0, 8)}`);
}

export async function movePathToTrash(path: string): Promise<string> {
  const trashDir = getTrashDir();
  await mkdir(trashDir, { recursive: true });
  const destination = uniqueTrashPath(trashDir, path);
  await rename(path, destination);
  return destination;
}

export async function restorePathFromTrash(
  trashPath: string,
  originalPath: string,
): Promise<string> {
  const restorePath = await nextAvailableRestorePath(originalPath);
  await mkdir(getParentDir(restorePath), { recursive: true });
  await rename(trashPath, restorePath);
  return restorePath;
}

async function nextAvailableRestorePath(originalPath: string): Promise<string> {
  if (!existsSync(originalPath)) return originalPath;
  let index = 1;
  while (true) {
    const candidate = `${originalPath}.restored-${index}`;
    if (!existsSync(candidate)) return candidate;
    index++;
  }
}

async function readOperations(logPath: string): Promise<DeletedOperation[]> {
  if (!existsSync(logPath)) return [];
  const content = await readFile(logPath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as DeletedOperation];
      } catch {
        return [];
      }
    });
}

async function writeOperations(logPath: string, operations: DeletedOperation[]): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  const body = operations.map((operation) => JSON.stringify(operation)).join("\n");
  await writeFile(logPath, body.length > 0 ? `${body}\n` : "", "utf8");
}

export async function appendDeletedOperation(
  logPath: string,
  operation: DeletedOperation,
): Promise<void> {
  const operations = await readOperations(logPath);
  operations.push(operation);
  await writeOperations(logPath, operations);
}

export async function pruneDeletedOperations(logPath: string): Promise<DeletedOperation[]> {
  const operations = await readOperations(logPath);
  const pruned = operations
    .map((operation) => ({
      ...operation,
      entries: operation.entries.filter((entry) => existsSync(entry.trashPath)),
    }))
    .filter((operation) => operation.entries.length > 0);
  await writeOperations(logPath, pruned);
  return pruned;
}
