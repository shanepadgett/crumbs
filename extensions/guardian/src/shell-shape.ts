export interface BashCommandShape {
  executable: string;
  normalized: string;
  features: string[];
}

interface ParsedShellWords {
  words: string[];
  complex: boolean;
}

const SHELL_FEATURES: Array<[string, RegExp]> = [
  ["pipeline", /(^|[^|])\|(?!\|)/],
  ["redirection", /(?:^|\s)(?:[0-9]?>|[0-9]?>>|<)\s*\S+/],
  ["command-substitution", /\$\(|`/],
  ["variable-expansion", /\$[A-Za-z_][A-Za-z0-9_]*|\$\{/],
  ["globbing", /(^|\s)[^\s]*[*?[]/],
  ["logical-operator", /&&|\|\|/],
  ["subshell-or-group", /(^|\s)[({]|[)}](\s|$)/],
  ["heredoc", /<<-?\s*\S+/],
];

const COMPLEX_FEATURES = new Set([
  "redirection",
  "command-substitution",
  "variable-expansion",
  "globbing",
  "subshell-or-group",
  "heredoc",
]);

const SIMPLE_SAFE_EXECUTABLES = new Set([
  "cat",
  "cut",
  "echo",
  "expr",
  "false",
  "grep",
  "head",
  "id",
  "ls",
  "nl",
  "paste",
  "pwd",
  "rev",
  "seq",
  "stat",
  "tail",
  "tr",
  "true",
  "uname",
  "uniq",
  "wc",
  "which",
  "whoami",
]);

const UNSAFE_FIND_OPTIONS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
]);

const UNSAFE_RIPGREP_OPTIONS_WITH_ARGS = ["--pre", "--hostname-bin"];
const UNSAFE_RIPGREP_OPTIONS_WITHOUT_ARGS = new Set(["--search-zip", "-z"]);
const UNSAFE_BASE64_OPTIONS = new Set(["-o", "--output"]);

type GitOptionPattern =
  | { kind: "exact"; value: string }
  | { kind: "shortWithInlineValue"; value: string }
  | { kind: "prefix"; value: string };

const UNSAFE_GIT_GLOBAL_OPTIONS: GitOptionPattern[] = [
  { kind: "exact", value: "-C" },
  { kind: "shortWithInlineValue", value: "-C" },
  { kind: "exact", value: "-c" },
  { kind: "shortWithInlineValue", value: "-c" },
  { kind: "exact", value: "-p" },
  { kind: "exact", value: "--config-env" },
  { kind: "prefix", value: "--config-env=" },
  { kind: "exact", value: "--exec-path" },
  { kind: "prefix", value: "--exec-path=" },
  { kind: "exact", value: "--git-dir" },
  { kind: "prefix", value: "--git-dir=" },
  { kind: "exact", value: "--namespace" },
  { kind: "prefix", value: "--namespace=" },
  { kind: "exact", value: "--paginate" },
  { kind: "exact", value: "--super-prefix" },
  { kind: "prefix", value: "--super-prefix=" },
  { kind: "exact", value: "--work-tree" },
  { kind: "prefix", value: "--work-tree=" },
];

const UNSAFE_GIT_SUBCOMMAND_OPTIONS: GitOptionPattern[] = [
  { kind: "exact", value: "--output" },
  { kind: "prefix", value: "--output=" },
  { kind: "exact", value: "--ext-diff" },
  { kind: "exact", value: "--textconv" },
  { kind: "exact", value: "--exec" },
  { kind: "prefix", value: "--exec=" },
];

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function commandFeatures(command: string): string[] {
  return SHELL_FEATURES.filter(([, pattern]) => pattern.test(command)).map(([feature]) => feature);
}

function executableKey(word: string | undefined): string | undefined {
  if (!word) return undefined;
  return word.replace(/\\/g, "/").split("/").filter(Boolean).at(-1)?.toLowerCase();
}

function parseWords(input: string): ParsedShellWords {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote !== "'" && char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) current += "\\";
  if (current) words.push(current);
  return { words, complex: quote !== undefined };
}

function splitPlainShellCommands(command: string): string[] | undefined {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    const next = command[i + 1];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote !== "'" && char === "\\") {
      escaped = true;
      current += char;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      const isAllowedOperator =
        char === ";" ||
        (char === "|" && next !== "|") ||
        (char === "|" && next === "|") ||
        (char === "&" && next === "&");
      if (!isAllowedOperator) return undefined;
      const trimmed = current.trim();
      if (!trimmed) return undefined;
      segments.push(trimmed);
      current = "";
      if ((char === "|" && next === "|") || (char === "&" && next === "&")) i++;
      continue;
    }
    current += char;
  }

  if (quote || escaped) return undefined;
  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);
  return segments;
}

function matchesGitOption(arg: string, patterns: GitOptionPattern[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.kind === "exact") return arg === pattern.value;
    if (pattern.kind === "prefix") return arg.startsWith(pattern.value);
    return arg.startsWith(pattern.value) && arg.length > pattern.value.length;
  });
}

function findGitSubcommand(
  words: string[],
  allowed: Set<string>,
): { index: number; name: string } | undefined {
  for (let index = 1; index < words.length; index++) {
    const word = words[index]!;
    if (word.startsWith("-")) {
      const nextIsValue = [
        "-C",
        "-c",
        "--config-env",
        "--exec-path",
        "--git-dir",
        "--namespace",
        "--super-prefix",
        "--work-tree",
      ].includes(word);
      if (nextIsValue) index++;
      continue;
    }
    if (allowed.has(word)) return { index, name: word };
    return undefined;
  }
  return undefined;
}

function gitBranchIsReadOnly(args: string[]): boolean {
  if (args.length === 0) return true;
  let sawReadOnlyFlag = false;
  for (const arg of args) {
    if (
      [
        "--list",
        "-l",
        "--show-current",
        "-a",
        "--all",
        "-r",
        "--remotes",
        "-v",
        "-vv",
        "--verbose",
      ].includes(arg) ||
      arg.startsWith("--format=")
    ) {
      sawReadOnlyFlag = true;
      continue;
    }
    return false;
  }
  return sawReadOnlyFlag;
}

function isSafeGit(words: string[]): boolean {
  const subcommand = findGitSubcommand(
    words,
    new Set(["status", "log", "diff", "show", "branch", "ls-files"]),
  );
  if (!subcommand) return false;
  const globalArgs = words.slice(1, subcommand.index);
  if (globalArgs.some((arg) => matchesGitOption(arg, UNSAFE_GIT_GLOBAL_OPTIONS))) return false;
  const subcommandArgs = words.slice(subcommand.index + 1);
  if (subcommandArgs.some((arg) => matchesGitOption(arg, UNSAFE_GIT_SUBCOMMAND_OPTIONS))) {
    return false;
  }
  if (subcommand.name === "branch") return gitBranchIsReadOnly(subcommandArgs);
  return true;
}

function isSafeSegment(words: string[]): boolean {
  const executable = executableKey(words[0]);
  if (!executable) return false;
  if (["bash", "sh", "zsh"].includes(executable)) {
    return words.length === 3 && ["-c", "-lc"].includes(words[1] ?? "")
      ? isKnownSafeBashCommand(words[2] ?? "")
      : false;
  }
  if (SIMPLE_SAFE_EXECUTABLES.has(executable)) return true;
  if (executable === "base64") {
    return !words
      .slice(1)
      .some(
        (arg) =>
          UNSAFE_BASE64_OPTIONS.has(arg) ||
          arg.startsWith("--output=") ||
          (arg.startsWith("-o") && arg !== "-o"),
      );
  }
  if (executable === "find") return !words.some((arg) => UNSAFE_FIND_OPTIONS.has(arg));
  if (executable === "rg") {
    return !words
      .slice(1)
      .some(
        (arg) =>
          UNSAFE_RIPGREP_OPTIONS_WITHOUT_ARGS.has(arg) ||
          UNSAFE_RIPGREP_OPTIONS_WITH_ARGS.some(
            (option) => arg === option || arg.startsWith(`${option}=`),
          ),
      );
  }
  if (executable === "git") return isSafeGit(words);
  if (executable === "sed") {
    return words.length <= 4 && words[1] === "-n" && /^\d+(,\d+)?p$/.test(words[2] ?? "");
  }
  return false;
}

export function analyzeBashCommand(command: string): BashCommandShape {
  const normalized = normalizeCommand(command);
  const { words } = parseWords(normalized);
  return {
    executable: executableKey(words[0]) ?? "",
    normalized,
    features: commandFeatures(command),
  };
}

export function isKnownSafeBashCommand(command: string): boolean {
  const features = commandFeatures(command);
  if (features.some((feature) => COMPLEX_FEATURES.has(feature))) return false;
  const segments = splitPlainShellCommands(command);
  if (!segments?.length) return false;
  return segments.every((segment) => {
    const parsed = parseWords(segment);
    return !parsed.complex && parsed.words.length > 0 && isSafeSegment(parsed.words);
  });
}
