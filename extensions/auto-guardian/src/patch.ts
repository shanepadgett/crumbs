import type { MutationOperation } from "./types.js";

export interface PatchTarget {
  path: string;
  operation: MutationOperation;
  byteSize?: number;
}

export interface ParsedPatchTargets {
  targets: PatchTarget[];
  unparseable: boolean;
}

function parseHeader(line: string): { path: string; operation: MutationOperation } | undefined {
  const match = line.match(/^\*\*\* (Add|Update|Replace|Delete) File: (.+)$/);
  if (!match) return undefined;

  const path = match[2]?.trim() ?? "";
  if (!path) return undefined;

  const operation =
    match[1] === "Add"
      ? "add"
      : match[1] === "Replace"
        ? "replace"
        : match[1] === "Delete"
          ? "delete"
          : "update";
  return { path, operation };
}

export function parseApplyPatchTargets(input: string): ParsedPatchTargets {
  const targets: PatchTarget[] = [];
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  let currentTarget: PatchTarget | undefined;

  for (const line of lines) {
    const header = parseHeader(line);
    if (header) {
      currentTarget = { path: header.path, operation: header.operation };
      targets.push(currentTarget);
      continue;
    }

    const move = line.match(/^\*\*\* Move to: (.+)$/);
    if (move && currentTarget?.operation === "update") {
      const movePath = move[1]?.trim() ?? "";
      if (movePath) targets.push({ path: movePath, operation: "move" });
      continue;
    }

    if (!currentTarget || currentTarget.operation === "delete") continue;
    if (line.startsWith("+")) {
      currentTarget.byteSize =
        (currentTarget.byteSize ?? 0) + Buffer.byteLength(`${line.slice(1)}\n`, "utf8");
    }
  }

  return { targets, unparseable: targets.length === 0 };
}
