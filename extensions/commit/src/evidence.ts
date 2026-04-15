import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const COMMAND_TIMEOUT_MS = 10_000;
const SUMMARY_MAX_CHARS = 4_000;
const SUMMARY_MAX_LINES = 200;
const DIFF_MAX_CHARS = 60_000;
const DIFF_MAX_LINES = 800;
const STATUS_MAX_LINES = 400;

export interface CommitEvidence {
  repoRoot: string;
  branch: string;
  headShort: string;
  headSubject: string;
  timestamp: string;
  changedPathCount: number;
  statusSnapshot: string;
  stagedSummary: string;
  unstagedSummary: string;
  stagedDiff: string;
  unstagedDiff: string;
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[\s\n]+$/g, "");
}

function maybeText(text: string): string | null {
  const normalized = cleanText(text).trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateText(text: string, maxChars: number, maxLines: number): string {
  const normalized = cleanText(text);
  const lines = normalized.length > 0 ? normalized.split("\n") : [];

  if (normalized.length <= maxChars && lines.length <= maxLines) return normalized;

  const kept: string[] = [];
  let usedChars = 0;

  for (const line of lines) {
    if (kept.length >= maxLines) break;
    const separator = kept.length === 0 ? 0 : 1;
    if (usedChars + separator + line.length > maxChars) break;
    kept.push(line);
    usedChars += separator + line.length;
  }

  let content = kept.join("\n");
  if (!content) content = normalized.slice(0, Math.max(0, maxChars));

  return `${content}\n[truncated: ${content.length}/${normalized.length} chars, ${Math.min(kept.length || 1, lines.length)}/${lines.length} lines]`;
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
    stagedSummaryRaw,
    unstagedSummaryRaw,
    stagedDiffRaw,
    unstagedDiffRaw,
  ] = await Promise.all([
    tryGit(pi, repoRoot, ["branch", "--show-current"]),
    tryGit(pi, repoRoot, ["rev-parse", "--short", "HEAD"]),
    tryGit(pi, repoRoot, ["log", "-1", "--pretty=%s"]),
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

  return {
    repoRoot,
    branch: branch ?? "(detached HEAD or unborn branch)",
    headShort: headShort ?? "(no commits yet)",
    headSubject: headSubject ?? "(no commits yet)",
    timestamp: new Date().toISOString(),
    changedPathCount: countStatusPaths(statusText),
    statusSnapshot: truncateText(statusText, SUMMARY_MAX_CHARS, STATUS_MAX_LINES),
    stagedSummary: truncateText(
      maybeText(stagedSummaryRaw) ?? "(none)",
      SUMMARY_MAX_CHARS,
      SUMMARY_MAX_LINES,
    ),
    unstagedSummary: truncateText(
      maybeText(unstagedSummaryRaw) ?? "(none)",
      SUMMARY_MAX_CHARS,
      SUMMARY_MAX_LINES,
    ),
    stagedDiff: truncateText(maybeText(stagedDiffRaw) ?? "(none)", DIFF_MAX_CHARS, DIFF_MAX_LINES),
    unstagedDiff: truncateText(
      maybeText(unstagedDiffRaw) ?? "(none)",
      DIFF_MAX_CHARS,
      DIFF_MAX_LINES,
    ),
  };
}
