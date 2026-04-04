/**
 * Crumbs Permission Gate Extension
 *
 * What it does: gates `bash` tool execution using allow/deny/ask policies from
 * `.pi/crumbs.json` (project) and `~/.pi/agent/crumbs.json` (user).
 *
 * How to use it: create either policy file, then run commands normally.
 * When policy resolves to `ask`, the extension prompts with allow/deny choices.
 *
 * Example:
 * {
 *   "$schema": "../schemas/crumbs.schema.json",
 *   "defaultPolicy": "ask",
 *   "allow": [{ "match": "exact", "value": "git status" }],
 *   "deny": [{ "match": "regex", "value": "\\brm\\s+-rf\\b" }]
 * }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CRUMBS_EVENT_USER_INPUT_REQUIRED } from "../shared/events.js";
import { formatApprovalNote, showApprovalPrompt, userBlockReason } from "./approval.js";
import {
  ensurePolicyFileWithAllowRule,
  persistMarkedReviewRecord,
  projectPolicyPath,
  resolveSchemaRefForPersistence,
  userPolicyPath,
} from "./persistence.js";
import { evaluatePolicy, formatRuleMatchReason, mergePolicy, readPolicyFile } from "./policy.js";
import { normalizeCommand } from "./shell.js";

const approvalNotesByToolCallId = new Map<string, string>();

export default function crumbsPermissionGateExtension(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    if (typeof event.input.command !== "string") return undefined;

    const normalizedCommand = normalizeCommand(event.input.command);

    const [userPolicy, projectPolicy] = await Promise.all([
      readPolicyFile(userPolicyPath()),
      readPolicyFile(projectPolicyPath(ctx.cwd)),
    ]);

    const policy = mergePolicy(userPolicy, projectPolicy);
    const evaluated = evaluatePolicy(normalizedCommand, policy);

    if (evaluated.decision === "allow") {
      return undefined;
    }

    if (evaluated.decision === "deny") {
      return {
        block: true,
        reason: evaluated.matched
          ? formatRuleMatchReason(evaluated.matched)
          : "Blocked by crumbs policy",
      };
    }

    if (!ctx.hasUI) {
      if (policy.onNoUi === "allow") return undefined;
      return {
        block: true,
        reason: "Blocked by crumbs policy: approval required but no UI is available",
      };
    }

    const approvalReason = evaluated.approvalReason ?? "Approval required by crumbs policy";
    const failedSegments = evaluated.failedSegments ?? [];

    pi.events.emit(CRUMBS_EVENT_USER_INPUT_REQUIRED, undefined);
    const approval = await showApprovalPrompt(
      ctx,
      normalizedCommand,
      approvalReason,
      failedSegments,
    );

    if (!approval) {
      return {
        block: true,
        reason: "Blocked by crumbs policy: approval prompt did not complete",
      };
    }

    if (approval.action === "allow-once") {
      if (approval.note) {
        approvalNotesByToolCallId.set(event.toolCallId, approval.note);
      }
      await persistMarkedReviewRecord(ctx.cwd, normalizedCommand, approval, failedSegments);
      return undefined;
    }

    if (approval.action === "deny") {
      await persistMarkedReviewRecord(ctx.cwd, normalizedCommand, approval, failedSegments);
      return {
        block: true,
        reason: userBlockReason(approval.denyReason),
      };
    }

    const targetPath =
      approval.action === "always-project" ? projectPolicyPath(ctx.cwd) : userPolicyPath();
    const schemaRef = await resolveSchemaRefForPersistence(approval.action, ctx.cwd);

    try {
      await ensurePolicyFileWithAllowRule(targetPath, normalizedCommand, schemaRef);
      if (approval.note) {
        approvalNotesByToolCallId.set(event.toolCallId, approval.note);
      }
      await persistMarkedReviewRecord(ctx.cwd, normalizedCommand, approval, failedSegments);
      ctx.ui.notify(`Added always-allow rule to ${targetPath}`, "info");
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        block: true,
        reason: `Blocked by crumbs policy: failed to persist always-allow rule (${message})`,
      };
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return undefined;

    const approvalNote = approvalNotesByToolCallId.get(event.toolCallId);
    if (!approvalNote) return undefined;

    approvalNotesByToolCallId.delete(event.toolCallId);
    return {
      content: [{ type: "text", text: formatApprovalNote(approvalNote) }, ...event.content],
    };
  });
}
