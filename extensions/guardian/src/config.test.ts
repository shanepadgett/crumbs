import { describe, expect, test } from "bun:test";
import { DEFAULT_BASH_RULES, DEFAULT_IGNORE_TOOLS, parseGuardianConfig } from "./config.js";

describe("parseGuardianConfig", () => {
  test("applies defaults when config is absent", () => {
    const config = parseGuardianConfig({});

    expect(config.mode).toBe("gate");
    expect(config.ignoreTools).toEqual(DEFAULT_IGNORE_TOOLS);
    expect(config.bash.defaultAction).toBe("autoApprove");
    expect(config.bash.rules.map((rule) => ({ match: rule.source, action: rule.action }))).toEqual(
      DEFAULT_BASH_RULES,
    );
    expect(
      config.mutation.rules.map((rule) => ({ paths: rule.paths, action: rule.action })),
    ).toEqual([{ paths: [".git", ".git/**"], action: "block" }]);
    expect(config.autoApprove.enabled).toBe(true);
    expect(config.autoApprove.reviewMutations).toBe(true);
  });

  test("reads configured values and replaces arrays", () => {
    const config = parseGuardianConfig({
      mode: "off",
      ignoreTools: ["read"],
      bash: {
        defaultAction: "prompt",
        rules: [{ match: "git status", action: "allow" }],
      },
      mutation: {
        defaultAction: "prompt",
        rules: [{ paths: ["*.env"], action: "autoApprove" }],
        allowOutsideWorkspace: true,
        maxBytes: 100,
      },
      unknownToolAction: "block",
      autoApprove: {
        enabled: false,
        model: "openai/gpt-4.1",
        reviewBash: false,
        reviewMutations: true,
        timeoutMs: 5000,
        maxTokens: 128,
      },
    });

    expect(config.mode).toBe("off");
    expect(config.ignoreTools).toEqual(["read"]);
    expect(config.bash.rules.map((rule) => ({ match: rule.source, action: rule.action }))).toEqual([
      { match: "git status", action: "allow" },
    ]);
    expect(
      config.mutation.rules.map((rule) => ({ paths: rule.paths, action: rule.action })),
    ).toEqual([{ paths: ["*.env"], action: "autoApprove" }]);
    expect(config.mutation.allowOutsideWorkspace).toBe(true);
    expect(config.mutation.maxBytes).toBe(100);
    expect(config.unknownToolAction).toBe("block");
    expect(config.autoApprove.enabled).toBe(false);
    expect(config.autoApprove.model).toEqual({
      provider: "openai",
      id: "gpt-4.1",
      raw: "openai/gpt-4.1",
    });
  });

  test("ignores malformed autoApprove model refs", () => {
    const warnings: string[] = [];
    const config = parseGuardianConfig({ autoApprove: { model: "openai" } }, (message) => {
      warnings.push(message);
    });

    expect(config.autoApprove.model).toBe(undefined);
    expect(warnings[0]?.includes("autoApprove.model must use provider/id")).toBe(true);
  });
});
