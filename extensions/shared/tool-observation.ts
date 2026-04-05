function normalizePathValue(pathValue: string): string | null {
  const normalized = pathValue.trim().replace(/^@/, "");
  return normalized.length > 0 ? normalized : null;
}

function extractPatchText(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  if (typeof record.input === "string") return record.input;
  if (typeof record.patch === "string") return record.patch;
  if (typeof record.text === "string") return record.text;
  return null;
}

function collectPatchMutatedPaths(patchText: string): string[] {
  const touched = new Set<string>();
  const lines = patchText.split("\n");
  let lastUpdatedPath: string | null = null;

  for (const line of lines) {
    const addMatch = line.match(/^\*\*\* Add File: (.+)$/);
    if (addMatch) {
      const path = normalizePathValue(addMatch[1] ?? "");
      if (path) touched.add(path);
      lastUpdatedPath = null;
      continue;
    }

    const updateMatch = line.match(/^\*\*\* Update File: (.+)$/);
    if (updateMatch) {
      const path = normalizePathValue(updateMatch[1] ?? "");
      if (path) touched.add(path);
      lastUpdatedPath = path;
      continue;
    }

    if (line.startsWith("*** Delete File:")) {
      lastUpdatedPath = null;
      continue;
    }

    const moveToMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveToMatch) {
      const nextPath = normalizePathValue(moveToMatch[1] ?? "");
      if (lastUpdatedPath) touched.delete(lastUpdatedPath);
      if (nextPath) touched.add(nextPath);
      lastUpdatedPath = nextPath;
    }
  }

  return [...touched];
}

export function isFileMutationTool(toolName: unknown): boolean {
  return toolName === "edit" || toolName === "write" || toolName === "apply_patch";
}

export function collectMutatedPaths(toolName: unknown, input: unknown): string[] {
  if (!isFileMutationTool(toolName)) return [];

  if (toolName === "apply_patch") {
    const patchText = extractPatchText(input);
    if (!patchText) return [];
    return collectPatchMutatedPaths(patchText);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  if (typeof record.path !== "string") return [];
  const path = normalizePathValue(record.path);
  return path ? [path] : [];
}

export function extractToolCommand(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.command === "string") return record.command;
  if (typeof record.cmd === "string") return record.cmd;
  return null;
}
