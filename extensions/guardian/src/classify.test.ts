import { describe, expect, test } from "bun:test";
import { classifyRequest } from "./classify.js";
import { parseGuardianConfig } from "./config.js";
import type { GateRequest, GuardianConfig, ResolvedTargetPath } from "./types.js";

function bashRequest(command: string): GateRequest {
  return {
    toolName: "bash",
    toolCallId: "call-1",
    kind: "bash",
    cwd: "/repo",
    command,
    inputSummary: `bash: ${command}`,
  };
}

function path(overrides: Partial<ResolvedTargetPath> = {}): ResolvedTargetPath {
  return {
    raw: "src/app.ts",
    absolute: "/repo/src/app.ts",
    canonical: "/repo/src/app.ts",
    insideWorkspace: true,
    isProtected: false,
    ...overrides,
  };
}

function mutationRequest(paths: ResolvedTargetPath[], config?: Partial<GateRequest>): GateRequest {
  return {
    toolName: "write",
    toolCallId: "call-1",
    kind: "file_mutation",
    cwd: "/repo",
    paths,
    inputSummary: "write: src/app.ts",
    ...config,
  };
}

describe("classifyRequest", () => {
  test("blocks bash commands matching block rules", () => {
    const result = classifyRequest(bashRequest("rm -rf /"), parseGuardianConfig({}));

    expect(result.action).toBe("block");
    expect(result.overridable).toBe(false);
  });

  test("prompts for bash commands matching prompt rules", () => {
    const result = classifyRequest(bashRequest("sudo whoami"), parseGuardianConfig({}));

    expect(result.action).toBe("prompt");
    expect(result.overridable).toBe(true);
  });

  test("auto-approves harmless bash by default", () => {
    const result = classifyRequest(bashRequest("npm test"), parseGuardianConfig({}));

    expect(result.action).toBe("guardian");
  });

  test("allows known safe bash commands before default auto approval", () => {
    const result = classifyRequest(bashRequest("git status"), parseGuardianConfig({}));

    expect(result.action).toBe("allow");
  });

  test("uses first matching bash rule", () => {
    const config = parseGuardianConfig({
      bash: {
        defaultAction: "prompt",
        rules: [
          { match: "git *", action: "allow" },
          { match: "git status", action: "prompt" },
        ],
      },
    });

    expect(classifyRequest(bashRequest("git status"), config).action).toBe("allow");
    expect(classifyRequest(bashRequest("npm test"), config).action).toBe("prompt");
  });

  test("blocks mutations outside workspace", () => {
    const result = classifyRequest(
      mutationRequest([path({ raw: "/tmp/file", canonical: "/tmp/file", insideWorkspace: false })]),
      parseGuardianConfig({}),
    );

    expect(result.action).toBe("block");
  });

  test("blocks protected mutation paths", () => {
    const result = classifyRequest(
      mutationRequest([path({ raw: ".git/config", isProtected: true })]),
      parseGuardianConfig({}),
    );

    expect(result.action).toBe("block");
  });

  test("prompts for mutation paths with prompt rule", () => {
    const result = classifyRequest(
      mutationRequest([path({ raw: "README.md" })]),
      parseGuardianConfig({ mutation: { rules: [{ paths: ["README.md"], action: "prompt" }] } }),
    );

    expect(result.action).toBe("prompt");
  });

  test("prompts for unparseable apply_patch", () => {
    const result = classifyRequest(
      mutationRequest([], {
        toolName: "apply_patch",
        inputSummary: "apply_patch: unparseable patch",
        unparseablePatch: true,
      }),
      parseGuardianConfig({}),
    );

    expect(result.action).toBe("prompt");
  });

  test("prompts for large mutations", () => {
    const result = classifyRequest(
      mutationRequest([path({ byteSize: 20 })]),
      parseGuardianConfig({ mutation: { maxBytes: 10 } }),
    );

    expect(result.action).toBe("prompt");
  });

  test("returns guardian branch for autoApprove actions", () => {
    const bashConfig = parseGuardianConfig({ bash: { defaultAction: "autoApprove", rules: [] } });
    const mutationConfig: GuardianConfig = parseGuardianConfig({
      mutation: { defaultAction: "autoApprove", rules: [] },
    });

    expect(classifyRequest(bashRequest("npm test"), bashConfig).action).toBe("guardian");
    expect(classifyRequest(mutationRequest([path()]), mutationConfig).action).toBe("guardian");
  });

  test("falls back to prompt when autoApprove disabled", () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: false }, bash: { rules: [] } });

    expect(classifyRequest(bashRequest("npm test"), config).action).toBe("prompt");
  });
});
