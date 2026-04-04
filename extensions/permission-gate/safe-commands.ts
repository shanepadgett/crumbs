/**
 * Shared Crumbs permission gate built-in safe command evaluators.
 */

import { parseSimpleCommand } from "./shell.js";
import type {
  BuiltinSafeEvaluation,
  ParsedGitInvocation,
  ParsedSimpleCommand,
  ParsedWord,
  Rule,
} from "./types.js";

const SIMPLE_SAFE_COMMANDS = new Set(["ls", "head", "wc", "echo", "printf", "true", "grep"]);

// Baked-in safe defaults that can be expressed as simple rules.
// Richer tools like `rg`, `find`, and `git` are handled by semantic evaluators below.
export const BUILTIN_SAFE_ALLOW_RULES: ReadonlyArray<Rule> = [
  { match: "exact", value: "pwd" },
  { match: "exact", value: "whoami" },
  { match: "exact", value: "uname -a" },
];

const FIND_UNSAFE_ACTIONS = new Set([
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-delete",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fls",
]);

const SORT_UNSAFE_OPTIONS = new Set(["-o", "--output"]);

const GIT_SAFE_READ_ONLY_SUBCOMMANDS = new Set([
  "rev-parse",
  "status",
  "ls-files",
  "show-ref",
  "grep",
  "log",
]);

const GIT_DIFF_UNSAFE_OPTIONS = new Set(["--ext-diff", "--textconv", "--output"]);

const GIT_SYMBOLIC_REF_SAFE_OPTIONS = new Set(["--short", "-q", "--quiet", "--no-recurse"]);

function parsedCommandHasExpansion(command: ParsedSimpleCommand): boolean {
  return [
    command.command,
    ...command.args,
    ...command.envAssignments,
    ...command.redirections.map((redirection) => redirection.target),
  ].some((word) => word?.hadExpansion === true);
}

function canAutoAllowBuiltinCommand(command: ParsedSimpleCommand): boolean {
  return (
    command.unsupportedReason === undefined &&
    command.command !== null &&
    command.envAssignments.length === 0 &&
    !parsedCommandHasExpansion(command)
  );
}

function evaluateSafeSimpleReadOnlyCommand(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (!command.command || !SIMPLE_SAFE_COMMANDS.has(command.command.value)) {
    return { decision: "not-applicable" };
  }

  return canAutoAllowBuiltinCommand(command) ? { decision: "allow" } : { decision: "not-safe" };
}

function evaluateSafeSort(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "sort") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  let optionsEnded = false;

  for (const arg of command.args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (
      SORT_UNSAFE_OPTIONS.has(value) ||
      value.startsWith("--output=") ||
      (value.startsWith("-o") && value.length > 2)
    ) {
      return { decision: "not-safe" };
    }
  }

  return { decision: "allow" };
}

function evaluateSafeSed(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "sed") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  if (
    command.args.length !== 2 ||
    command.args[0].value !== "-n" ||
    !/^\d+(?:,\d+)?p$/.test(command.args[1].value)
  ) {
    return { decision: "not-safe" };
  }

  return { decision: "allow" };
}

function evaluateSafeRg(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "rg") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  let optionsEnded = false;

  for (const arg of command.args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (
      value === "--pre" ||
      value.startsWith("--pre=") ||
      value === "--pre-glob" ||
      value.startsWith("--pre-glob=")
    ) {
      return { decision: "not-safe" };
    }
  }

  return { decision: "allow" };
}

function evaluateSafeFind(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "find") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  let optionsEnded = false;

  for (const arg of command.args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (FIND_UNSAFE_ACTIONS.has(value)) {
      return { decision: "not-safe" };
    }
  }

  return { decision: "allow" };
}

function parseGitInvocation(command: ParsedSimpleCommand): ParsedGitInvocation {
  let index = 0;

  while (index < command.args.length) {
    const arg = command.args[index];
    const value = arg.value;

    if (value === "--no-pager") {
      index += 1;
      continue;
    }

    if (value === "-C") {
      if (index + 1 >= command.args.length) {
        return {
          subcommand: null,
          subcommandArgs: [],
          hasUnsupportedGlobalOptions: true,
        };
      }

      index += 2;
      continue;
    }

    if (value.startsWith("-C") && value.length > 2) {
      index += 1;
      continue;
    }

    if (value.startsWith("-")) {
      return {
        subcommand: null,
        subcommandArgs: [],
        hasUnsupportedGlobalOptions: true,
      };
    }

    return {
      subcommand: arg,
      subcommandArgs: command.args.slice(index + 1),
      hasUnsupportedGlobalOptions: false,
    };
  }

  return {
    subcommand: null,
    subcommandArgs: [],
    hasUnsupportedGlobalOptions: false,
  };
}

function isSafeGitDiffArgs(args: ParsedWord[]): boolean {
  let optionsEnded = false;

  for (const arg of args) {
    const value = arg.value;

    if (optionsEnded) continue;
    if (value === "--") {
      optionsEnded = true;
      continue;
    }

    if (
      GIT_DIFF_UNSAFE_OPTIONS.has(value) ||
      value.startsWith("--ext-diff=") ||
      value.startsWith("--textconv=") ||
      value.startsWith("--output=")
    ) {
      return false;
    }
  }

  return true;
}

function isSafeGitSymbolicRefArgs(args: ParsedWord[]): boolean {
  const operands: string[] = [];

  for (const arg of args) {
    const value = arg.value;

    if (value === "--") {
      return false;
    }

    if (value === "-d" || value === "--delete" || value === "-m") {
      return false;
    }

    if (value.startsWith("-m") && value.length > 2) {
      return false;
    }

    if (value.startsWith("-")) {
      if (!GIT_SYMBOLIC_REF_SAFE_OPTIONS.has(value)) {
        return false;
      }
      continue;
    }

    operands.push(value);
  }

  return operands.length === 1;
}

function evaluateSafeGit(command: ParsedSimpleCommand): BuiltinSafeEvaluation {
  if (command.command?.value !== "git") {
    return { decision: "not-applicable" };
  }

  if (!canAutoAllowBuiltinCommand(command)) {
    return { decision: "not-safe" };
  }

  const gitInvocation = parseGitInvocation(command);
  if (gitInvocation.hasUnsupportedGlobalOptions || gitInvocation.subcommand === null) {
    return { decision: "not-safe" };
  }

  const subcommand = gitInvocation.subcommand.value;

  if (GIT_SAFE_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return { decision: "allow" };
  }

  if (subcommand === "branch") {
    return gitInvocation.subcommandArgs.length === 1 &&
      gitInvocation.subcommandArgs[0].value === "--show-current"
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  if (subcommand === "diff") {
    return isSafeGitDiffArgs(gitInvocation.subcommandArgs)
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  if (subcommand === "symbolic-ref") {
    return isSafeGitSymbolicRefArgs(gitInvocation.subcommandArgs)
      ? { decision: "allow" }
      : { decision: "not-safe" };
  }

  return { decision: "not-safe" };
}

const BUILTIN_SAFE_EVALUATORS = [
  evaluateSafeSimpleReadOnlyCommand,
  evaluateSafeSort,
  evaluateSafeSed,
  evaluateSafeRg,
  evaluateSafeFind,
  evaluateSafeGit,
] as const;

export function evaluateBuiltinSafeCommand(command: string): BuiltinSafeEvaluation {
  const parsedCommand = parseSimpleCommand(command);
  if (parsedCommand.unsupportedReason || parsedCommand.command === null) {
    return { decision: "not-safe" };
  }

  for (const evaluator of BUILTIN_SAFE_EVALUATORS) {
    const evaluation = evaluator(parsedCommand);
    if (evaluation.decision !== "not-applicable") {
      return evaluation;
    }
  }

  return { decision: "not-applicable" };
}
