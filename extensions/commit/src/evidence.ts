import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const COMMAND_TIMEOUT_MS = 10_000;

export interface CommitEvidence {
  repoRoot: string;
  branch: string;
  headShort: string;
  headSubject: string;
  timestamp: string;
  changedPathCount: number;
  recentSubjects: string;
  statusSnapshot: string;
  stagedNameStatus: string;
  unstagedNameStatus: string;
  stagedNumstat: string;
  unstagedNumstat: string;
  stagedSummary: string;
  unstagedSummary: string;
  stagedDiff: string;
  unstagedDiff: string;
  untrackedFiles: string;
  untrackedContents: string;
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[\s\n]+$/g, "");
}

function maybeText(text: string): string | null {
  const normalized = cleanText(text).trim();
  return normalized.length > 0 ? normalized : null;
}

function countStatusPaths(statusOutput: string): number {
  return statusOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function statusHasStagedChanges(statusOutput: string): boolean {
  for (const line of statusOutput.split("\n")) {
    if (line.length < 2) continue;
    const indexStatus = line[0] ?? " ";
    if (indexStatus !== " " && indexStatus !== "?") return true;
  }
  return false;
}

function statusHasUnstagedChanges(statusOutput: string): boolean {
  for (const line of statusOutput.split("\n")) {
    if (line.length < 2) continue;
    const worktreeStatus = line[1] ?? " ";
    if (worktreeStatus !== " " && worktreeStatus !== "?") return true;
  }
  return false;
}

async function runGit(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  allowedCodes: number[] = [0],
): Promise<string> {
  const result = await pi.exec("git", args, { cwd, timeout: COMMAND_TIMEOUT_MS });
  if (allowedCodes.includes(result.code)) return result.stdout;

  const detail = [maybeText(result.stderr), maybeText(result.stdout)].filter(Boolean).join("\n");
  throw new Error(detail || `git ${args.join(" ")} failed with exit code ${result.code}`);
}

async function tryGit(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | null> {
  try {
    return maybeText(await runGit(pi, cwd, args));
  } catch {
    return null;
  }
}

function parseNulList(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function formatUntrackedFiles(paths: string[]): string {
  return paths.length > 0 ? paths.join("\n") : "(none)";
}

async function readUntrackedContents(repoRoot: string, paths: string[]): Promise<string> {
  if (paths.length === 0) return "(none)";

  const blocks = await Promise.all(
    paths.map(async (path) => {
      try {
        const bytes = await readFile(join(repoRoot, path));
        if (bytes.includes(0)) return `--- ${path}\n[binary file content not embedded]`;
        return `--- ${path}\n${bytes.toString("utf8")}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `--- ${path}\n[unable to read untracked file: ${message}]`;
      }
    }),
  );

  return blocks.join("\n\n");
}

export async function collectCommitEvidence(
  pi: ExtensionAPI,
  cwd: string,
): Promise<CommitEvidence | null> {
  const repoRoot = await tryGit(pi, cwd, ["rev-parse", "--show-toplevel"]);
  if (!repoRoot) return null;

  const statusRaw = await runGit(pi, repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const statusText = maybeText(statusRaw);
  if (!statusText) return null;

  const hasStaged = statusHasStagedChanges(statusText);
  const hasUnstaged = statusHasUnstagedChanges(statusText);

  const [
    branch,
    headShort,
    headSubject,
    recentSubjectsRaw,
    untrackedFilesRaw,
    stagedNameStatusRaw,
    unstagedNameStatusRaw,
    stagedNumstatRaw,
    unstagedNumstatRaw,
    stagedSummaryRaw,
    unstagedSummaryRaw,
    stagedDiffRaw,
    unstagedDiffRaw,
  ] = await Promise.all([
    tryGit(pi, repoRoot, ["branch", "--show-current"]),
    tryGit(pi, repoRoot, ["rev-parse", "--short", "HEAD"]),
    tryGit(pi, repoRoot, ["log", "-1", "--pretty=%s"]),
    tryGit(pi, repoRoot, ["log", "-12", "--pretty=format:%s"]),
    runGit(pi, repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    hasStaged
      ? runGit(pi, repoRoot, ["diff", "--cached", "--name-status", "--find-renames", "--no-color"])
      : Promise.resolve(""),
    hasUnstaged
      ? runGit(pi, repoRoot, ["diff", "--name-status", "--find-renames", "--no-color"])
      : Promise.resolve(""),
    hasStaged
      ? runGit(pi, repoRoot, ["diff", "--cached", "--numstat", "--find-renames", "--no-color"])
      : Promise.resolve(""),
    hasUnstaged
      ? runGit(pi, repoRoot, ["diff", "--numstat", "--find-renames", "--no-color"])
      : Promise.resolve(""),
    hasStaged
      ? runGit(pi, repoRoot, [
          "diff",
          "--cached",
          "--stat",
          "--summary",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
        ])
      : Promise.resolve(""),
    hasUnstaged
      ? runGit(pi, repoRoot, [
          "diff",
          "--stat",
          "--summary",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
        ])
      : Promise.resolve(""),
    hasStaged
      ? runGit(pi, repoRoot, [
          "diff",
          "--cached",
          "--unified=1",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
          "--submodule=diff",
        ])
      : Promise.resolve(""),
    hasUnstaged
      ? runGit(pi, repoRoot, [
          "diff",
          "--unified=1",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
          "--submodule=diff",
        ])
      : Promise.resolve(""),
  ]);

  const untrackedPaths = parseNulList(untrackedFilesRaw);
  const untrackedContents = await readUntrackedContents(repoRoot, untrackedPaths);

  return {
    repoRoot,
    branch: branch ?? "(detached HEAD or unborn branch)",
    headShort: headShort ?? "(no commits yet)",
    headSubject: headSubject ?? "(no commits yet)",
    timestamp: new Date().toISOString(),
    changedPathCount: countStatusPaths(statusText),
    recentSubjects: recentSubjectsRaw ?? "(no commits yet)",
    statusSnapshot: statusText,
    stagedNameStatus: maybeText(stagedNameStatusRaw) ?? "(none)",
    unstagedNameStatus: maybeText(unstagedNameStatusRaw) ?? "(none)",
    stagedNumstat: maybeText(stagedNumstatRaw) ?? "(none)",
    unstagedNumstat: maybeText(unstagedNumstatRaw) ?? "(none)",
    stagedSummary: maybeText(stagedSummaryRaw) ?? "(none)",
    unstagedSummary: maybeText(unstagedSummaryRaw) ?? "(none)",
    stagedDiff: maybeText(stagedDiffRaw) ?? "(none)",
    unstagedDiff: maybeText(unstagedDiffRaw) ?? "(none)",
    untrackedFiles: formatUntrackedFiles(untrackedPaths),
    untrackedContents,
  };
}
