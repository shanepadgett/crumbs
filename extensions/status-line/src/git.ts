import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GitSummary } from "./types.js";

const GIT_TIMEOUT_MS = 1000;
const UNMERGED_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function parseGitStatus(stdout: string): GitSummary {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## ")) ?? "## detached";
  const branch = branchLine
    .replace(/^## /, "")
    .replace(/\.\.\..*$/, "")
    .replace(/^HEAD \(no branch\)$/, "detached")
    .trim();

  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicts = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) continue;

    const indexStatus = line[0] ?? " ";
    const worktreeStatus = line[1] ?? " ";

    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked += 1;
      continue;
    }

    if (UNMERGED_STATUSES.has(`${indexStatus}${worktreeStatus}`)) {
      conflicts += 1;
      continue;
    }

    if (indexStatus !== " ") staged += 1;
    if (worktreeStatus !== " ") modified += 1;
  }

  const parts: string[] = [];
  if (staged > 0) parts.push(`+${staged}`);
  if (modified > 0) parts.push(`~${modified}`);
  if (untracked > 0) parts.push(`?${untracked}`);
  if (conflicts > 0) parts.push(`!${conflicts}`);

  return {
    branch: branch || "detached",
    summary: parts.length > 0 ? parts.join(" ") : "clean",
  };
}

export async function loadGitSummary(pi: ExtensionAPI, cwd: string): Promise<GitSummary> {
  const result = await pi.exec(
    "git",
    ["--no-optional-locks", "status", "--porcelain=v1", "--branch", "--untracked-files=all"],
    { cwd, timeout: GIT_TIMEOUT_MS },
  );

  if (result.code !== 0) return { branch: "", summary: "" };
  return parseGitStatus(result.stdout);
}
