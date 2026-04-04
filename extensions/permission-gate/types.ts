/**
 * Shared Crumbs permission gate types.
 */

export type DefaultPolicy = "ask" | "allow" | "deny";
export type OnNoUiPolicy = "allow" | "deny";
export type RuleMatch = "exact" | "prefix" | "regex";

export type Decision = "ask" | "allow" | "deny";

export type ApprovalAction = "allow-once" | "always-project" | "always-user" | "deny";

export interface Rule {
  match: RuleMatch;
  value: string;
}

export interface ParsedPolicyFile {
  defaultPolicy?: DefaultPolicy;
  onNoUi?: OnNoUiPolicy;
  allow: Rule[];
  deny: Rule[];
}

export interface EffectivePolicy {
  defaultPolicy: DefaultPolicy;
  onNoUi: OnNoUiPolicy;
  allow: Rule[];
  deny: Rule[];
}

export interface RuleMatchResult {
  decision: Exclude<Decision, "ask">;
  rule: Rule;
}

export interface PolicyEvaluation {
  decision: Decision;
  matched?: RuleMatchResult;
  approvalReason?: string;
  failedSegments?: string[];
}

export type ShellOperator = "&&" | "||" | "|" | ";" | "\n";

export interface ShellAnalysis {
  segments: string[];
  operators: ShellOperator[];
  hasCompoundOperators: boolean;
  hasUnsupportedSyntax: boolean;
  unsupportedReason?: string;
}

export interface ParsedWord {
  raw: string;
  value: string;
  hadEscape: boolean;
  hadExpansion: boolean;
}

export interface ParsedRedirection {
  fd: number | null;
  operator: ">";
  target: ParsedWord;
}

export interface ParsedSimpleCommand {
  envAssignments: ParsedWord[];
  command: ParsedWord | null;
  args: ParsedWord[];
  redirections: ParsedRedirection[];
  unsupportedReason?: string;
}

export interface ParsedGitInvocation {
  subcommand: ParsedWord | null;
  subcommandArgs: ParsedWord[];
  hasUnsupportedGlobalOptions: boolean;
}

export type BuiltinSafeDecision = "allow" | "not-safe" | "not-applicable";

export interface BuiltinSafeEvaluation {
  decision: BuiltinSafeDecision;
}

export interface ApprovalResult {
  action: ApprovalAction;
  approvalReason: string;
  markedForReview: boolean;
  note?: string;
  denyReason?: string;
}

export interface ApprovalReviewRecord {
  command: string;
  action: ApprovalAction;
  approvalReason: string;
  failedSegments?: string[];
  note?: string;
}
