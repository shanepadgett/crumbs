import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const COMMAND_TIMEOUT_MS = 10_000;
const MAX_LIST_CHARS = 24_000;
const MAX_SUMMARY_CHARS = 16_000;
const MAX_DIFF_CHARS = 80_000;
const MAX_UNTRACKED_FILE_CHARS = 8_000;
const MAX_UNTRACKED_CONTENT_CHARS = 40_000;
const MIN_FOLDER_RENAME_FILES = 3;

export interface CommitEvidenceOptions {
  signal?: AbortSignal;
}

export interface CommitEvidence {
  repoRoot: string;
  branch: string;
  headShort: string;
  headSubject: string;
  timestamp: string;
  changedPathCount: number;
  folderRenameSummary: string;
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

function truncateSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const omittedChars = text.length - maxChars;
  const head = text.slice(0, Math.floor(maxChars * 0.65));
  const tail = text.slice(text.length - Math.floor(maxChars * 0.25));

  return [
    head.replace(/[\s\n]+$/g, ""),
    `\n[truncated ${omittedChars.toLocaleString()} chars from middle to keep /commit context bounded]\n`,
    tail.replace(/^[\s\n]+/g, ""),
  ].join("\n");
}

function maybeTruncatedText(text: string, maxChars: number): string {
  return maybeText(truncateSection(text, maxChars)) ?? "(none)";
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
  options: CommitEvidenceOptions = {},
  allowedCodes: number[] = [0],
): Promise<string> {
  throwIfAborted(options.signal);

  const result = await pi.exec("git", args, {
    cwd,
    timeout: COMMAND_TIMEOUT_MS,
    signal: options.signal,
  });

  throwIfAborted(options.signal);
  if (allowedCodes.includes(result.code)) return result.stdout;

  const detail = [maybeText(result.stderr), maybeText(result.stdout)].filter(Boolean).join("\n");
  throw new Error(detail || `git ${args.join(" ")} failed with exit code ${result.code}`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new Error("/commit cancelled.");
}

async function tryGit(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  options: CommitEvidenceOptions = {},
): Promise<string | null> {
  try {
    return maybeText(await runGit(pi, cwd, args, options));
  } catch {
    throwIfAborted(options.signal);
    return null;
  }
}

function parseNulList(output: string): string[] {
  return output.split("\0").filter(Boolean);
}

function formatUntrackedFiles(paths: string[]): string {
  return paths.length > 0 ? paths.join("\n") : "(none)";
}

function firstPathSegment(path: string): string | null {
  const [segment] = path.split("/").filter(Boolean);
  return segment ?? null;
}

function summarizeFolderRenames(...nameStatusOutputs: string[]): string {
  const counts = new Map<string, { from: string; to: string; count: number }>();

  for (const output of nameStatusOutputs) {
    for (const line of output.split("\n")) {
      const [status, oldPath, newPath] = line.split("\t");
      if (!status?.startsWith("R") || !oldPath || !newPath) continue;

      const from = firstPathSegment(oldPath);
      const to = firstPathSegment(newPath);
      if (!from || !to || from === to) continue;

      const key = `${from}\0${to}`;
      const current = counts.get(key) ?? { from, to, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
  }

  const candidates = [...counts.values()]
    .filter((candidate) => candidate.count >= MIN_FOLDER_RENAME_FILES)
    .sort((a, b) => b.count - a.count);

  if (candidates.length === 0) return "(none detected)";

  return candidates
    .map(
      (candidate) =>
        `- possible folder rename: ${candidate.from}/ -> ${candidate.to}/ (${candidate.count} renamed files)`,
    )
    .join("\n");
}

async function readUntrackedContents(
  repoRoot: string,
  paths: string[],
  options: CommitEvidenceOptions = {},
): Promise<string> {
  if (paths.length === 0) return "(none)";

  let totalChars = 0;
  const blocks = await Promise.all(
    paths.map(async (path) => {
      try {
        throwIfAborted(options.signal);
        const bytes = await readFile(join(repoRoot, path), { signal: options.signal });
        throwIfAborted(options.signal);
        if (bytes.includes(0)) return `--- ${path}\n[binary file content not embedded]`;
        const contents = truncateSection(bytes.toString("utf8"), MAX_UNTRACKED_FILE_CHARS);
        return `--- ${path}\n${contents}`;
      } catch (error) {
        throwIfAborted(options.signal);
        const message = error instanceof Error ? error.message : String(error);
        return `--- ${path}\n[unable to read untracked file: ${message}]`;
      }
    }),
  );

  const kept: string[] = [];
  let omitted = 0;
  for (const block of blocks) {
    if (totalChars + block.length > MAX_UNTRACKED_CONTENT_CHARS) {
      omitted += 1;
      continue;
    }
    kept.push(block);
    totalChars += block.length;
  }

  if (omitted > 0) {
    kept.push(
      `[omitted ${omitted} untracked file content block(s) to keep /commit context bounded]`,
    );
  }

  return kept.join("\n\n");
}

export async function collectCommitEvidence(
  pi: ExtensionAPI,
  cwd: string,
  options: CommitEvidenceOptions = {},
): Promise<CommitEvidence | null> {
  const repoRoot = await tryGit(pi, cwd, ["rev-parse", "--show-toplevel"], options);
  if (!repoRoot) return null;

  const git = (args: string[]) => runGit(pi, repoRoot, args, options);
  const maybeGit = (args: string[]) => tryGit(pi, repoRoot, args, options);

  const statusRaw = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
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
    maybeGit(["branch", "--show-current"]),
    maybeGit(["rev-parse", "--short", "HEAD"]),
    maybeGit(["log", "-1", "--pretty=%s"]),
    maybeGit(["log", "-12", "--pretty=format:%s"]),
    git(["ls-files", "--others", "--exclude-standard", "-z"]),
    hasStaged ? git(["diff", "--cached", "--name-status", "--find-renames", "--no-color"]) : "",
    hasUnstaged ? git(["diff", "--name-status", "--find-renames", "--no-color"]) : "",
    hasStaged ? git(["diff", "--cached", "--numstat", "--find-renames", "--no-color"]) : "",
    hasUnstaged ? git(["diff", "--numstat", "--find-renames", "--no-color"]) : "",
    hasStaged
      ? git([
          "diff",
          "--cached",
          "--stat",
          "--summary",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
        ])
      : "",
    hasUnstaged
      ? git(["diff", "--stat", "--summary", "--find-renames", "--no-color", "--no-ext-diff"])
      : "",
    hasStaged
      ? git([
          "diff",
          "--cached",
          "--unified=1",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
          "--submodule=diff",
        ])
      : "",
    hasUnstaged
      ? git([
          "diff",
          "--unified=1",
          "--find-renames",
          "--no-color",
          "--no-ext-diff",
          "--submodule=diff",
        ])
      : "",
  ]);

  throwIfAborted(options.signal);

  const untrackedPaths = parseNulList(untrackedFilesRaw);
  const folderRenameSummary = summarizeFolderRenames(stagedNameStatusRaw, unstagedNameStatusRaw);
  const untrackedContents = await readUntrackedContents(repoRoot, untrackedPaths, options);
  throwIfAborted(options.signal);

  return {
    repoRoot,
    branch: branch ?? "(detached HEAD or unborn branch)",
    headShort: headShort ?? "(no commits yet)",
    headSubject: headSubject ?? "(no commits yet)",
    timestamp: new Date().toISOString(),
    changedPathCount: countStatusPaths(statusText),
    folderRenameSummary,
    recentSubjects: maybeTruncatedText(recentSubjectsRaw ?? "(no commits yet)", MAX_LIST_CHARS),
    statusSnapshot: maybeTruncatedText(statusText, MAX_LIST_CHARS),
    stagedNameStatus: maybeTruncatedText(stagedNameStatusRaw, MAX_LIST_CHARS),
    unstagedNameStatus: maybeTruncatedText(unstagedNameStatusRaw, MAX_LIST_CHARS),
    stagedNumstat: maybeTruncatedText(stagedNumstatRaw, MAX_LIST_CHARS),
    unstagedNumstat: maybeTruncatedText(unstagedNumstatRaw, MAX_LIST_CHARS),
    stagedSummary: maybeTruncatedText(stagedSummaryRaw, MAX_SUMMARY_CHARS),
    unstagedSummary: maybeTruncatedText(unstagedSummaryRaw, MAX_SUMMARY_CHARS),
    stagedDiff: maybeTruncatedText(stagedDiffRaw, MAX_DIFF_CHARS),
    unstagedDiff: maybeTruncatedText(unstagedDiffRaw, MAX_DIFF_CHARS),
    untrackedFiles: maybeTruncatedText(formatUntrackedFiles(untrackedPaths), MAX_LIST_CHARS),
    untrackedContents,
  };
}
