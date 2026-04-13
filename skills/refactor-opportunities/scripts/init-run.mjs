#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const manifestPath = process.argv[2];

if (!manifestPath) {
  console.error("Usage: node init-run.mjs <manifest-path>");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const paths = manifest.paths ?? {};

for (const dirPath of [
  dirname(manifestPath),
  manifest.artifactRoot,
  manifest.runDir,
  paths.findings,
  paths.compiled,
  paths.normalized,
  paths.plans,
  dirname(paths.reconciled ?? ""),
  dirname(paths.churn ?? ""),
  dirname(paths.plan ?? ""),
  dirname(manifest.historyPath ?? ""),
]) {
  if (dirPath) mkdirSync(dirPath, { recursive: true });
}

for (const lens of Object.keys(manifest.lenses ?? {})) {
  mkdirSync(join(paths.findings, lens), { recursive: true });
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
console.log(`Initialized review run: ${manifest.runId ?? "unknown"}`);
