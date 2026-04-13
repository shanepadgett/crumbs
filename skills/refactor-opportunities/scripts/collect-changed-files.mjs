#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoDir = process.argv[2];
const outputPath = process.argv[3];

if (!repoDir || !outputPath) {
  console.error("Usage: node collect-changed-files.mjs <repo-dir> <output-path>");
  process.exit(1);
}

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "Podfile.lock",
  "Package.resolved",
]);

function git(args) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function parseNameStatusLine(line) {
  if (!line.trim()) return null;
  const parts = line.split("\t");
  const rawStatus = parts[0] ?? "";
  const status = rawStatus[0] ?? rawStatus;

  if (status === "R" || status === "C") {
    return {
      status,
      renamedFrom: parts[1] ?? null,
      path: parts[2] ?? null,
    };
  }

  return {
    status,
    renamedFrom: null,
    path: parts[1] ?? null,
  };
}

function classifyExcluded(path) {
  if (!path) return null;
  const lower = path.toLowerCase();
  const name = path.split("/").pop() ?? path;

  if (LOCKFILE_NAMES.has(name)) return "lockfile";
  if (
    lower.includes("/dist/") ||
    lower.includes("/build/") ||
    lower.includes("/.next/") ||
    lower.includes("/coverage/") ||
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css")
  ) {
    return "generated-artifact";
  }

  return null;
}

const repoRoot = git(["rev-parse", "--show-toplevel"]);
const gitStatus = git(["status", "--short", "--untracked-files=all"]);
const stagedRaw = git(["diff", "--cached", "--name-status", "--diff-filter=ACMR"]);
const unstagedRaw = git(["diff", "--name-status", "--diff-filter=ACMR"]);

const changedByPath = new Map();

for (const [source, raw] of [["staged", stagedRaw], ["unstaged", unstagedRaw]]) {
  for (const line of raw.split("\n")) {
    const parsed = parseNameStatusLine(line);
    if (!parsed?.path) continue;

    const entry = changedByPath.get(parsed.path) ?? {
      path: parsed.path,
      status: parsed.status,
      staged: false,
      unstaged: false,
      renamedFrom: parsed.renamedFrom,
    };

    entry.status = parsed.status;
    entry.renamedFrom = parsed.renamedFrom ?? entry.renamedFrom ?? null;
    entry[source] = true;
    changedByPath.set(parsed.path, entry);
  }
}

const changedFiles = [];
const excludedFiles = [];

for (const entry of [...changedByPath.values()].sort((a, b) => a.path.localeCompare(b.path))) {
  const reason = classifyExcluded(entry.path);
  if (reason) {
    excludedFiles.push({ path: entry.path, reason, status: entry.status, renamedFrom: entry.renamedFrom });
    continue;
  }
  changedFiles.push(entry);
}

const payload = {
  repoRoot: resolve(repoRoot),
  gitStatus,
  changedFiles,
  reviewedChangedFiles: changedFiles.map((entry) => entry.path),
  excludedFiles,
  counts: {
    changedFiles: changedFiles.length,
    excludedFiles: excludedFiles.length,
  },
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
console.log(`Collected ${changedFiles.length} changed files`);
