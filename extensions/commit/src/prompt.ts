import type { CommitEvidence } from "./evidence.js";

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function renderCommitPrompt(evidence: CommitEvidence): string {
  return [
    "BEGIN INJECTED /commit CONTEXT",
    "You are executing `/commit`.",
    "",
    "Rules:",
    "- First print commit groups you intend to create (short bullets).",
    "- Then execute groups immediately.",
    "- Use semantic intent for grouping; keep related tests/docs/config with code they support.",
    "- If you decide there is only one commit group, use `git add -A` before commit.",
    "- If there are multiple commit groups, stage with explicit file paths (no `git add -A` until final intentional commit-all group).",
    "- Keep shell output minimal. Use quiet flags when available.",
    "- Do not run repository inspection commands (`git status`, `git diff`, `ls`, `find`, `rg`, `cat`).",
    "- Use only injected evidence below for planning.",
    "- If evidence truncation blocks safe grouping, stop and ask user.",
    "- Execute commits, do not stop at plan-only response.",
    "- Use unscoped conventional commit format: `type: concise why-action summary`.",
    "- Final response concise: success/fail per group with commit hash + message, or short failure reason.",
    "",
    "Git snapshot:",
    `- repo root: ${evidence.repoRoot}`,
    `- branch: ${evidence.branch}`,
    `- HEAD: ${evidence.headShort} ${evidence.headSubject}`,
    `- snapshot timestamp: ${evidence.timestamp}`,
    `- changed paths: ${evidence.changedPathCount}`,
    "",
    "Raw status (`git status --porcelain=v1 --untracked-files=all`):",
    indent(evidence.statusSnapshot),
    "",
    "Staged summary (`git diff --cached --stat --summary`):",
    indent(evidence.stagedSummary),
    "",
    "Unstaged summary (`git diff --stat --summary`):",
    indent(evidence.unstagedSummary),
    "",
    "Staged diff (`git diff --cached --unified=1`):",
    indent(evidence.stagedDiff),
    "",
    "Unstaged diff (`git diff --unified=1`):",
    indent(evidence.unstagedDiff),
    "",
    "END INJECTED /commit CONTEXT",
  ].join("\n");
}
