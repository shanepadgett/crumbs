import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BASH_DENY_PATTERNS,
  DEFAULT_IGNORE_TOOLS,
  parseAutoGuardianConfig,
} from "./config.js";

describe("parseAutoGuardianConfig", () => {
  test("applies defaults when config is absent", () => {
    const config = parseAutoGuardianConfig({});

    expect(config.mode).toBe("gate");
    expect(config.ignoreTools).toEqual(DEFAULT_IGNORE_TOOLS);
    expect(config.bash.defaultAction).toBe("allow");
    expect(config.bash.denyPatterns.map((rule) => rule.source)).toEqual(DEFAULT_BASH_DENY_PATTERNS);
    expect(config.mutation.protectedPaths).toEqual([".git", ".git/**"]);
    expect(config.guardian.enabled).toBe(false);
  });

  test("reads configured values and replaces arrays", () => {
    const config = parseAutoGuardianConfig({
      mode: "off",
      ignoreTools: ["read"],
      bash: {
        defaultAction: "prompt",
        denyPatterns: ["danger"],
        promptPatterns: [],
        allowPatterns: ["^git status$"],
      },
      mutation: {
        defaultAction: "prompt",
        protectedPaths: ["*.env"],
        allowOutsideWorkspace: true,
        maxBytes: 100,
      },
      unknownToolAction: "block",
      guardian: {
        enabled: true,
        model: "openai/gpt-4.1",
        reviewBash: false,
        reviewMutations: true,
        timeoutMs: 5000,
        maxTokens: 128,
      },
    });

    expect(config.mode).toBe("off");
    expect(config.ignoreTools).toEqual(["read"]);
    expect(config.bash.denyPatterns.map((rule) => rule.source)).toEqual(["danger"]);
    expect(config.bash.promptPatterns).toEqual([]);
    expect(config.mutation.protectedPaths).toEqual(["*.env"]);
    expect(config.mutation.allowOutsideWorkspace).toBe(true);
    expect(config.mutation.maxBytes).toBe(100);
    expect(config.unknownToolAction).toBe("block");
    expect(config.guardian.model).toEqual({
      provider: "openai",
      id: "gpt-4.1",
      raw: "openai/gpt-4.1",
    });
  });

  test("skips invalid regex patterns with warnings", () => {
    const warnings: string[] = [];
    const config = parseAutoGuardianConfig({ bash: { denyPatterns: ["[", "ok"] } }, (message) => {
      warnings.push(message);
    });

    expect(config.bash.denyPatterns.map((rule) => rule.source)).toEqual(["ok"]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]?.includes("invalid bash.denyPatterns regex skipped")).toBe(true);
  });

  test("ignores malformed guardian model refs", () => {
    const warnings: string[] = [];
    const config = parseAutoGuardianConfig({ guardian: { model: "openai" } }, (message) => {
      warnings.push(message);
    });

    expect(config.guardian.model).toBe(undefined);
    expect(warnings[0]?.includes("guardian.model must use provider/id")).toBe(true);
  });
});
