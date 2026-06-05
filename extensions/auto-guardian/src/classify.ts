import type {
  AutoGuardianConfig,
  ClassifierResult,
  CompiledPattern,
  GateRequest,
} from "./types.js";

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

function firstMatch(value: string, rules: readonly CompiledPattern[]): CompiledPattern | undefined {
  return rules.find((rule) => rule.regex.test(value));
}

function describeBashRule(rule: CompiledPattern, kind: "deny" | "prompt"): string {
  const source = rule.source;
  if (source.includes("sudo")) return "Command uses sudo.";
  if (source.includes("chmod|chown")) return "Command changes file ownership or broad permissions.";
  if (source.includes("git") && source.includes("push") && source.includes("force")) {
    return "Command force-pushes git history.";
  }
  if (source.includes("curl|wget") && source.includes("sh|bash")) {
    return "Command downloads code and pipes it into a shell.";
  }
  if (source.includes("/etc")) return "Command writes to system configuration.";
  if (source.includes("rm") && source.includes("r")) return "Command recursively removes files.";
  if (source.includes("mkfs")) return "Command formats a filesystem.";
  if (source.includes("dd") && source.includes("of=/dev")) {
    return "Command writes directly to a device.";
  }
  if (source.includes("/dev/")) return "Command writes to a device path.";
  if (source.includes(":") && source.includes("|") && source.includes("{")) {
    return "Command looks like a fork bomb.";
  }
  return kind === "deny"
    ? "Command matches a blocked safety rule."
    : "Command matches a rule that requires approval.";
}

function classifyBash(request: GateRequest, config: AutoGuardianConfig): ClassifierResult {
  const command = request.command ?? "";
  const denied = firstMatch(command, config.bash.denyPatterns);
  if (denied) return block(describeBashRule(denied, "deny"));

  const risky = firstMatch(command, config.bash.promptPatterns);
  if (risky) return prompt(describeBashRule(risky, "prompt"));

  if (config.guardian.enabled && config.guardian.reviewBash) {
    return guardian("guardian review enabled for bash");
  }

  if (config.bash.defaultAction === "prompt") {
    const allowed = firstMatch(command, config.bash.allowPatterns);
    if (allowed) return allow("Command matches an allow rule.");
    return prompt("Commands require approval by default.");
  }

  return allow("bash command allowed by default");
}

function classifyMutation(request: GateRequest, config: AutoGuardianConfig): ClassifierResult {
  const paths = request.paths ?? [];
  const outside = paths.find((path) => !path.insideWorkspace);
  if (outside && !config.mutation.allowOutsideWorkspace) {
    return block(`Path is outside the workspace: ${outside.raw}`);
  }

  const protectedPath = paths.find((path) => path.isProtected);
  if (protectedPath) return block(`Path is protected: ${protectedPath.raw}`);

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

  if (config.guardian.enabled && config.guardian.reviewMutations) {
    return guardian("guardian review enabled for file mutation");
  }

  if (config.mutation.defaultAction === "prompt") {
    return prompt("File changes require approval by default.");
  }

  return allow("file mutation allowed by default");
}

function classifyUnknown(request: GateRequest, config: AutoGuardianConfig): ClassifierResult {
  if (config.unknownToolAction === "allow")
    return allow(`unknown tool allowed: ${request.toolName}`);
  if (config.unknownToolAction === "block")
    return block(`unknown tool blocked: ${request.toolName}`);
  return prompt(`Tool requires approval: ${request.toolName}`);
}

export function classifyRequest(
  request: GateRequest,
  config: AutoGuardianConfig,
): ClassifierResult {
  if (request.kind === "read_only") return allow("read-only tool");
  if (request.kind === "bash") return classifyBash(request, config);
  if (request.kind === "file_mutation") return classifyMutation(request, config);
  return classifyUnknown(request, config);
}
