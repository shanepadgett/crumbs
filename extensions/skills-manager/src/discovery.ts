import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DeletedOperation, ManagerSnapshot, SkillRecord, SkillRoot } from "./types.js";
import { pruneDeletedOperations } from "./trash.js";

function parseSkillName(skillMarkdown: string, fallback: string): string {
  const fm = skillMarkdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fm) return fallback;
  const nameLine = fm[1]
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("name:"));
  if (!nameLine) return fallback;
  const raw = nameLine.slice("name:".length).trim();
  return raw.replace(/^['"]|['"]$/g, "") || fallback;
}

async function discoverSkillsInRoot(rootSpec: SkillRoot): Promise<SkillRecord[]> {
  if (!existsSync(rootSpec.root)) return [];

  const items: SkillRecord[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        try {
          const info = await stat(fullPath);
          if (!info.isDirectory()) continue;
          const skillFile = join(fullPath, "SKILL.md");
          if (!existsSync(skillFile)) continue;
          const fallbackName = fullPath.split("/").filter(Boolean).pop() ?? "unknown-skill";
          let name = fallbackName;
          let resolvedTarget: string | undefined;
          try {
            name = parseSkillName(await readFile(skillFile, "utf8"), fallbackName);
          } catch {
            // Keep fallback name
          }
          try {
            resolvedTarget = await realpath(fullPath);
          } catch {
            // Keep undefined
          }
          items.push({
            id: `${rootSpec.tab}:${fullPath}`,
            kind: "skill",
            name,
            path: fullPath,
            store: rootSpec.store,
            scope: rootSpec.scope,
            tab: rootSpec.tab,
            isSymlink: true,
            resolvedTarget,
            hasManagedDependents: false,
          });
        } catch {
          // Ignore broken symlink
        }
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile() || entry.name !== "SKILL.md") continue;

      const skillDir = dir;
      const fallbackName = skillDir.split("/").filter(Boolean).pop() ?? "unknown-skill";
      let name = fallbackName;
      let isSymlink = false;
      let resolvedTarget: string | undefined;
      try {
        name = parseSkillName(await readFile(fullPath, "utf8"), fallbackName);
      } catch {
        // Keep fallback name
      }
      try {
        const info = await lstat(skillDir);
        isSymlink = info.isSymbolicLink();
        if (isSymlink) resolvedTarget = await realpath(skillDir);
      } catch {
        // Keep defaults
      }
      items.push({
        id: `${rootSpec.tab}:${skillDir}`,
        kind: "skill",
        name,
        path: skillDir,
        store: rootSpec.store,
        scope: rootSpec.scope,
        tab: rootSpec.tab,
        isSymlink,
        resolvedTarget,
        hasManagedDependents: false,
      });
    }
  }

  await walk(rootSpec.root);
  return items;
}

export async function loadManagerSnapshot(
  roots: SkillRoot[],
  logPath: string,
): Promise<ManagerSnapshot> {
  const skills = (await Promise.all(roots.map((root) => discoverSkillsInRoot(root)))).flat();
  const byPath = new Map(skills.map((skill) => [skill.path, skill]));
  for (const skill of skills) {
    if (!skill.isSymlink || !skill.resolvedTarget) continue;
    const target = byPath.get(skill.resolvedTarget);
    if (target) target.hasManagedDependents = true;
  }
  const deletedOperations = await pruneDeletedOperations(logPath);
  skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  deletedOperations.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return { skills, deletedOperations };
}

export function formatDeletedOperationName(operation: DeletedOperation): string {
  const primary = operation.entries[0]?.name ?? "Deleted skill";
  const extra = operation.entries.length - 1;
  return extra > 0 ? `${primary} +${extra}` : primary;
}
