/**
 * Skills prune extension.
 *
 * What it does: interactively finds and deletes skills from ~/.agents/skills
 * and project .agents/skills.
 *
 * How to use it: run /skills-prune in interactive mode. Use Space/Enter to
 * toggle skills, d to delete, and Esc to cancel.
 */
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

type SkillScope = "user" | "project";

interface SkillItem {
  id: string;
  name: string;
  scope: SkillScope;
  skillDir: string;
}

interface RootSpec {
  scope: SkillScope;
  root: string;
}

interface SelectorResult {
  action: "cancel" | "delete";
  selectedIds: string[];
}

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

async function discoverSkillsInRoot(root: string, scope: SkillScope): Promise<SkillItem[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  if (!existsSync(root)) return [];

  const items: SkillItem[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "SKILL.md") continue;

      const skillDir = dir;
      const fallbackName = skillDir.split("/").filter(Boolean).pop() ?? "unknown-skill";
      let name = fallbackName;
      try {
        const content = await readFile(fullPath, "utf8");
        name = parseSkillName(content, fallbackName);
      } catch {
        // Keep fallback name
      }
      items.push({
        id: `${scope}:${skillDir}`,
        name,
        scope,
        skillDir,
      });
    }
  }

  await walk(root);
  return items;
}

function isPathWithinRoot(targetPath: string, root: string): boolean {
  const rel = relative(root, targetPath);
  if (rel === "") return false;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3_000 });
  if (result.code === 0) {
    const out = result.stdout.trim();
    if (out.length > 0) return out;
  }
  return cwd;
}

async function runSelector(
  ctx: ExtensionContext,
  skills: SkillItem[],
  selectedIds: Set<string>,
): Promise<SelectorResult> {
  return ctx.ui.custom<SelectorResult>((tui, theme, _kb, done) => {
    let cursor = 0;
    const selected = new Set(selectedIds);

    return {
      handleInput(data: string) {
        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down)) {
          cursor = Math.min(skills.length - 1, cursor + 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
          const id = skills[cursor]?.id;
          if (!id) return;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          tui.requestRender();
          return;
        }
        if (data.toLowerCase() === "d") {
          done({ action: "delete", selectedIds: [...selected] });
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done({ action: "cancel", selectedIds: [...selected] });
        }
      },
      render(width: number) {
        const lines: string[] = [];
        lines.push(truncateToWidth(theme.fg("accent", theme.bold("Skills Prune")), width));
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              `Space/Enter toggle • d delete selected • Esc cancel • ${selected.size}/${skills.length} selected`,
            ),
            width,
          ),
        );
        lines.push("");

        if (skills.length === 0) {
          lines.push(truncateToWidth(theme.fg("warning", "No skills found."), width));
          return lines;
        }

        for (let i = 0; i < skills.length; i++) {
          const skill = skills[i]!;
          const isCurrent = i === cursor;
          const marker = isCurrent ? theme.fg("accent", "❯") : " ";
          const checkbox = selected.has(skill.id)
            ? theme.fg("success", "[x]")
            : theme.fg("dim", "[ ]");
          const scopeColor = skill.scope === "user" ? "warning" : "accent";
          const scope = theme.fg(scopeColor, `[${skill.scope}]`);
          const name = isCurrent ? theme.fg("accent", skill.name) : theme.fg("text", skill.name);
          const line = `${marker} ${checkbox} ${scope} ${name} ${theme.fg("dim", `(${skill.skillDir})`)}`;
          lines.push(truncateToWidth(line, width));
        }

        return lines;
      },
      invalidate() {},
    };
  });
}

export default function skillsPruneExtension(pi: ExtensionAPI) {
  pi.registerCommand("skills-prune", {
    description: "Multi-select and delete skills from ~/.agents/skills and project .agents/skills",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/skills-prune requires interactive mode", "error");
        return;
      }

      const repoRoot = await getRepoRoot(pi, ctx.cwd);
      const roots: RootSpec[] = [
        { scope: "user", root: resolve(homedir(), ".agents/skills") },
        { scope: "project", root: resolve(repoRoot, ".agents/skills") },
      ];

      const discovered = (
        await Promise.all(roots.map((r) => discoverSkillsInRoot(r.root, r.scope)))
      ).flat();

      const skills = discovered.sort((a, b) => {
        if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
        return a.name.localeCompare(b.name);
      });

      if (skills.length === 0) {
        ctx.ui.notify("No skills found in ~/.agents/skills or project .agents/skills", "info");
        return;
      }

      let selectedIds = new Set<string>();
      while (true) {
        const choice = await runSelector(ctx, skills, selectedIds);
        if (choice.action === "cancel") return;
        selectedIds = new Set(choice.selectedIds);

        const selectedSkills = skills.filter((skill) => selectedIds.has(skill.id));
        if (selectedSkills.length === 0) {
          ctx.ui.notify("No skills selected", "warning");
          continue;
        }

        const preview = selectedSkills
          .slice(0, 8)
          .map((s) => `• [${s.scope}] ${s.name}`)
          .join("\n");
        const more =
          selectedSkills.length > 8 ? `\n• ... and ${selectedSkills.length - 8} more` : "";
        const confirmed = await ctx.ui.confirm(
          "Delete selected skills?",
          `${preview}${more}\n\nThis will permanently delete these skill directories from disk.`,
        );
        if (!confirmed) continue;

        let deleted = 0;
        const failures: string[] = [];

        for (const skill of selectedSkills) {
          const scopeRoot = roots.find((r) => r.scope === skill.scope)?.root;
          if (!scopeRoot) {
            failures.push(`[${skill.scope}] ${skill.name}: missing scope root`);
            continue;
          }
          const target = resolve(skill.skillDir);
          if (!isPathWithinRoot(target, scopeRoot)) {
            failures.push(`[${skill.scope}] ${skill.name}: refused (outside allowed root)`);
            continue;
          }

          try {
            await rm(target, { recursive: true, force: false });
            deleted++;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`[${skill.scope}] ${skill.name}: ${message}`);
          }
        }

        if (failures.length === 0) {
          ctx.ui.notify(`Deleted ${deleted} skill${deleted === 1 ? "" : "s"}.`, "info");
        } else {
          ctx.ui.notify(`Deleted ${deleted}. Failed ${failures.length}.`, "warning");
          ctx.ui.notify(failures.slice(0, 2).join(" | "), "error");
        }
        return;
      }
    },
  });
}
