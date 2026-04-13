import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { SkillRoot } from "./types.js";

export async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3_000 });
  if (result.code === 0) {
    const output = result.stdout.trim();
    if (output.length > 0) return output;
  }
  return cwd;
}

export function getSkillRoots(repoRoot: string): SkillRoot[] {
  return [
    {
      store: "agents",
      scope: "global",
      tab: "agents-global",
      root: resolve(homedir(), ".agents/skills"),
    },
    {
      store: "agents",
      scope: "project",
      tab: "agents-project",
      root: resolve(repoRoot, ".agents/skills"),
    },
    {
      store: "claude",
      scope: "global",
      tab: "claude-global",
      root: resolve(homedir(), ".claude/skills"),
    },
    {
      store: "claude",
      scope: "project",
      tab: "claude-project",
      root: resolve(repoRoot, ".claude/skills"),
    },
  ];
}

export function getDeletionLogPath(): string {
  return resolve(homedir(), ".agents/skills-manager/deletions.jsonl");
}

export function getTrashDir(): string {
  return resolve(homedir(), ".Trash");
}

export function getParentDir(path: string): string {
  return dirname(path);
}
