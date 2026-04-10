import type {
  QuestionRuntimeQuestionDraft,
  QuestionRuntimeStructuredSubmitResult,
  ValidationIssue,
} from "./types.js";

export const QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE = "question-runtime.control";

function formatIssue(issue: ValidationIssue): string {
  const parts = [`- ${issue.path}: ${issue.message}`];
  if (issue.expected) parts.push(`  expected: ${issue.expected}`);
  if (issue.actual) parts.push(`  actual: ${issue.actual}`);
  parts.push(`  fix: ${issue.hint}`);
  return parts.join("\n");
}

export function buildValidationFailureMessage(input: {
  requestId: string;
  path: string;
  projectRelativePath: string;
  issues: ValidationIssue[];
  failureCount: number;
  allowedFailures: number;
  retryDecisionRequired: boolean;
}) {
  const issuesBlock = input.issues.map(formatIssue).join("\n");
  const content = [
    "Authorized request is invalid. Repair the same file in place.",
    `requestId: ${input.requestId}`,
    `path: @${input.path}`,
    `projectRelativePath: ${input.projectRelativePath}`,
    `failures: ${input.failureCount}/${input.allowedFailures}`,
    input.retryDecisionRequired
      ? "retryDecision: required (wait for user Continue/Abort)"
      : "retryDecision: not required",
    "issues:",
    issuesBlock,
  ].join("\n");

  return {
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content,
    display: false,
    details: {
      type: "validation_failure",
      requestId: input.requestId,
      path: `@${input.path}`,
      projectRelativePath: input.projectRelativePath,
      failureCount: input.failureCount,
      allowedFailures: input.allowedFailures,
      retryDecisionRequired: input.retryDecisionRequired,
      issues: input.issues,
    },
  };
}

export function buildRetryGrantedMessage(input: {
  requestId: string;
  path: string;
  projectRelativePath: string;
  allowedFailures: number;
}) {
  return {
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content: `Question runtime retry granted for ${input.requestId}`,
    display: false,
    details: {
      type: "retry_granted",
      requestId: input.requestId,
      path: `@${input.path}`,
      projectRelativePath: input.projectRelativePath,
      allowedFailures: input.allowedFailures,
    },
  };
}

export function buildAbortMessage(input: {
  requestId: string;
  path: string;
  projectRelativePath: string;
}) {
  return {
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content: `Question runtime request aborted: ${input.requestId}`,
    display: false,
    details: {
      type: "aborted",
      requestId: input.requestId,
      path: `@${input.path}`,
      projectRelativePath: input.projectRelativePath,
    },
  };
}

export function buildFormSubmittedMessage(input: {
  requestId: string;
  path: string;
  projectRelativePath: string;
  draftSnapshot: QuestionRuntimeQuestionDraft[];
  submitResult: QuestionRuntimeStructuredSubmitResult;
}) {
  return {
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content: `Question runtime form submitted: ${input.requestId}`,
    display: false,
    details: {
      type: "form_submitted",
      requestId: input.requestId,
      path: `@${input.path}`,
      projectRelativePath: input.projectRelativePath,
      draftSnapshot: input.draftSnapshot,
      submitResult: input.submitResult,
    },
  };
}

export function buildFormCancelledMessage(input: {
  requestId: string;
  path: string;
  projectRelativePath: string;
  draftSnapshot: QuestionRuntimeQuestionDraft[];
}) {
  return {
    customType: QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE,
    content: `Question runtime form cancelled: ${input.requestId}`,
    display: false,
    details: {
      type: "form_cancelled",
      requestId: input.requestId,
      path: `@${input.path}`,
      projectRelativePath: input.projectRelativePath,
      draftSnapshot: input.draftSnapshot,
    },
  };
}
