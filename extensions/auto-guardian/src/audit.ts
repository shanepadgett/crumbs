import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getGlobalCrumbsPath } from "../../shared/config/crumbs-paths.js";
import { analyzeBashCommand, type BashCommandShape } from "./shell-shape.js";
import type { ClassifierResult, GateRequest, GuardianOutcome } from "./types.js";

export type AuditFinalOutcome = "allowed" | "denied";
export type AuditFinalDecision =
  | "guardian_allowed"
  | "guardian_error_user_allowed"
  | "guardian_error_user_denied"
  | "guardian_denied_user_allowed"
  | "guardian_denied_user_denied";

export interface GuardianAuditRecord {
  timestamp: string;
  cwd: string;
  toolCallId: string;
  toolName: string;
  command: string;
  shape: BashCommandShape;
  classification: {
    action: ClassifierResult["action"];
    reason: string;
  };
  guardian: {
    outcome: GuardianOutcome["outcome"];
    reason: string;
  };
  userDecision?: "allowed" | "denied";
  finalOutcome: AuditFinalOutcome;
  finalDecision: AuditFinalDecision;
}

export function getGuardianAuditLogPath(): string {
  return join(dirname(getGlobalCrumbsPath()), "auto-guardian", "audit.jsonl");
}

export async function writeGuardianAudit(record: GuardianAuditRecord): Promise<void> {
  const path = getGuardianAuditLogPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function createGuardianAuditRecord(input: {
  request: GateRequest;
  decision: ClassifierResult;
  guardian: GuardianOutcome;
  userDecision?: "allowed" | "denied";
  finalOutcome: AuditFinalOutcome;
  finalDecision: AuditFinalDecision;
}): GuardianAuditRecord | undefined {
  if (input.request.kind !== "bash" || !input.request.command) return undefined;
  return {
    timestamp: new Date().toISOString(),
    cwd: input.request.cwd,
    toolCallId: input.request.toolCallId,
    toolName: input.request.toolName,
    command: input.request.command,
    shape: analyzeBashCommand(input.request.command),
    classification: {
      action: input.decision.action,
      reason: input.decision.reason,
    },
    guardian: {
      outcome: input.guardian.outcome,
      reason: input.guardian.reason,
    },
    userDecision: input.userDecision,
    finalOutcome: input.finalOutcome,
    finalDecision: input.finalDecision,
  };
}

export async function auditGuardianDecision(input: {
  request: GateRequest;
  decision: ClassifierResult;
  guardian: GuardianOutcome;
  userDecision?: "allowed" | "denied";
  finalOutcome: AuditFinalOutcome;
  finalDecision: AuditFinalDecision;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const record = createGuardianAuditRecord(input);
  if (!record) return;
  try {
    await writeGuardianAudit(record);
  } catch (error) {
    input.onError?.(error);
  }
}
