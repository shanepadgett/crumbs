/**
 * Deterministic Commit Command Extension
 *
 * What this does:
 * - Adds a `/commit` command that snapshots git status, summaries, and focused
 *   per-file diffs before the model starts working.
 * - Injects those instructions and that evidence into the commit turn so the
 *   model can usually decide commit boundaries without first rediscovering the
 *   repository state.
 * - Guides the model to group semantically related edits together and split
 *   independent work into separate commits when that makes review/revert safer.
 *
 * How to use:
 * - Run `/commit` from inside a git repository with uncommitted changes.
 * - The extension gathers a deterministic evidence packet and asks the agent to
 *   create one or more semantic commits.
 *
 * Example:
 * - Update a feature, adjust docs, and include an unrelated refactor.
 * - Run `/commit`.
 * - The agent should keep the feature + docs together and split the unrelated
 *   refactor into its own commit.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const COMMAND_DESCRIPTION = "Create semantic git commit groupings from deterministic git evidence";
const COMMIT_TRIGGER_MESSAGE =
  "Create the git commit(s) from the injected /commit context only. Do not run repository inspection commands.";
const COMMAND_TIMEOUT_MS = 15_000;
const DIFF_CONTEXT_LINES = 1;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_SUMMARY_LINES = 200;
const MAX_DIFF_SECTION_CHARS = 8_000;
const MAX_DIFF_SECTION_LINES = 300;
const MAX_TOTAL_DIFF_CHARS = 80_000;
const MIN_DIFF_BUDGET_CHARS = 1_500;

type OptionalText = string | null;

interface StatusEntry {
  rawLine: string;
  path: string;
  previousPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}

interface DiffBudget {
  remainingChars: number;
}

interface TextSlice {
  content: string;
  truncated: boolean;
  originalChars: number;
  originalLines: number;
}

interface FileEvidence {
  entry: StatusEntry;
  stagedDiff?: TextSlice;
  unstagedDiff?: TextSlice;
  untrackedDiff?: TextSlice;
}

interface CommitEvidence {
  repoRoot: string;
  branch: string;
  headShort: string;
  headSubject: string;
  timestamp: string;
  files: FileEvidence[];
  statusLines: string[];
  stagedSummary: string;
  unstagedSummary: string;
  diffBudgetRemainingChars: number;
}

const STATUS_LABELS: Record<string, string> = {
  " ": "clean",
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
  "?": "untracked",
  "!": "ignored",
};

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[\s\n]+$/g, "");
}

function maybeText(text: string): OptionalText {
  const normalized = cleanText(text).trim();
  return normalized.length > 0 ? normalized : null;
}

function describeStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function hasStagedChanges(entry: StatusEntry): boolean {
  return entry.indexStatus !== " " && entry.indexStatus !== "?";
}

function hasUnstagedChanges(entry: StatusEntry): boolean {
  return entry.worktreeStatus !== " " && entry.worktreeStatus !== "?";
}

function isUntracked(entry: StatusEntry): boolean {
  return entry.indexStatus === "?" && entry.worktreeStatus === "?";
}

function isPartiallyStaged(entry: StatusEntry): boolean {
  return hasStagedChanges(entry) && hasUnstagedChanges(entry);
}

function formatPath(entry: StatusEntry): string {
  return entry.previousPath ? `${entry.previousPath} -> ${entry.path}` : entry.path;
}

function getEntryClassifications(entry: StatusEntry): string[] {
  const values = new Set<string>();

  if (isUntracked(entry)) values.add("untracked");
  else if (isPartiallyStaged(entry)) values.add("partially staged");
  else if (hasStagedChanges(entry)) values.add("staged only");
  else if (hasUnstagedChanges(entry)) values.add("unstaged only");

  if (entry.previousPath) values.add("rename");
  if (entry.indexStatus === "A" || entry.worktreeStatus === "A") values.add("add");
  if (entry.indexStatus === "M" || entry.worktreeStatus === "M") values.add("modify");
  if (entry.indexStatus === "D" || entry.worktreeStatus === "D") values.add("delete");
  if (entry.indexStatus === "R" || entry.worktreeStatus === "R") values.add("rename");
  if (entry.indexStatus === "C" || entry.worktreeStatus === "C") values.add("copy");
  if (entry.indexStatus === "T" || entry.worktreeStatus === "T") values.add("type change");
  if (entry.indexStatus === "U" || entry.worktreeStatus === "U") values.add("conflict");

  return [...values];
}

function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function truncateText(text: string, maxChars: number, maxLines: number): TextSlice {
  const normalized = cleanText(text);
  const lines = normalized.length > 0 ? normalized.split("\n") : [];

  if (normalized.length <= maxChars && lines.length <= maxLines) {
    return {
      content: normalized,
      truncated: false,
      originalChars: normalized.length,
      originalLines: lines.length,
    };
  }

  const keptLines: string[] = [];
  let usedChars = 0;

  for (const line of lines) {
    if (keptLines.length >= maxLines) break;

    const separatorLength = keptLines.length === 0 ? 0 : 1;
    if (usedChars + separatorLength + line.length > maxChars) break;

    keptLines.push(line);
    usedChars += separatorLength + line.length;
  }

  let content = keptLines.join("\n");
  if (content.length === 0) {
    content = normalized.slice(0, Math.max(0, maxChars));
  }

  const notice = `[truncated: showing ${content.length} of ${normalized.length} chars across at most ${Math.min(
    keptLines.length || (content.length > 0 ? 1 : 0),
    lines.length,
  )} of ${lines.length} lines]`;

  return {
    content: content.length > 0 ? `${content}\n${notice}` : notice,
    truncated: true,
    originalChars: normalized.length,
    originalLines: lines.length,
  };
}

function summarizeText(text: string, fallback = "(none)"): string {
  const normalized = maybeText(text);
  if (!normalized) return fallback;
  return truncateText(normalized, MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES).content;
}

function takeDiffSlice(text: string, budget: DiffBudget): TextSlice | undefined {
  const normalized = maybeText(text);
  if (!normalized) return undefined;

  if (budget.remainingChars < MIN_DIFF_BUDGET_CHARS) {
    return {
      content: `[omitted: evidence budget exhausted before this diff; inspect only if truly necessary]`,
      truncated: true,
      originalChars: normalized.length,
      originalLines: normalized.split("\n").length,
    };
  }

  const slice = truncateText(
    normalized,
    Math.min(MAX_DIFF_SECTION_CHARS, budget.remainingChars),
    MAX_DIFF_SECTION_LINES,
  );
  budget.remainingChars = Math.max(0, budget.remainingChars - slice.content.length);
  return slice;
}

function parseStatusEntries(statusOutput: string): StatusEntry[] {
  const tokens = statusOutput.split("\0");
  const entries: StatusEntry[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token.length < 4) continue;

    const indexStatus = token[0] ?? " ";
    const worktreeStatus = token[1] ?? " ";
    const path = token.slice(3);
    if (!path) continue;

    let previousPath: string | undefined;
    if (
      indexStatus === "R" ||
      indexStatus === "C" ||
      worktreeStatus === "R" ||
      worktreeStatus === "C"
    ) {
      const renameSource = tokens[index + 1] ?? "";
      if (renameSource.length > 0) {
        previousPath = renameSource;
        index += 1;
      }
    }

    const rawLine = `${indexStatus}${worktreeStatus} ${
      previousPath ? `${previousPath} -> ${path}` : path
    }`;

    entries.push({ rawLine, path, previousPath, indexStatus, worktreeStatus });
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function getPathArgs(entry: StatusEntry): string[] {
  return entry.previousPath ? [entry.previousPath, entry.path] : [entry.path];
}

async function runGitText(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  allowedCodes: number[] = [0],
): Promise<string> {
  const result = await pi.exec("git", args, { cwd, timeout: COMMAND_TIMEOUT_MS });
  if (allowedCodes.includes(result.code)) return result.stdout;

  const stderr = maybeText(result.stderr);
  const stdout = maybeText(result.stdout);
  const details = [stderr, stdout].filter(Boolean).join("\n");
  throw new Error(details || `git ${args.join(" ")} failed with exit code ${result.code}`);
}

async function tryGitText(
  pi: ExtensionAPI,
  cwd: string,
  args: string[],
  allowedCodes: number[] = [0],
): Promise<OptionalText> {
  try {
    const stdout = await runGitText(pi, cwd, args, allowedCodes);
    return maybeText(stdout);
  } catch {
    return null;
  }
}

async function collectCommitEvidence(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<CommitEvidence | null> {
  const repoRootText = await tryGitText(pi, ctx.cwd, ["rev-parse", "--show-toplevel"]);
  if (!repoRootText) return null;

  const repoRoot = repoRootText;
  const statusOutput = await runGitText(pi, repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const statusEntries = parseStatusEntries(statusOutput);
  if (statusEntries.length === 0) return null;

  const branch =
    (await tryGitText(pi, repoRoot, ["branch", "--show-current"])) ??
    "(detached HEAD or unborn branch)";
  const headShort =
    (await tryGitText(pi, repoRoot, ["rev-parse", "--short", "HEAD"])) ?? "(no commits yet)";
  const headSubject =
    (await tryGitText(pi, repoRoot, ["log", "-1", "--pretty=%s"])) ?? "(no commits yet)";

  const stagedSummaryRaw = await runGitText(pi, repoRoot, [
    "diff",
    "--cached",
    "--stat",
    "--summary",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);
  const unstagedSummaryRaw = await runGitText(pi, repoRoot, [
    "diff",
    "--stat",
    "--summary",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  const diffBudget: DiffBudget = { remainingChars: MAX_TOTAL_DIFF_CHARS };
  const files: FileEvidence[] = [];

  for (const entry of statusEntries) {
    const fileEvidence: FileEvidence = { entry };

    if (hasStagedChanges(entry)) {
      const stagedDiffRaw = await runGitText(pi, repoRoot, [
        "diff",
        "--cached",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--find-renames",
        "--no-color",
        "--no-ext-diff",
        "--submodule=diff",
        "--",
        ...getPathArgs(entry),
      ]);
      fileEvidence.stagedDiff = takeDiffSlice(stagedDiffRaw, diffBudget);
    }

    if (hasUnstagedChanges(entry)) {
      const unstagedDiffRaw = await runGitText(pi, repoRoot, [
        "diff",
        `--unified=${DIFF_CONTEXT_LINES}`,
        "--find-renames",
        "--no-color",
        "--no-ext-diff",
        "--submodule=diff",
        "--",
        ...getPathArgs(entry),
      ]);
      fileEvidence.unstagedDiff = takeDiffSlice(unstagedDiffRaw, diffBudget);
    }

    if (isUntracked(entry)) {
      const untrackedDiffRaw = await runGitText(
        pi,
        repoRoot,
        [
          "diff",
          "--no-index",
          `--unified=${DIFF_CONTEXT_LINES}`,
          "--no-color",
          "--no-ext-diff",
          "--submodule=diff",
          "--",
          "/dev/null",
          entry.path,
        ],
        [0, 1],
      );
      fileEvidence.untrackedDiff = takeDiffSlice(untrackedDiffRaw, diffBudget);
    }

    files.push(fileEvidence);
  }

  return {
    repoRoot,
    branch,
    headShort,
    headSubject,
    timestamp: new Date().toISOString(),
    files,
    statusLines: statusEntries.map((entry) => entry.rawLine),
    stagedSummary: summarizeText(stagedSummaryRaw),
    unstagedSummary: summarizeText(unstagedSummaryRaw),
    diffBudgetRemainingChars: diffBudget.remainingChars,
  };
}

function formatGroup(title: string, entries: StatusEntry[]): string[] {
  const lines = [`- ${title} (${entries.length})`];
  if (entries.length === 0) {
    lines.push("  - (none)");
    return lines;
  }

  for (const entry of entries) {
    lines.push(`  - ${formatPath(entry)}`);
  }
  return lines;
}

function renderCommitPrompt(evidence: CommitEvidence): string {
  const stagedOnly = evidence.files
    .map((file) => file.entry)
    .filter((entry) => hasStagedChanges(entry) && !hasUnstagedChanges(entry));
  const unstagedOnly = evidence.files
    .map((file) => file.entry)
    .filter((entry) => hasUnstagedChanges(entry) && !hasStagedChanges(entry));
  const partiallyStaged = evidence.files
    .map((file) => file.entry)
    .filter((entry) => isPartiallyStaged(entry));
  const untracked = evidence.files.map((file) => file.entry).filter((entry) => isUntracked(entry));

  const lines: string[] = [
    "BEGIN INJECTED /commit CONTEXT",
    "You are executing the `/commit` command.",
    "",
    "Commit behavior:",
    "- Build commit groups by semantic intent, not by file count or current stage state.",
    "- Put changes in the same commit when they implement one logical objective and should ship/revert together.",
    "- Split commits when groups are independently understandable, independently revertable, or represent different intents.",
    "- Keep tests, docs, config, and small support edits with the code they validate or explain.",
    "- Avoid a giant catch-all commit when evidence indicates unrelated work.",
    "- Prefer fewer commits when boundaries are weak, but do not force a single commit.",
    "- Treat staged vs unstaged as informational only.",
    "- Use the evidence below as your primary source of truth.",
    "- Do not run repository inspection commands for planning (`git status`, `git diff`, `find`, `ls`, `cat`, `rg`, etc.).",
    "- Assume this evidence packet is authoritative for planning and grouping.",
    "- If evidence contains explicit truncation/omission markers and that blocks a safe decision, stop and ask the user for direction instead of probing the repo.",
    "- Execute commit creation, do not just describe a plan.",
    '- For each commit group, stage and commit in one continuous shell step (for example: `git add <paths> && git diff --staged -- <paths> && git commit -m "..."`).',
    "- Do not pause between staging and committing to ask for confirmation when evidence already supports the grouping.",
    "- Use unscoped conventional commit messages in the form `type: concise why-action summary`.",
    "- If there are multiple groups, create commits in an order that keeps intermediate history coherent.",
    "- Allowed shell operations are only those needed to stage, validate staged content, and commit.",
    "",
    "Deterministic git evidence snapshot:",
    `- repo root: ${evidence.repoRoot}`,
    `- branch: ${evidence.branch}`,
    `- HEAD: ${evidence.headShort} ${evidence.headSubject}`,
    `- snapshot timestamp: ${evidence.timestamp}`,
    `- changed paths: ${evidence.files.length}`,
    `- unused diff evidence budget: ${evidence.diffBudgetRemainingChars} chars`,
    "",
    "Status groups:",
    ...formatGroup("staged only", stagedOnly),
    ...formatGroup("unstaged only", unstagedOnly),
    ...formatGroup("partially staged", partiallyStaged),
    ...formatGroup("untracked", untracked),
    "",
    "Raw `git status --porcelain=v1` snapshot:",
    ...indentBlock(
      evidence.statusLines.length > 0 ? evidence.statusLines.join("\n") : "(none)",
    ).split("\n"),
    "",
    "Staged diff summary (`git diff --cached --stat --summary`):",
    ...indentBlock(evidence.stagedSummary).split("\n"),
    "",
    "Unstaged diff summary (`git diff --stat --summary`):",
    ...indentBlock(evidence.unstagedSummary).split("\n"),
    "",
    "Per-file evidence:",
  ];

  for (const file of evidence.files) {
    const entry = file.entry;
    lines.push(`FILE ${formatPath(entry)}`);
    lines.push(
      `  status: index=${entry.indexStatus} (${describeStatus(entry.indexStatus)}), worktree=${entry.worktreeStatus} (${describeStatus(
        entry.worktreeStatus,
      )})`,
    );
    lines.push(`  classifications: ${getEntryClassifications(entry).join(", ") || "(none)"}`);

    if (file.stagedDiff) {
      lines.push("  staged diff:");
      lines.push(indentBlock(file.stagedDiff.content, "    "));
    }

    if (file.unstagedDiff) {
      lines.push("  unstaged diff:");
      lines.push(indentBlock(file.unstagedDiff.content, "    "));
    }

    if (file.untrackedDiff) {
      lines.push("  untracked diff:");
      lines.push(indentBlock(file.untrackedDiff.content, "    "));
    }

    lines.push("");
  }

  lines.push("END INJECTED /commit CONTEXT");
  return lines.join("\n").trimEnd();
}

export default function commitExtension(pi: ExtensionAPI): void {
  let pendingPrompt: string | null = null;

  pi.registerCommand("commit", {
    description: COMMAND_DESCRIPTION,
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      let evidence: CommitEvidence | null;
      try {
        evidence = await collectCommitEvidence(pi, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to prepare commit evidence: ${message}`, "error");
        return;
      }

      if (!evidence) {
        ctx.ui.notify("No git repository found or no uncommitted changes detected.", "info");
        return;
      }

      const prompt = renderCommitPrompt(evidence);
      pendingPrompt = prompt;

      try {
        pi.sendUserMessage(COMMIT_TRIGGER_MESSAGE);
      } catch (error) {
        pendingPrompt = null;

        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to start /commit run: ${message}`, "error");
      }
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!pendingPrompt) return;

    const prompt = pendingPrompt;
    pendingPrompt = null;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${prompt}`,
    };
  });
}
