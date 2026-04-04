/**
 * Shared Crumbs permission gate shell parsing helpers.
 */

import type {
  ParsedRedirection,
  ParsedSimpleCommand,
  ParsedWord,
  ShellAnalysis,
  ShellOperator,
} from "./types.js";

export function normalizeCommand(command: string): string {
  return command.replace(/\r\n?/g, "\n").trim();
}

function unsupportedShellAnalysis(
  operators: ShellOperator[],
  unsupportedReason: string,
): ShellAnalysis {
  return {
    segments: [],
    operators,
    hasCompoundOperators: operators.length > 0,
    hasUnsupportedSyntax: true,
    unsupportedReason,
  };
}

interface ParsedWordReadResult {
  word: ParsedWord;
  nextIndex: number;
}

interface SafeStderrRedirectReadResult {
  redirection: ParsedRedirection;
  nextIndex: number;
}

function readShellWord(
  input: string,
  startIndex: number,
  options?: { stopBeforeOperators?: boolean },
): ParsedWordReadResult | { unsupportedReason: string } {
  const stopBeforeOperators = options?.stopBeforeOperators ?? false;
  let raw = "";
  let value = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hadEscape = false;
  let hadExpansion = false;
  let index = startIndex;

  for (; index < input.length; index += 1) {
    const char = input[index];

    if (quote === "'") {
      raw += char;
      if (char === "'") {
        quote = null;
      } else {
        value += char;
      }
      continue;
    }

    if (quote === '"') {
      if (escaped) {
        raw += char;
        value += char;
        escaped = false;
        continue;
      }

      raw += char;

      if (char === "\\") {
        escaped = true;
        hadEscape = true;
        continue;
      }

      if (char === '"') {
        quote = null;
        continue;
      }

      if (char === "$" || char === "`") {
        hadExpansion = true;
      }

      value += char;
      continue;
    }

    if (escaped) {
      raw += char;
      value += char;
      escaped = false;
      continue;
    }

    if (stopBeforeOperators && (char === "&" || char === "|" || char === ";" || char === ">")) {
      break;
    }

    if (/\s/.test(char)) {
      break;
    }

    raw += char;

    if (char === "\\") {
      escaped = true;
      hadEscape = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$" || char === "`") {
      hadExpansion = true;
    }

    value += char;
  }

  if (quote !== null) {
    return { unsupportedReason: "unterminated quote" };
  }

  if (escaped) {
    return { unsupportedReason: "trailing escape" };
  }

  if (raw.length === 0) {
    return { unsupportedReason: "empty command segment" };
  }

  return {
    word: {
      raw,
      value,
      hadEscape,
      hadExpansion,
    },
    nextIndex: index,
  };
}

function readSafeStderrRedirectToDevNull(
  input: string,
  startIndex: number,
  fd: number | null,
): SafeStderrRedirectReadResult | { unsupportedReason: string } {
  if (input[startIndex] !== ">") {
    return { unsupportedReason: "redirection" };
  }

  const nextChar = input[startIndex + 1];
  if (nextChar === ">" || nextChar === "<" || nextChar === "&" || nextChar === "|") {
    return { unsupportedReason: "redirection" };
  }

  let index = startIndex + 1;
  while (input[index] === " " || input[index] === "\t") {
    index += 1;
  }

  const targetResult = readShellWord(input, index, { stopBeforeOperators: true });
  if ("unsupportedReason" in targetResult) {
    return { unsupportedReason: "redirection" };
  }

  if (fd !== 2 || targetResult.word.hadExpansion || targetResult.word.value !== "/dev/null") {
    return { unsupportedReason: "redirection" };
  }

  return {
    redirection: {
      fd,
      operator: ">",
      target: targetResult.word,
    },
    nextIndex: targetResult.nextIndex,
  };
}

export function analyzeShellCommand(command: string): ShellAnalysis {
  const segments: string[] = [];
  const operators: ShellOperator[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushSegment = (): boolean => {
    const trimmed = current.trim();
    current = "";

    if (trimmed.length === 0) {
      return false;
    }

    segments.push(trimmed);
    return true;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const nextChar = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      current += char;
      if (char === "'") {
        quote = null;
      }
      continue;
    }

    if (quote === '"') {
      current += char;
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quote = null;
      }
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "$" && nextChar === "(") {
      return unsupportedShellAnalysis(operators, "command substitution");
    }

    if (char === "`") {
      return unsupportedShellAnalysis(operators, "backtick command substitution");
    }

    if (char === ">" || char === "<") {
      if (char === "<") {
        return unsupportedShellAnalysis(operators, "redirection");
      }

      let fd: number | null = null;
      let redirectStart = index;
      const fdMatch = current.match(/(?:^|[ \t])(\d+)$/);

      if (fdMatch) {
        const fdText = fdMatch[1];
        fd = Number(fdText);
        current = current.slice(0, current.length - fdText.length);
        redirectStart -= fdText.length;
      }

      const redirectResult = readSafeStderrRedirectToDevNull(command, index, fd);
      if ("unsupportedReason" in redirectResult) {
        return unsupportedShellAnalysis(operators, redirectResult.unsupportedReason);
      }

      current += command.slice(redirectStart, redirectResult.nextIndex);
      index = redirectResult.nextIndex - 1;
      continue;
    }

    if (char === "(" || char === ")" || char === "{" || char === "}") {
      return unsupportedShellAnalysis(operators, "grouping syntax");
    }

    if (char === "&") {
      if (nextChar === "&") {
        if (!pushSegment()) {
          return unsupportedShellAnalysis(operators, "empty command segment");
        }
        operators.push("&&");
        index += 1;
        continue;
      }

      return unsupportedShellAnalysis(operators, "background execution");
    }

    if (char === "|") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }

      if (nextChar === "|") {
        operators.push("||");
        index += 1;
      } else {
        operators.push("|");
      }
      continue;
    }

    if (char === ";") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }
      operators.push(";");
      continue;
    }

    if (char === "\n") {
      if (!pushSegment()) {
        return unsupportedShellAnalysis(operators, "empty command segment");
      }
      operators.push("\n");
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    return unsupportedShellAnalysis(operators, "unterminated quote");
  }

  if (escaped) {
    return unsupportedShellAnalysis(operators, "trailing escape");
  }

  if (current.trim().length === 0) {
    if (operators.length > 0) {
      return unsupportedShellAnalysis(operators, "empty command segment");
    }
  } else {
    segments.push(current.trim());
  }

  return {
    segments,
    operators,
    hasCompoundOperators: operators.length > 0,
    hasUnsupportedSyntax: false,
  };
}

function unsupportedParsedSimpleCommand(reason: string): ParsedSimpleCommand {
  return {
    envAssignments: [],
    command: null,
    args: [],
    redirections: [],
    unsupportedReason: reason,
  };
}

export function parseSimpleCommand(segment: string): ParsedSimpleCommand {
  const words: ParsedWord[] = [];
  const redirections: ParsedRedirection[] = [];
  let raw = "";
  let value = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let hadEscape = false;
  let hadExpansion = false;

  const resetCurrentWord = () => {
    raw = "";
    value = "";
    quote = null;
    escaped = false;
    hadEscape = false;
    hadExpansion = false;
  };

  const pushWord = () => {
    if (raw.length === 0) return;

    words.push({
      raw,
      value,
      hadEscape,
      hadExpansion,
    });

    resetCurrentWord();
  };

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];

    if (quote === "'") {
      raw += char;
      if (char === "'") {
        quote = null;
      } else {
        value += char;
      }
      continue;
    }

    if (quote === '"') {
      if (escaped) {
        raw += char;
        value += char;
        escaped = false;
        continue;
      }

      raw += char;

      if (char === "\\") {
        escaped = true;
        hadEscape = true;
        continue;
      }

      if (char === '"') {
        quote = null;
        continue;
      }

      if (char === "$" || char === "`") {
        hadExpansion = true;
      }

      value += char;
      continue;
    }

    if (escaped) {
      raw += char;
      value += char;
      escaped = false;
      continue;
    }

    if (/\s/.test(char)) {
      pushWord();
      continue;
    }

    if (char === ">" || char === "<") {
      let fd: number | null = null;

      if (raw.length > 0) {
        if (/^\d+$/.test(raw)) {
          fd = Number(raw);
          resetCurrentWord();
        } else {
          pushWord();
        }
      }

      const redirectResult = readSafeStderrRedirectToDevNull(segment, index, fd);
      if ("unsupportedReason" in redirectResult) {
        return unsupportedParsedSimpleCommand(redirectResult.unsupportedReason);
      }

      redirections.push(redirectResult.redirection);
      index = redirectResult.nextIndex - 1;
      continue;
    }

    raw += char;

    if (char === "\\") {
      escaped = true;
      hadEscape = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "$" || char === "`") {
      hadExpansion = true;
    }

    value += char;
  }

  if (quote !== null) {
    return unsupportedParsedSimpleCommand("unterminated quote");
  }

  if (escaped) {
    return unsupportedParsedSimpleCommand("trailing escape");
  }

  pushWord();

  const envAssignments: ParsedWord[] = [];
  let wordIndex = 0;

  while (wordIndex < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[wordIndex].raw)) {
    envAssignments.push(words[wordIndex]);
    wordIndex += 1;
  }

  if (wordIndex >= words.length) {
    return {
      envAssignments,
      command: null,
      args: [],
      redirections,
    };
  }

  return {
    envAssignments,
    command: words[wordIndex],
    args: words.slice(wordIndex + 1),
    redirections,
  };
}
