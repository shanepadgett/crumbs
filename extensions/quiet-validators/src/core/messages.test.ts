import { describe, expect, test } from "bun:test";
import { buildFailureContent, buildFailureDetails } from "./messages.js";
import type { FailureGroup } from "./types.js";

const groups: FailureGroup[] = [
  {
    key: "lint:no-force",
    title: "SwiftLint · no_force",
    count: 2,
    examples: ["App.swift:1:1: warning: no force (no_force)"],
  },
];

describe("quiet validator failure messages", () => {
  test("buildFailureContent includes changed files, groups, and excerpt", () => {
    const content = buildFailureContent("mise task: swift", ["App.swift"], groups, "failure line");

    expect(content.includes("mise task: swift failed after validator-relevant file changes.")).toBe(
      true,
    );
    expect(content.includes("- App.swift")).toBe(true);
    expect(content.includes("- SwiftLint · no_force: 2")).toBe(true);
    expect(content.includes("failure line")).toBe(true);
  });

  test("buildFailureContent truncates changed file list", () => {
    const files = Array.from({ length: 14 }, (_, index) => `file-${index}.ts`);

    const content = buildFailureContent("mise task: web", files, [], "");

    expect(content.includes("- file-11.ts")).toBe(true);
    expect(content.includes("- file-12.ts")).toBe(false);
    expect(content.includes("- ... and 2 more")).toBe(true);
    expect(content.includes("(no captured output)")).toBe(true);
  });

  test("buildFailureDetails keeps stable payload shape", () => {
    expect(buildFailureDetails("mise task: web", ["src/app.ts"], 1, groups, "failed")).toEqual({
      changedFiles: ["src/app.ts"],
      exitCode: 1,
      failureGroups: groups,
      output: "failed",
      title: "mise task: web",
    });
  });
});
