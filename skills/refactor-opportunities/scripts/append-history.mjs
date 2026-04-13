#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const entriesPath = process.argv[2];
const historyPath = process.argv[3];

if (!entriesPath || !historyPath) {
  console.error("Usage: node append-history.mjs <entries-json-path> <history-jsonl-path>");
  process.exit(1);
}

const input = JSON.parse(readFileSync(entriesPath, "utf-8"));
const entries = Array.isArray(input) ? input : Array.isArray(input.entries) ? input.entries : [input];

mkdirSync(dirname(historyPath), { recursive: true });

for (const entry of entries) {
  appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, "utf-8");
}

console.log(`Appended ${entries.length} history entries`);
