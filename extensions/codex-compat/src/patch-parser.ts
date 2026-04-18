import type { UpdateFileChunk } from "./patch-matcher.js";

export type PatchOperation =
  | { type: "add"; path: string; content: string; linesAdded: number }
  | { type: "delete"; path: string }
  | {
      type: "update";
      path: string;
      movePath?: string;
      chunks: UpdateFileChunk[];
      linesAdded: number;
      linesRemoved: number;
    };

interface MutableChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
  hasLines: boolean;
}

export interface PatchFailure {
  phase: "parse" | "apply";
  sectionIndex: number;
  path?: string;
  kind?: "add" | "update" | "delete";
  chunkIndex?: number;
  totalChunks?: number;
  contextHint?: string;
  message: string;
  rawSection?: string;
}

export interface ParsedPatch {
  operations: PatchOperation[];
  parseFailures: PatchFailure[];
}

function isTopLevelBoundary(line: string): boolean {
  return (
    line === "*** End Patch" ||
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  );
}

function requirePath(line: string, prefix: string): string {
  const value = line.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`Missing path for patch directive: ${line}`);
  }
  return value;
}

function createChunk(changeContext?: string): MutableChunk {
  return {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false,
    hasLines: false,
  };
}

function finalizeChunk(target: MutableChunk | undefined, chunks: UpdateFileChunk[], path: string) {
  if (!target) return;
  if (!target.hasLines) {
    throw new Error(`Update file patch has an empty chunk: ${path}`);
  }

  chunks.push({
    changeContext: target.changeContext,
    oldLines: target.oldLines,
    newLines: target.newLines,
    isEndOfFile: target.isEndOfFile,
  });
}

function parseChunkLine(rawLine: string): { prefix: " " | "+" | "-"; text: string } {
  if (rawLine.length === 0) {
    return { prefix: " ", text: "" };
  }

  const prefix = rawLine[0] as " " | "+" | "-" | undefined;
  if (prefix !== " " && prefix !== "+" && prefix !== "-") {
    throw new Error(`Invalid update hunk line: ${rawLine}`);
  }

  return { prefix, text: rawLine.slice(1) };
}

function parseAddBody(
  lines: string[],
  startIndex: number,
): { content: string; lineCount: number; nextIndex: number } {
  const body: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("+")) {
      body.push(line.slice(1));
      index += 1;
      continue;
    }
    break;
  }

  return {
    content: body.length === 0 ? "" : `${body.join("\n")}\n`,
    lineCount: body.length,
    nextIndex: index,
  };
}

function parseUpdateBody(
  lines: string[],
  startIndex: number,
  operationPath: string,
): {
  movePath?: string;
  chunks: UpdateFileChunk[];
  linesAdded: number;
  linesRemoved: number;
  nextIndex: number;
} {
  const chunks: UpdateFileChunk[] = [];
  let index = startIndex;
  let movePath: string | undefined;
  let current: MutableChunk | undefined;
  let sawAnyChunk = false;
  let linesAdded = 0;
  let linesRemoved = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isTopLevelBoundary(line)) break;

    if (line.startsWith("*** Move to: ")) {
      if (sawAnyChunk || current) {
        throw new Error(`Move to must appear before update chunks: ${operationPath}`);
      }
      movePath = requirePath(line, "*** Move to: ");
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      finalizeChunk(current, chunks, operationPath);
      const context = line.slice(2).trim();
      current = createChunk(context.length > 0 ? context : undefined);
      sawAnyChunk = true;
      index += 1;
      continue;
    }

    if (line === "*** End of File") {
      if (!current) {
        throw new Error(`*** End of File requires an active chunk: ${operationPath}`);
      }
      current.isEndOfFile = true;
      index += 1;
      continue;
    }

    if (!current) {
      if (sawAnyChunk || chunks.length > 0) {
        throw new Error(`Only the first update chunk may omit @@: ${operationPath}`);
      }
      current = createChunk();
      sawAnyChunk = true;
    }

    const parsedLine = parseChunkLine(line);
    current.hasLines = true;

    if (parsedLine.prefix === "+") linesAdded += 1;
    if (parsedLine.prefix === "-") linesRemoved += 1;

    if (parsedLine.prefix === " " || parsedLine.prefix === "-") {
      current.oldLines.push(parsedLine.text);
    }
    if (parsedLine.prefix === " " || parsedLine.prefix === "+") {
      current.newLines.push(parsedLine.text);
    }

    index += 1;
  }

  finalizeChunk(current, chunks, operationPath);
  if (chunks.length === 0) {
    throw new Error(`Update file patch is missing chunk content: ${operationPath}`);
  }

  return { movePath, chunks, linesAdded, linesRemoved, nextIndex: index };
}

function parseSection(sectionLines: string[]): PatchOperation {
  const header = sectionLines[0] ?? "";

  if (header.startsWith("*** Add File: ")) {
    const path = requirePath(header, "*** Add File: ");
    const body = parseAddBody(sectionLines, 1);
    if (body.nextIndex !== sectionLines.length) {
      throw new Error(`Malformed Add File section: ${path}`);
    }
    return { type: "add", path, content: body.content, linesAdded: body.lineCount };
  }

  if (header.startsWith("*** Delete File: ")) {
    const path = requirePath(header, "*** Delete File: ");
    if (sectionLines.length !== 1) {
      throw new Error(`Malformed Delete File section: ${path}`);
    }
    return { type: "delete", path };
  }

  if (header.startsWith("*** Update File: ")) {
    const path = requirePath(header, "*** Update File: ");
    const updateBody = parseUpdateBody(sectionLines, 1, path);
    if (updateBody.nextIndex !== sectionLines.length) {
      throw new Error(`Malformed Update File section: ${path}`);
    }
    return {
      type: "update",
      path,
      movePath: updateBody.movePath,
      chunks: updateBody.chunks,
      linesAdded: updateBody.linesAdded,
      linesRemoved: updateBody.linesRemoved,
    };
  }

  throw new Error(`Unexpected patch line: ${header}`);
}

function parseHeaderMetadata(header: string): Pick<PatchFailure, "kind" | "path"> {
  if (header.startsWith("*** Add File: ")) {
    return { kind: "add", path: header.slice("*** Add File: ".length).trim() || undefined };
  }
  if (header.startsWith("*** Delete File: ")) {
    return { kind: "delete", path: header.slice("*** Delete File: ".length).trim() || undefined };
  }
  if (header.startsWith("*** Update File: ")) {
    return { kind: "update", path: header.slice("*** Update File: ".length).trim() || undefined };
  }
  return {};
}

export function formatContextHint(chunk: UpdateFileChunk): string | undefined {
  const raw =
    chunk.changeContext ??
    chunk.oldLines.find((line) => line.trim().length > 0) ??
    chunk.newLines.find((line) => line.trim().length > 0);
  if (!raw) return undefined;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

export function parsePatch(input: string): ParsedPatch {
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return {
      operations: [],
      parseFailures: [
        {
          phase: "parse",
          sectionIndex: 0,
          message: "Patch must start with *** Begin Patch.",
        },
      ],
    };
  }

  const lines = normalized.split("\n");
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (firstNonEmpty !== "*** Begin Patch") {
    return {
      operations: [],
      parseFailures: [
        {
          phase: "parse",
          sectionIndex: 0,
          message: "Patch must start with *** Begin Patch.",
        },
      ],
    };
  }

  const operations: PatchOperation[] = [];
  const parseFailures: PatchFailure[] = [];
  let index = lines.indexOf("*** Begin Patch") + 1;
  let sectionIndex = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "*** End Patch") break;
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (
      !line.startsWith("*** Add File: ") &&
      !line.startsWith("*** Delete File: ") &&
      !line.startsWith("*** Update File: ")
    ) {
      parseFailures.push({
        phase: "parse",
        sectionIndex,
        message: `Unexpected patch line: ${line}`,
        rawSection: line,
      });
      index += 1;
      continue;
    }

    sectionIndex += 1;
    const sectionStart = index;
    let nextBoundary = index + 1;
    while (nextBoundary < lines.length && !isTopLevelBoundary(lines[nextBoundary])) {
      nextBoundary += 1;
    }

    const sectionLines = lines.slice(sectionStart, nextBoundary);
    try {
      operations.push(parseSection(sectionLines));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseFailures.push({
        phase: "parse",
        sectionIndex,
        ...parseHeaderMetadata(sectionLines[0] ?? ""),
        message,
        rawSection: sectionLines.join("\n"),
      });
    }

    index = nextBoundary;
  }

  return { operations, parseFailures };
}
