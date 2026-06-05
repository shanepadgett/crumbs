import { describe, expect, test } from "bun:test";
import { classifyRequest } from "./classify.js";
import { parseAutoGuardianConfig } from "./config.js";
import type { AutoGuardianConfig, GateRequest, ResolvedTargetPath } from "./types.js";

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
  test("blocks denylisted bash commands", () => {
    const result = classifyRequest(bashRequest("rm -rf /"), parseAutoGuardianConfig({}));

    expect(result.action).toBe("block");
    expect(result.overridable).toBe(false);
  });

  test("prompts for risky bash commands", () => {
    const result = classifyRequest(bashRequest("sudo whoami"), parseAutoGuardianConfig({}));

    expect(result.action).toBe("prompt");
    expect(result.overridable).toBe(true);
  });

  test("allows harmless bash by default", () => {
    const result = classifyRequest(bashRequest("git status"), parseAutoGuardianConfig({}));

    expect(result.action).toBe("allow");
  });

  test("uses bash allowPatterns when default action prompts", () => {
    const config = parseAutoGuardianConfig({
      bash: { defaultAction: "prompt", allowPatterns: ["^git status$"] },
    });

    expect(classifyRequest(bashRequest("git status"), config).action).toBe("allow");
    expect(classifyRequest(bashRequest("npm test"), config).action).toBe("prompt");
  });

  test("blocks mutations outside workspace", () => {
    const result = classifyRequest(
      mutationRequest([path({ raw: "/tmp/file", canonical: "/tmp/file", insideWorkspace: false })]),
      parseAutoGuardianConfig({}),
    );

    expect(result.action).toBe("block");
  });

  test("blocks protected mutation paths", () => {
    const result = classifyRequest(
      mutationRequest([path({ raw: ".git/config", isProtected: true })]),
      parseAutoGuardianConfig({}),
    );

    expect(result.action).toBe("block");
  });

  test("prompts for unparseable apply_patch", () => {
    const result = classifyRequest(
      mutationRequest([], {
        toolName: "apply_patch",
        inputSummary: "apply_patch: unparseable patch",
        unparseablePatch: true,
      }),
      parseAutoGuardianConfig({}),
    );

    expect(result.action).toBe("prompt");
  });

  test("prompts for large mutations", () => {
    const result = classifyRequest(
      mutationRequest([path({ byteSize: 20 })]),
      parseAutoGuardianConfig({ mutation: { maxBytes: 10 } }),
    );

    expect(result.action).toBe("prompt");
  });

  test("returns guardian branch when enabled", () => {
    const bashConfig = parseAutoGuardianConfig({ guardian: { enabled: true, reviewBash: true } });
    const mutationConfig: AutoGuardianConfig = parseAutoGuardianConfig({
      guardian: { enabled: true, reviewMutations: true },
    });

    expect(classifyRequest(bashRequest("git status"), bashConfig).action).toBe("guardian");
    expect(classifyRequest(mutationRequest([path()]), mutationConfig).action).toBe("guardian");
  });
});
