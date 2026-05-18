import type { CommitConfig } from "./config.js";
import type { CommitEvidence } from "./evidence.js";

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function renderCommitPrompt(evidence: CommitEvidence, config: CommitConfig): string {
  const allowedTypes = config.allowedTypes.join(", ");
  const breakingChangeInstructions = config.allowBreakingChangeMarker
    ? [
        `- Allowed commit types: ${allowedTypes}.`,
        "- Choose only from allowed commit types.",
        "- You may add `!` after the type only for true breaking changes, e.g. `feat!: drop legacy config`.",
        "- Do not use `!` for broad internal refactors unless public or user-facing contract breaks.",
        "- If using `!`, include a `BREAKING CHANGE:` footer when evidence clearly identifies migration impact.",
      ]
    : [
        `- Allowed commit types: ${allowedTypes}.`,
        "- Choose only from allowed commit types.",
        "- Do not use the `!` breaking-change marker in commit subjects.",
      ];

  return [
    "BEGIN INJECTED /commit CONTEXT",
    "You are executing `/commit`.",
    "",
    "BEGIN BOUNDED GIT EVIDENCE PAYLOAD",
    "Repository:",
    `- repo root: ${evidence.repoRoot}`,
    `- branch: ${evidence.branch}`,
    `- HEAD: ${evidence.headShort} ${evidence.headSubject}`,
    `- snapshot timestamp: ${evidence.timestamp}`,
    `- changed paths: ${evidence.changedPathCount}`,
    "",
    "Recent commit subjects (`git log -12 --pretty=format:%s`):",
    indent(evidence.recentSubjects),
    "",
    "Raw status (`git status --porcelain=v1 --untracked-files=all`):",
    indent(evidence.statusSnapshot),
    "",
    "Folder rename candidates inferred from renamed files:",
    indent(evidence.folderRenameSummary),
    "",
    "Staged name/status (`git diff --cached --name-status --find-renames`):",
    indent(evidence.stagedNameStatus),
    "",
    "Unstaged name/status (`git diff --name-status --find-renames`):",
    indent(evidence.unstagedNameStatus),
    "",
    "Staged numstat (`git diff --cached --numstat --find-renames`):",
    indent(evidence.stagedNumstat),
    "",
    "Unstaged numstat (`git diff --numstat --find-renames`):",
    indent(evidence.unstagedNumstat),
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
    "Untracked files (`git ls-files --others --exclude-standard`):",
    indent(evidence.untrackedFiles),
    "",
    "Untracked file contents:",
    indent(evidence.untrackedContents),
    "",
    "END BOUNDED GIT EVIDENCE PAYLOAD",
    "",
    "FINAL /commit OPERATING INSTRUCTIONS:",
    "- The evidence payload above is complete source of truth for planning commits.",
    "- If folder rename candidates are present, treat repeated file renames under those paths as structural folder rename evidence rather than unrelated per-file changes.",
    "- Truncation markers mean evidence was shortened only to fit model context; use visible status, summaries, and rename candidates for intent.",
    "- Do not collect repository evidence yourself. Do not run `git status`, `git diff`, `git log`, `git show`, `ls`, `find`, `rg`, `grep`, `cat`, or any other inspection command.",
    "- Use shell only to stage and create commits from decisions made from injected evidence.",
    "- First print commit groups you intend to create (short bullets).",
    "- Then execute groups immediately.",
    "- Use semantic intent for grouping; keep related tests/docs/config with code they support.",
    "- If you decide there is only one commit group, use `git add -A` before commit.",
    "- If there are multiple commit groups, stage with explicit file paths (no `git add -A` until final intentional commit-all group).",
    "- Keep shell output minimal. Use quiet flags when available.",
    "- Match recent commit subject style when choosing messages.",
    "- Execute commits, do not stop at plan-only response.",
    "- Use unscoped conventional commit format: `type: concise why-action summary`.",
    ...breakingChangeInstructions,
    "- Final response concise: success/fail per group with commit hash + message, or short failure reason.",
    "",
    "END INJECTED /commit CONTEXT",
  ].join("\n");
}
