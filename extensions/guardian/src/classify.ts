import type {
  BashRule,
  ClassifierResult,
  ConfigAction,
  GuardianConfig,
  GateRequest,
  MutationRule,
} from "./types.js";
import { isKnownSafeBashCommand } from "./shell-shape.js";

function allow(reason: string): ClassifierResult {
  return { action: "allow", reason, overridable: true };
}

function block(reason: string): ClassifierResult {
  return { action: "block", reason, overridable: false };
}

function prompt(reason: string): ClassifierResult {
  return { action: "prompt", reason, overridable: true };
}

function guardian(reason: string): ClassifierResult {
  return { action: "guardian", reason, overridable: true };
}

function normalizeCommand(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

function matchedBashRule(command: string, rules: readonly BashRule[]): BashRule | undefined {
  const normalized = normalizeCommand(command);
  return rules.find((rule) => rule.regex.test(normalized));
}

function pathMatchesRule(path: string, rule: MutationRule): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  return rule.pathRules.some((pathRule) => pathRule.regex.test(normalized));
}

function matchedMutationRule(
  request: GateRequest,
  rules: readonly MutationRule[],
): MutationRule | undefined {
  const paths = request.paths ?? [];
  return rules.find((rule) => paths.some((path) => pathMatchesRule(path.raw, rule)));
}

function resultForAction(
  action: ConfigAction,
  reason: string,
  autoApproveEnabled: boolean,
  reviewEnabled: boolean,
): ClassifierResult {
  if (action === "allow") return allow(reason);
  if (action === "block") return block(reason);
  if (action === "prompt") return prompt(reason);
  if (autoApproveEnabled && reviewEnabled) return guardian(reason);
  return prompt(`${reason}; autoApprove disabled`);
}

function classifyBash(request: GateRequest, config: GuardianConfig): ClassifierResult {
  const command = request.command ?? "";
  const rule = matchedBashRule(command, config.bash.rules);
  if (rule) {
    return resultForAction(
      rule.action,
      `Command matches bash rule: ${rule.source}`,
      config.autoApprove.enabled,
      config.autoApprove.reviewBash,
    );
  }

  if (isKnownSafeBashCommand(command)) return allow("Command is known safe and read-only.");

  return resultForAction(
    config.bash.defaultAction,
    "bash command matched default action",
    config.autoApprove.enabled,
    config.autoApprove.reviewBash,
  );
}

function classifyMutation(request: GateRequest, config: GuardianConfig): ClassifierResult {
  const paths = request.paths ?? [];
  const outside = paths.find((path) => !path.insideWorkspace);
  if (outside && !config.mutation.allowOutsideWorkspace) {
    return block(`Path is outside the workspace: ${outside.raw}`);
  }

  const protectedPath = paths.find((path) => path.isProtected);
  if (protectedPath) return block(`Path matches block mutation rule: ${protectedPath.raw}`);

  if (request.toolName === "apply_patch" && request.unparseablePatch) {
    return prompt("Patch targets could not be verified.");
  }

  if (typeof config.mutation.maxBytes === "number") {
    const oversized = paths.find((path) => (path.byteSize ?? 0) > config.mutation.maxBytes!);
    if (oversized?.byteSize !== undefined) {
      return prompt(
        `File change is large (${oversized.byteSize} bytes > ${config.mutation.maxBytes} bytes).`,
      );
    }
  }

  const rule = matchedMutationRule(request, config.mutation.rules);
  if (rule) {
    return resultForAction(
      rule.action,
      `Path matches mutation rule: ${rule.paths.join(", ")}`,
      config.autoApprove.enabled,
      config.autoApprove.reviewMutations,
    );
  }

  return resultForAction(
    config.mutation.defaultAction,
    "file mutation matched default action",
    config.autoApprove.enabled,
    config.autoApprove.reviewMutations,
  );
}

function classifyUnknown(request: GateRequest, config: GuardianConfig): ClassifierResult {
  return resultForAction(
    config.unknownToolAction,
    `unknown tool matched default action: ${request.toolName}`,
    config.autoApprove.enabled,
    true,
  );
}

export function classifyRequest(request: GateRequest, config: GuardianConfig): ClassifierResult {
  if (request.kind === "read_only") return allow("read-only tool");
  if (request.kind === "bash") return classifyBash(request, config);
  if (request.kind === "file_mutation") return classifyMutation(request, config);
  return classifyUnknown(request, config);
}
