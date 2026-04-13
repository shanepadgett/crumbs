#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node detect-languages-from-files.mjs <changed-files-json> <output-path>");
  process.exit(1);
}

const EXT_TO_STACK = new Map([
  [".swift", "swift-swiftui"],
  [".java", "java"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".go", "go"],
  [".rs", "rust"],
]);

const counts = {
  "swift-swiftui": 0,
  java: 0,
  kotlin: 0,
  javascript: 0,
  typescript: 0,
  go: 0,
  rust: 0,
};

const input = JSON.parse(readFileSync(inputPath, "utf-8"));

for (const entry of input.changedFiles ?? []) {
  const stack = EXT_TO_STACK.get(extname(entry.path ?? "").toLowerCase());
  if (!stack) continue;
  counts[stack] += 1;
}

const detected = Object.entries(counts)
  .filter(([, files]) => files > 0)
  .sort((a, b) => b[1] - a[1])
  .map(([stack, files]) => ({ stack, files }));

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ counts, detected }, null, 2)}\n`, "utf-8");
console.log(`Detected ${detected.length} language stacks from changed files`);
