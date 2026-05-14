import { describe, expect, test } from "bun:test";
import { parseMiseFailureGroups } from "./failures.js";

describe("mise failure grouping", () => {
  test("groups SwiftLint failures by rule", () => {
    const groups = parseMiseFailureGroups(
      "App.swift:1:2: warning: Force unwrap violation (force_unwrapping)",
    );

    expect(groups[0]).toEqual({
      key: "swiftlint:force_unwrapping",
      title: "SwiftLint · force_unwrapping",
      count: 1,
      examples: ["App.swift:1:2: warning: Force unwrap violation (force_unwrapping)"],
    });
  });

  test("groups SwiftFormat failures", () => {
    const groups = parseMiseFailureGroups("App.swift is not formatted correctly");

    expect(groups[0]).toEqual({
      key: "swiftformat",
      title: "SwiftFormat",
      count: 1,
      examples: ["App.swift is not formatted correctly"],
    });
  });

  test("falls back when no known groups match", () => {
    const groups = parseMiseFailureGroups("command exited 1");

    expect(groups[0]).toEqual({
      key: "mise task",
      title: "Mise Task",
      count: 1,
      examples: ["command exited 1"],
    });
  });
});
