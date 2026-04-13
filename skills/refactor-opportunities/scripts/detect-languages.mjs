#!/usr/bin/env node

import { readdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const targetDir = process.argv[2];
const outputPath = process.argv[3];

if (!targetDir || !outputPath) {
  console.error("Usage: node detect-languages.mjs <target-dir> <output-path>");
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

const IGNORE_DIRS = new Set([
  ".git",
  ".agents",
  "node_modules",
  ".build",
  "build",
  "dist",
  ".next",
  ".turbo",
  "DerivedData",
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

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const stack = EXT_TO_STACK.get(extname(entry.name).toLowerCase());
    if (!stack) continue;
    counts[stack] += 1;
  }
}

walk(targetDir);

const detected = Object.entries(counts)
  .filter(([, files]) => files > 0)
  .sort((a, b) => b[1] - a[1])
  .map(([stack, files]) => ({ stack, files }));

writeFileSync(outputPath, `${JSON.stringify({ counts, detected }, null, 2)}\n`, "utf-8");
console.log(`Detected ${detected.length} language stacks`);
