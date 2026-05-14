import type { Snapshot } from "./types.js";

export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changed = new Set<string>();

  for (const [file, signature] of before) {
    if (after.get(file) !== signature) changed.add(file);
  }

  for (const file of after.keys()) {
    if (!before.has(file)) changed.add(file);
  }

  return [...changed].sort();
}

export function buildValidationSignature(snapshot: Snapshot, changedFiles: string[]): string {
  return changedFiles.map((file) => `${file}:${snapshot.get(file) ?? "<deleted>"}`).join("|");
}
