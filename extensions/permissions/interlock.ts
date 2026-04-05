import type { InterlockMatch } from "./types.js";

const COMMAND_PATTERNS: Array<{ pattern: RegExp; label: string; reason: string }> = [
  {
    pattern: /(^|\s)rm\s+-rf(\s|$)/,
    label: "rm -rf",
    reason: "Recursive deletion can destroy large parts of the repo or filesystem.",
  },
  {
    pattern: /(^|\s)find\b[^\n]*\s-delete(\s|$)/,
    label: "find -delete",
    reason: "find -delete can remove many files at once.",
  },
  {
    pattern: /(^|\s)git\s+reset\s+--hard(\s|$)/,
    label: "git reset --hard",
    reason: "This discards tracked changes.",
  },
  {
    pattern: /(^|\s)git\s+clean\s+-f[dDxX]*(\s|$)/,
    label: "git clean",
    reason: "This removes untracked files and directories.",
  },
  {
    pattern: /(^|\s)git\s+filter-repo(\s|$)/,
    label: "git filter-repo",
    reason: "This rewrites repository history.",
  },
  {
    pattern: /(^|\s)git\s+filter-branch(\s|$)/,
    label: "git filter-branch",
    reason: "This rewrites repository history.",
  },
  {
    pattern: /(^|\s)git\s+push\b[^\n]*--force(\s|$)/,
    label: "git push --force",
    reason: "This can overwrite remote history.",
  },
  {
    pattern: /(^|\s)git\s+update-ref(\s|$)/,
    label: "git update-ref",
    reason: "This directly mutates git refs.",
  },
  {
    pattern:
      /(^|\s)(aws|gcloud|az|kubectl|terraform|psql|mysql|mongosh|redis-cli|ssh|scp|sftp)(\s|$)/,
    label: "infra/admin command",
    reason: "Infrastructure, database, and remote access commands require stronger intent.",
  },
];

export function findInterlockMatch(command: string): InterlockMatch | null {
  for (const entry of COMMAND_PATTERNS) {
    if (entry.pattern.test(command)) {
      return { label: entry.label, reason: entry.reason };
    }
  }

  return null;
}
