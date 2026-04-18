export interface UpdateFileChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

export function splitLogicalLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export function countLogicalLines(content: string): number {
  return splitLogicalLines(content).length;
}

export function serializeLinesWithTrailingNewline(lines: string[]): string {
  if (lines.length === 0) return "";
  return `${lines.join("\n")}\n`;
}

export function normalizeUnicodeText(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
}

export function matchesAt(
  source: string[],
  pattern: string[],
  start: number,
  normalize: (value: string) => string,
): boolean {
  if (start < 0 || start + pattern.length > source.length) return false;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (normalize(source[start + offset]) !== normalize(pattern[offset])) {
      return false;
    }
  }
  return true;
}

export function seekSequence(lines: string[], pattern: string[], start: number): number {
  if (pattern.length === 0) {
    return Math.min(Math.max(start, 0), lines.length);
  }

  const normalizers: Array<(value: string) => string> = [
    (value) => value,
    (value) => value.trimEnd(),
    (value) => value.trim(),
    (value) => normalizeUnicodeText(value),
  ];

  for (const normalize of normalizers) {
    for (let index = Math.max(start, 0); index <= lines.length - pattern.length; index += 1) {
      if (matchesAt(lines, pattern, index, normalize)) {
        return index;
      }
    }
  }

  return -1;
}

export function applyChunks(
  currentContent: string,
  chunks: UpdateFileChunk[],
  path: string,
): string {
  const lines = splitLogicalLines(currentContent);
  const replacements: Array<{ index: number; deleteCount: number; insert: string[] }> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex);
      if (contextIndex < 0) {
        throw new Error(`Could not find update context in ${path}: ${chunk.changeContext}`);
      }
      lineIndex = contextIndex + 1;
    }

    if (chunk.oldLines.length === 0) {
      replacements.push({ index: lines.length, deleteCount: 0, insert: [...chunk.newLines] });
      lineIndex = lines.length;
      continue;
    }

    let matchIndex = -1;
    if (chunk.isEndOfFile) {
      const eofIndex = lines.length - chunk.oldLines.length;
      if (eofIndex >= lineIndex && seekSequence(lines, chunk.oldLines, eofIndex) === eofIndex) {
        matchIndex = eofIndex;
      }
    }
    if (matchIndex < 0) {
      matchIndex = seekSequence(lines, chunk.oldLines, lineIndex);
    }
    if (matchIndex < 0) {
      throw new Error(`Could not match update chunk for ${path}`);
    }

    replacements.push({
      index: matchIndex,
      deleteCount: chunk.oldLines.length,
      insert: [...chunk.newLines],
    });
    lineIndex = matchIndex + chunk.oldLines.length;
  }

  const output = [...lines];
  replacements
    .sort((a, b) => b.index - a.index)
    .forEach((replacement) => {
      output.splice(replacement.index, replacement.deleteCount, ...replacement.insert);
    });

  return serializeLinesWithTrailingNewline(output);
}
