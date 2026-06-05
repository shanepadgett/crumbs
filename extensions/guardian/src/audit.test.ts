import { describe, expect, test } from "bun:test";
import { createGuardianAuditRecord } from "./audit.js";
import { analyzeBashCommand } from "./shell-shape.js";
import type { ClassifierResult, GateRequest, GuardianOutcome } from "./types.js";

const decision: ClassifierResult = {
  action: "guardian",
  reason: "guardian review enabled for bash",
  overridable: true,
};

const guardian: GuardianOutcome = { outcome: "allow", reason: "read-only command" };

function bashRequest(command: string): GateRequest {
  return {
    toolName: "bash",
    toolCallId: "tool-1",
    kind: "bash",
    cwd: "/repo",
    command,
    inputSummary: `bash: ${command}`,
  };
}

describe("analyzeBashCommand", () => {
  test("extracts executable and normalizes whitespace", () => {
    const shape = analyzeBashCommand("  git   status --short  ");
    expect(shape.executable).toBe("git");
    expect(shape.normalized).toBe("git status --short");
    expect(shape.features.length).toBe(0);
  });

  test("detects shell boundary features", () => {
    const shape = analyzeBashCommand("git diff | grep foo > $OUT");
    expect(shape.features.includes("pipeline")).toBe(true);
    expect(shape.features.includes("redirection")).toBe(true);
    expect(shape.features.includes("variable-expansion")).toBe(true);
  });
});

describe("createGuardianAuditRecord", () => {
  test("creates bash audit record", () => {
    const record = createGuardianAuditRecord({
      request: bashRequest("git status --short"),
      decision,
      guardian,
      finalOutcome: "allowed",
      finalDecision: "guardian_allowed",
    });

    expect(record?.command).toBe("git status --short");
    expect(record?.shape.executable).toBe("git");
    expect(record?.classification.action).toBe("guardian");
    expect(record?.finalOutcome).toBe("allowed");
  });

  test("skips non-bash requests", () => {
    const record = createGuardianAuditRecord({
      request: {
        toolName: "write",
        toolCallId: "tool-1",
        kind: "file_mutation",
        cwd: "/repo",
        inputSummary: "write: file.txt",
      },
      decision,
      guardian,
      finalOutcome: "allowed",
      finalDecision: "guardian_allowed",
    });

    expect(record).toBe(undefined);
  });
});
