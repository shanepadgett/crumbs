import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readlink, rm, symlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DeletedEntry,
  DeletedOperation,
  ManagerAction,
  SkillRecord,
  SkillRoot,
  SkillScope,
  SkillStore,
} from "./types.js";
import { appendDeletedOperation, movePathToTrash, restorePathFromTrash } from "./trash.js";

export interface ActionResult {
  message: string;
}

function isPathWithinRoot(targetPath: string, root: string): boolean {
  const rel = targetPath.startsWith(root) ? targetPath.slice(root.length) : undefined;
  if (rel === undefined) return false;
  return rel.length > 0 && rel.startsWith("/");
}

function rootFor(roots: SkillRoot[], store: SkillStore, scope: SkillScope): SkillRoot | undefined {
  return roots.find((root) => root.store === store && root.scope === scope);
}

export function getManagedTargetRoots(roots: SkillRoot[]): string[] {
  return roots.map((root) => root.root);
}

export function resolveSelection<T extends { id: string }>(
  rows: T[],
  selectedIds: Set<string>,
  hoveredId?: string,
): T[] {
  const selected = rows.filter((row) => selectedIds.has(row.id));
  if (selected.length > 0) return selected;
  return hoveredId ? rows.filter((row) => row.id === hoveredId) : [];
}

export function actionAvailability(
  action: ManagerAction,
  skills: SkillRecord[],
  hovered?: SkillRecord,
): boolean {
  const scope = skills.length > 0 ? skills : hovered ? [hovered] : [];
  if (scope.length === 0) return action === "refresh";
  const allAgents = scope.every((item) => item.store === "agents");
  const allClaude = scope.every((item) => item.store === "claude");
  const single = scope.length === 1;

  switch (action) {
    case "delete":
    case "show-details":
    case "refresh":
      return true;
    case "link-to-claude":
      return allAgents;
    case "move-to-agents":
      return allClaude;
    case "reveal-target":
      return single && scope[0]!.isSymlink;
    case "restore":
      return false;
  }
}

export async function executeDelete(
  selected: SkillRecord[],
  logPath: string,
): Promise<ActionResult> {
  const operationId = randomUUID();
  const plan = new Map<string, DeletedEntry>();

  for (const item of selected) {
    plan.set(resolve(item.path), {
      entryId: randomUUID(),
      name: item.name,
      originalPath: resolve(item.path),
      trashPath: "",
      store: item.store,
      scope: item.scope,
      tab: item.tab,
      isSymlink: item.isSymlink,
      symlinkTarget: item.resolvedTarget,
      deletedRole: "selected-entry",
    });
  }

  const moved: DeletedEntry[] = [];
  for (const entry of plan.values()) {
    const trashPath = await movePathToTrash(entry.originalPath);
    moved.push({ ...entry, trashPath });
  }

  const operation: DeletedOperation = {
    id: operationId,
    kind: "deleted-operation",
    deletedAt: new Date().toISOString(),
    entries: moved,
  };
  await appendDeletedOperation(logPath, operation);
  return { message: `Trashed ${moved.length} path${moved.length === 1 ? "" : "s"}.` };
}

export async function executeLinkToClaude(
  selected: SkillRecord[],
  roots: SkillRoot[],
  destinationScope: SkillScope,
): Promise<ActionResult> {
  const destinationRoot = rootFor(roots, "claude", destinationScope);
  if (!destinationRoot) throw new Error("Missing Claude destination root");
  await mkdir(destinationRoot.root, { recursive: true });

  let linked = 0;
  let skipped = 0;

  for (const item of selected) {
    const source = resolve(item.resolvedTarget ?? item.path);
    const destination = resolve(destinationRoot.root, basename(item.path));
    if (existsSync(destination)) {
      try {
        const info = await lstat(destination);
        if (info.isSymbolicLink()) {
          const currentTarget = resolve(destinationRoot.root, await readlink(destination));
          if (currentTarget === source) {
            skipped++;
            continue;
          }
        }
      } catch {
        // Fall through to skip
      }
      skipped++;
      continue;
    }
    await symlink(source, destination, "dir");
    linked++;
  }

  return { message: `Linked ${linked}. Skipped ${skipped}.` };
}

export async function executeMoveToAgents(
  selected: SkillRecord[],
  roots: SkillRoot[],
  destinationScope: SkillScope,
): Promise<ActionResult> {
  const destinationRoot = rootFor(roots, "agents", destinationScope);
  if (!destinationRoot) throw new Error("Missing Agents destination root");
  await mkdir(destinationRoot.root, { recursive: true });

  let moved = 0;
  let skipped = 0;

  for (const item of selected) {
    const source = resolve(item.resolvedTarget ?? item.path);
    const destination = resolve(destinationRoot.root, basename(item.path));
    if (existsSync(destination)) {
      skipped++;
      continue;
    }

    await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
    await rm(item.path, { recursive: true, force: false });
    await symlink(destination, item.path, "dir");
    moved++;
  }

  return { message: `Moved ${moved}. Skipped ${skipped}.` };
}

export async function executeRestore(operation: DeletedOperation): Promise<ActionResult> {
  let restored = 0;
  for (const entry of operation.entries) {
    if (!existsSync(entry.trashPath)) continue;
    await restorePathFromTrash(entry.trashPath, entry.originalPath);
    restored++;
  }
  return { message: `Restored ${restored} path${restored === 1 ? "" : "s"}.` };
}
