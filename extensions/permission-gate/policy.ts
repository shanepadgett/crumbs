/**
 * Shared Crumbs permission gate policy loading and evaluation.
 */

import { readFile } from "node:fs/promises";
import { BUILTIN_SAFE_ALLOW_RULES, evaluateBuiltinSafeCommand } from "./safe-commands.js";
import { analyzeShellCommand } from "./shell.js";
import type {
  DefaultPolicy,
  EffectivePolicy,
  OnNoUiPolicy,
  ParsedPolicyFile,
  PolicyEvaluation,
  Rule,
  RuleMatch,
  RuleMatchResult,
} from "./types.js";

export const DEFAULT_POLICY: DefaultPolicy = "ask";
export const DEFAULT_ON_NO_UI: OnNoUiPolicy = "deny";

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDefaultPolicy(value: unknown): value is DefaultPolicy {
  return value === "ask" || value === "allow" || value === "deny";
}

export function isOnNoUiPolicy(value: unknown): value is OnNoUiPolicy {
  return value === "allow" || value === "deny";
}

function isRuleMatch(value: unknown): value is RuleMatch {
  return value === "exact" || value === "prefix" || value === "regex";
}

function parseRule(value: unknown): Rule | null {
  if (!isObject(value)) return null;
  if (!isRuleMatch(value.match)) return null;
  if (typeof value.value !== "string") return null;
  return { match: value.match, value: value.value };
}

function parsePolicyFile(value: unknown): ParsedPolicyFile | null {
  if (!isObject(value)) return null;

  if (value.defaultPolicy !== undefined && !isDefaultPolicy(value.defaultPolicy)) return null;
  if (value.onNoUi !== undefined && !isOnNoUiPolicy(value.onNoUi)) return null;

  if (value.allow !== undefined && !Array.isArray(value.allow)) return null;
  if (value.deny !== undefined && !Array.isArray(value.deny)) return null;

  return {
    defaultPolicy: value.defaultPolicy,
    onNoUi: value.onNoUi,
    allow: (Array.isArray(value.allow) ? value.allow : [])
      .map(parseRule)
      .filter((rule): rule is Rule => rule !== null),
    deny: (Array.isArray(value.deny) ? value.deny : [])
      .map(parseRule)
      .filter((rule): rule is Rule => rule !== null),
  };
}

export async function readPolicyFile(path: string): Promise<ParsedPolicyFile | null> {
  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return parsePolicyFile(parsed);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export function mergePolicy(
  user: ParsedPolicyFile | null,
  project: ParsedPolicyFile | null,
): EffectivePolicy {
  return {
    defaultPolicy: project?.defaultPolicy ?? user?.defaultPolicy ?? DEFAULT_POLICY,
    onNoUi: project?.onNoUi ?? user?.onNoUi ?? DEFAULT_ON_NO_UI,
    allow: [...(user?.allow ?? []), ...(project?.allow ?? []), ...BUILTIN_SAFE_ALLOW_RULES],
    deny: [...(user?.deny ?? []), ...(project?.deny ?? [])],
  };
}

function ruleMatchesCommand(command: string, rule: Rule): boolean {
  if (rule.value.length === 0) return false;

  switch (rule.match) {
    case "exact":
      return command === rule.value;
    case "prefix":
      return command.startsWith(rule.value);
    case "regex":
      try {
        return new RegExp(rule.value).test(command);
      } catch {
        // Invalid regex rules are ignored by design.
        return false;
      }
  }
}

function findMatchingRule(command: string, rules: Rule[]): Rule | undefined {
  return rules.find((rule) => ruleMatchesCommand(command, rule));
}

function findExactAllowRule(command: string, policy: EffectivePolicy): Rule | undefined {
  return policy.allow.find((rule) => rule.match === "exact" && rule.value === command);
}

function isCommandAllowedByPolicyOrBuiltin(command: string, policy: EffectivePolicy): boolean {
  if (findMatchingRule(command, policy.allow) !== undefined) {
    return true;
  }

  return evaluateBuiltinSafeCommand(command).decision === "allow";
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

function evaluateSimpleCommand(command: string, policy: EffectivePolicy): PolicyEvaluation {
  const allowMatch = findMatchingRule(command, policy.allow);
  if (allowMatch) {
    return {
      decision: "allow",
      matched: { decision: "allow", rule: allowMatch },
    };
  }

  if (evaluateBuiltinSafeCommand(command).decision === "allow") {
    return { decision: "allow" };
  }

  if (policy.defaultPolicy === "ask") {
    return {
      decision: "ask",
      approvalReason: "No allow rule matched; defaultPolicy=ask",
      failedSegments: [command],
    };
  }

  return { decision: policy.defaultPolicy };
}

export function evaluatePolicy(command: string, policy: EffectivePolicy): PolicyEvaluation {
  const denyMatch = findMatchingRule(command, policy.deny);
  if (denyMatch) {
    return {
      decision: "deny",
      matched: { decision: "deny", rule: denyMatch },
    };
  }

  const exactAllowMatch = findExactAllowRule(command, policy);
  if (exactAllowMatch) {
    return {
      decision: "allow",
      matched: { decision: "allow", rule: exactAllowMatch },
    };
  }

  const analysis = analyzeShellCommand(command);

  if (analysis.hasUnsupportedSyntax) {
    return {
      decision: "ask",
      approvalReason: analysis.unsupportedReason
        ? `Unsupported shell syntax: ${analysis.unsupportedReason}`
        : "Unsupported shell syntax",
      failedSegments: [command],
    };
  }

  if (!analysis.hasCompoundOperators) {
    return evaluateSimpleCommand(command, policy);
  }

  for (const segment of analysis.segments) {
    const segmentDenyMatch = findMatchingRule(segment, policy.deny);
    if (segmentDenyMatch) {
      return {
        decision: "deny",
        matched: { decision: "deny", rule: segmentDenyMatch },
      };
    }
  }

  const failedSegments = analysis.segments.filter(
    (segment) => !isCommandAllowedByPolicyOrBuiltin(segment, policy),
  );

  if (analysis.segments.length > 0 && failedSegments.length === 0) {
    return { decision: "allow" };
  }

  return {
    decision: "ask",
    approvalReason: "Compound command includes unapproved segment",
    failedSegments: uniqueStrings(
      failedSegments.length > 0 ? failedSegments : analysis.segments.length > 0 ? [command] : [],
    ),
  };
}

export function formatRuleMatchReason(matched: RuleMatchResult): string {
  const descriptor = `${matched.rule.match}: ${matched.rule.value}`;
  if (matched.decision === "deny") {
    return `Blocked by crumbs policy deny rule (${descriptor})`;
  }
  return `Allowed by crumbs policy allow rule (${descriptor})`;
}
