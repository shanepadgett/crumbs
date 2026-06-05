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
import type { AutoGuardianConfig, GuardianComplete } from "./types.js";

export interface AutoGuardianGateOptions {
  complete?: GuardianComplete;
  notifyGuardianUnavailable?: (reason: string) => void;
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

export async function handleAutoGuardianToolCall(
  event: ToolCallEvent,
  ctx: ExtensionContext,
  config: AutoGuardianConfig,
  options: AutoGuardianGateOptions = {},
): Promise<ToolCallEventResult | undefined> {
  if (config.mode === "off") return undefined;
  if (config.ignoreToolSet.has(event.toolName)) return undefined;

  let request;
  try {
    request = await buildGateRequest(event, ctx.cwd, config);
  } catch (error) {
    const reason = `auto-guardian could not inspect ${event.toolName}: ${formatError(error)}`;
    return promptUser(ctx, createFallbackRequest(event, ctx.cwd, "inspection failed"), reason);
  }

  if (request.kind === "read_only") return undefined;

  const decision = classifyRequest(request, config);
  if (decision.action === "allow") return undefined;
  if (decision.action === "block") return { block: true, reason: decision.reason };
  if (decision.action === "prompt") return promptUser(ctx, request, decision.reason);

  const reviewLabel = guardianReviewLabel(request.kind);
  if (ctx.hasUI) ctx.ui.notify(`Reviewing ${reviewLabel}`, "info");

  let guardian;
  guardian = await runGuardian(
    request,
    config,
    {
      resolveModel: async () => {
        if (!config.guardian.model) return ctx.model;
        return ctx.modelRegistry.find(config.guardian.model.provider, config.guardian.model.id);
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
    if (ctx.hasUI)
      ctx.ui.notify(
        `${reviewLabel[0]?.toUpperCase() ?? "T"}${reviewLabel.slice(1)} denied`,
        "warning",
      );
    const promptResult = await promptUser(ctx, request, guardian.reason);
    const userDecision = userDecisionFromResult(promptResult);
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
  const promptResult = await promptUser(ctx, request, `Guardian review failed: ${guardian.reason}`);
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
