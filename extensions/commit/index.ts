/**
 * Deterministic Commit Command Extension
 *
 * What this does:
 * - Adds a `/commit` command that snapshots git status, summaries, focused diffs,
 *   and a simple commit complexity score before the model starts working.
 * - Switches `/commit` to a lighter or stronger model based on the relative size
 *   and complexity of the evidence bundle, then restores the prior model after the run.
 * - Injects deterministic commit evidence so the model can group changes into
 *   semantic commits without re-inspecting the repository.
 *
 * How to use:
 * - Run `/commit` from inside a git repository with uncommitted changes.
 * - The extension gathers commit evidence, selects a `/commit` model profile,
 *   and asks the agent to create one or more semantic commits.
 *
 * Example:
 * - Update a feature, adjust docs, and include an unrelated refactor.
 * - Run `/commit`.
 * - The agent should split those edits into the smallest clear semantic commits.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const COMMAND_DESCRIPTION = "Create semantic git commit groupings from deterministic git evidence";
const COMMIT_TRIGGER_MESSAGE =
  "Create the git commit(s) from the injected /commit context only. First state the commit chunks you intend to make, then make them. Keep command output minimal: silence successful git commands and only show concise failure reasons. Do not run repository inspection commands.";
const SIMPLE_COMMIT_MODEL_PROVIDER = "openai-codex";
const SIMPLE_COMMIT_MODEL_ID = "gpt-5.4-mini";
const COMPLEX_COMMIT_MODEL_PROVIDER = "openai-codex";
const COMPLEX_COMMIT_MODEL_ID = "gpt-5.4";
const COMMIT_THINKING_LEVEL = "medium";
const COMMAND_TIMEOUT_MS = 15_000;
const DIFF_CONTEXT_LINES = 1;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_SUMMARY_LINES = 200;
const MAX_DIFF_SECTION_CHARS = 8_000;
const MAX_DIFF_SECTION_LINES = 300;
const MAX_TOTAL_DIFF_CHARS = 80_000;
const MIN_DIFF_BUDGET_CHARS = 1_500;
const MAX_FAILURE_LOG_LINES = 80;

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

interface CommitComplexity {
  score: number;
  complex: boolean;
  reasons: string[];
}

interface PendingCommitRun {
  prompt: string;
  restoreModelProvider?: string;
  restoreModelId?: string;
  restoreThinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
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

function getFileSliceOriginalChars(file: FileEvidence): number {
  return [file.stagedDiff, file.unstagedDiff, file.untrackedDiff].reduce(
    (total, slice) => total + (slice?.originalChars ?? 0),
    0,
  );
}

function getFileSliceOriginalLines(file: FileEvidence): number {
  return [file.stagedDiff, file.unstagedDiff, file.untrackedDiff].reduce(
    (total, slice) => total + (slice?.originalLines ?? 0),
    0,
  );
}

function hasTruncatedEvidence(file: FileEvidence): boolean {
  return [file.stagedDiff, file.unstagedDiff, file.untrackedDiff].some((slice) => slice?.truncated);
}

function classifyCommitComplexity(evidence: CommitEvidence): CommitComplexity {
  const fileCount = evidence.files.length;
  const partialCount = evidence.files.filter((file) => isPartiallyStaged(file.entry)).length;
  const untrackedCount = evidence.files.filter((file) => isUntracked(file.entry)).length;
  const truncatedCount = evidence.files.filter(hasTruncatedEvidence).length;
  const renameCount = evidence.files.filter((file) => !!file.entry.previousPath).length;
  const deleteCount = evidence.files.filter(
    (file) => file.entry.indexStatus === "D" || file.entry.worktreeStatus === "D",
  ).length;
  const conflictCount = evidence.files.filter(
    (file) => file.entry.indexStatus === "U" || file.entry.worktreeStatus === "U",
  ).length;
  const totalOriginalChars = evidence.files.reduce(
    (total, file) => total + getFileSliceOriginalChars(file),
    0,
  );
  const totalOriginalLines = evidence.files.reduce(
    (total, file) => total + getFileSliceOriginalLines(file),
    0,
  );
  const averageCharsPerFile = fileCount > 0 ? totalOriginalChars / fileCount : 0;
  const averageLinesPerFile = fileCount > 0 ? totalOriginalLines / fileCount : 0;

  const score =
    fileCount +
    Math.min(totalOriginalChars / 8_000, 6) +
    Math.min(totalOriginalLines / 260, 6) +
    partialCount * 2.5 +
    renameCount * 1.5 +
    deleteCount * 1.5 +
    conflictCount * 4 +
    truncatedCount * 2 +
    Math.min(untrackedCount, 3) * 0.25;

  const reasons: string[] = [];

  if (conflictCount > 0) reasons.push("merge conflict present");
  if (partialCount >= 2) reasons.push("multiple partially staged files");
  if (truncatedCount >= 2) reasons.push("evidence truncated across multiple files");
  if (fileCount >= 12) reasons.push("many changed files");
  if (fileCount >= 8 && renameCount + deleteCount >= 3) {
    reasons.push("broad structural churn across files");
  }
  if (fileCount >= 6 && (totalOriginalChars >= 18_000 || totalOriginalLines >= 500)) {
    reasons.push("multi-file change with substantial diff volume");
  }
  if (fileCount >= 4 && (totalOriginalChars >= 40_000 || totalOriginalLines >= 1_200)) {
    reasons.push("large diff spread across several files");
  }

  const complex = reasons.length > 0;

  return {
    score,
    complex,
    reasons,
  };
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
    "- First state the commit chunks you intend to create so you can verify the split before acting.",
    "- Build commit groups by semantic intent, not by file count or current stage state.",
    "- Put changes in the same commit when they implement one logical objective and should ship/revert together.",
    "- Split commits when groups are independently understandable, independently revertable, or represent different intents.",
    "- Keep tests, docs, config, and small support edits with the code they validate or explain.",
    "- Avoid a giant catch-all commit when evidence indicates unrelated work.",
    "- Prefer fewer commits when boundaries are weak, but do not force a single commit.",
    "- Treat staged vs unstaged as informational only.",
    "- Use the evidence below as your primary source of truth.",
    "- If this `/commit` run happens in an ongoing work session with prior task context, commit only the work that matches that prior context.",
    "- If this `/commit` run is cold and there is no meaningful prior context beyond this injected diff stream, treat the user's intent as committing all current changes.",
    "- When committing all current changes, still split the work into the smallest clear semantic commits you can justify from the evidence.",
    "- Keep creating those commits until the worktree is clean unless the evidence shows everything belongs in one commit.",
    "- Do not run repository inspection commands for planning (`git status`, `git diff`, `find`, `ls`, `cat`, `rg`, etc.).",
    "- Assume this evidence packet is authoritative for planning and grouping.",
    "- If evidence contains explicit truncation/omission markers and that blocks a safe decision, stop and ask the user for direction instead of probing the repo.",
    "- Execute commit creation, do not just describe a plan.",
    "- Use `git add -A` only when the next commit intentionally includes every remaining tracked and untracked change in the worktree.",
    "- If you are splitting work into multiple commits, stage each commit group with explicit file paths instead of `git add -A`.",
    '- For each commit group, stage and commit in one continuous shell step (for example: `git add path/to/file another/path && git diff --staged --name-status && git commit --quiet -m "..."`; use `git add -A` in that pattern only for an intentional commit-all group).',
    "- Do not pause between staging and committing to ask for confirmation when evidence already supports the grouping.",
    "- Keep shell/tool output compact. Prefer `--quiet` flags and avoid printing full patches or full hook/tool logs.",
    `- For commit commands, capture stdout/stderr to a temp log and only print a short tail (about ${MAX_FAILURE_LOG_LINES} lines) when a commit fails; on success print only a compact confirmation.`,
    "- Final response should be concise: only pass/fail per commit group, commit hash/message on success, and short reason on failure.",
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
  let pendingRun: PendingCommitRun | null = null;

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
      const complexity = classifyCommitComplexity(evidence);
      const targetModelId = complexity.complex ? COMPLEX_COMMIT_MODEL_ID : SIMPLE_COMMIT_MODEL_ID;
      const targetModel = ctx.modelRegistry.find(
        complexity.complex ? COMPLEX_COMMIT_MODEL_PROVIDER : SIMPLE_COMMIT_MODEL_PROVIDER,
        targetModelId,
      );

      ctx.ui.notify(
        complexity.complex
          ? `Commit model: ${targetModelId} (${complexity.reasons.join(", ")}; score ${complexity.score.toFixed(1)})`
          : `Commit model: ${targetModelId} (score ${complexity.score.toFixed(1)})`,
        "info",
      );

      pendingRun = {
        prompt,
        restoreModelProvider: ctx.model?.provider,
        restoreModelId: ctx.model?.id,
        restoreThinkingLevel: pi.getThinkingLevel(),
      };

      if (targetModel) {
        const switched = await pi.setModel(targetModel);
        if (!switched) {
          ctx.ui.notify(
            `Unable to switch /commit model to ${targetModel.provider}/${targetModel.id}.`,
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `Unable to find /commit model ${
            complexity.complex ? COMPLEX_COMMIT_MODEL_PROVIDER : SIMPLE_COMMIT_MODEL_PROVIDER
          }/${targetModelId}.`,
          "warning",
        );
      }

      pi.setThinkingLevel(COMMIT_THINKING_LEVEL);

      try {
        pi.sendUserMessage(COMMIT_TRIGGER_MESSAGE);
      } catch (error) {
        if (pendingRun?.restoreModelProvider && pendingRun?.restoreModelId) {
          const restoreModel = ctx.modelRegistry.find(
            pendingRun.restoreModelProvider,
            pendingRun.restoreModelId,
          );
          if (restoreModel) await pi.setModel(restoreModel);
        }
        pi.setThinkingLevel(pendingRun?.restoreThinkingLevel ?? "medium");
        pendingRun = null;

        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to start /commit run: ${message}`, "error");
      }
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (!pendingRun) return;

    const prompt = pendingRun.prompt;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${prompt}`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!pendingRun) return;

    const restore = pendingRun;
    pendingRun = null;

    if (restore.restoreModelProvider && restore.restoreModelId) {
      const model = ctx.modelRegistry.find(restore.restoreModelProvider, restore.restoreModelId);
      if (model) await pi.setModel(model);
    }

    pi.setThinkingLevel(restore.restoreThinkingLevel);
  });
}
