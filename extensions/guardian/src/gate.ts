import { completeSimple } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { auditGuardianDecision } from "./audit.js";
import { classifyRequest } from "./classify.js";
import { runGuardian } from "./guardian.js";
import { promptUser } from "./prompt.js";
import { buildGateRequest, createFallbackRequest } from "./request.js";
import type { GateRequest, GuardianComplete, GuardianConfig } from "./types.js";

export interface GuardianGateOptions {
  complete?: GuardianComplete;
  notifyGuardianUnavailable?: (reason: string) => void;
  notifyUserInputRequired?: () => void;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function userDecisionFromResult(result: ToolCallEventResult | undefined): "allowed" | "denied" {
  return result?.block ? "denied" : "allowed";
}

function guardianReviewLabel(kind: string): string {
  if (kind === "bash") return "command";
  if (kind === "file_mutation") return "file change";
  return "tool call";
}

function notifyUserInputRequired(options: GuardianGateOptions): void {
  try {
    options.notifyUserInputRequired?.();
  } catch {
    // Notification hooks must not affect Guardian security decisions.
  }
}

function promptForUserDecision(
  ctx: ExtensionContext,
  request: GateRequest,
  reason: string,
  options: GuardianGateOptions,
): Promise<ToolCallEventResult | undefined> {
  notifyUserInputRequired(options);
  return promptUser(ctx, request, reason);
}

export async function handleGuardianToolCall(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  config: GuardianConfig,
  options: GuardianGateOptions = {},
): Promise<ToolCallEventResult | undefined> {
  if (config.mode === "off") return undefined;
  if (config.ignoreToolSet.has(event.toolName)) return undefined;

  let request;
  try {
    request = await buildGateRequest(event, ctx.cwd, config);
  } catch (error) {
    const reason = `guardian could not inspect ${event.toolName}: ${formatError(error)}`;
    return promptForUserDecision(
      ctx,
      createFallbackRequest(event, ctx.cwd, "inspection failed"),
      reason,
      options,
    );
  }

  if (request.kind === "read_only") return undefined;

  const decision = classifyRequest(request, config);
  if (decision.action === "allow") return undefined;
  if (decision.action === "block") return { block: true, reason: decision.reason };
  if (decision.action === "prompt") {
    return promptForUserDecision(ctx, request, decision.reason, options);
  }

  const reviewLabel = guardianReviewLabel(request.kind);
  if (ctx.hasUI) ctx.ui.notify(`Reviewing ${reviewLabel}`, "info");

  let guardian;
  guardian = await runGuardian(
    request,
    config,
    {
      resolveModel: async () => {
        if (!config.autoApprove.model) return ctx.model;
        return ctx.modelRegistry.find(
          config.autoApprove.model.provider,
          config.autoApprove.model.id,
        );
      },
      resolveAuth: (model) => ctx.modelRegistry.getApiKeyAndHeaders(model),
      complete:
        options.complete ??
        ((model, context, completeOptions) => completeSimple(model, context, completeOptions)),
      signal: ctx.signal,
    },
    decision.reason,
  );

  if (guardian.outcome === "allow") {
    if (ctx.hasUI)
      ctx.ui.notify(
        `${reviewLabel[0]?.toUpperCase() ?? "T"}${reviewLabel.slice(1)} approved`,
        "info",
      );
    await auditGuardianDecision({
      request,
      decision,
      guardian,
      finalOutcome: "allowed",
      finalDecision: "guardian_allowed",
    });
    return undefined;
  }
  if (guardian.outcome === "deny") {
    const promptResult = await promptForUserDecision(ctx, request, guardian.reason, options);
    const userDecision = userDecisionFromResult(promptResult);
    if (ctx.hasUI) {
      const label = `${reviewLabel[0]?.toUpperCase() ?? "T"}${reviewLabel.slice(1)}`;
      ctx.ui.notify(
        `${label} ${userDecision === "allowed" ? "approved" : "denied"} by user`,
        userDecision === "allowed" ? "info" : "warning",
      );
    }
    await auditGuardianDecision({
      request,
      decision,
      guardian,
      userDecision,
      finalOutcome: userDecision === "allowed" ? "allowed" : "denied",
      finalDecision:
        userDecision === "allowed" ? "guardian_denied_user_allowed" : "guardian_denied_user_denied",
    });
    return promptResult;
  }

  options.notifyGuardianUnavailable?.(guardian.reason);
  const promptResult = await promptForUserDecision(
    ctx,
    request,
    `Guardian review failed: ${guardian.reason}`,
    options,
  );
  const userDecision = userDecisionFromResult(promptResult);
  await auditGuardianDecision({
    request,
    decision,
    guardian,
    userDecision,
    finalOutcome: userDecision === "allowed" ? "allowed" : "denied",
    finalDecision:
      userDecision === "allowed" ? "guardian_error_user_allowed" : "guardian_error_user_denied",
  });
  return promptResult;
}
