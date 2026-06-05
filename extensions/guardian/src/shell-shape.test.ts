import { describe, expect, test } from "bun:test";
import { analyzeBashCommand, isKnownSafeBashCommand } from "./shell-shape.js";

describe("analyzeBashCommand", () => {
  test("extracts executable and shell features", () => {
    const shape = analyzeBashCommand("git ls-files | head -20");
    expect(shape.executable).toBe("git");
    expect(shape.normalized).toBe("git ls-files | head -20");
    expect(shape.features.includes("pipeline")).toBe(true);
  });
});

describe("isKnownSafeBashCommand", () => {
  test("allows safe git pipeline when every segment is safe", () => {
    expect(isKnownSafeBashCommand("git ls-files | head -20")).toBe(true);
  });

  test("allows safe command sequences when every segment is safe", () => {
    expect(isKnownSafeBashCommand("git status --short && git ls-files")).toBe(true);
  });

  test("allows shell wrappers only when wrapped script is safe", () => {
    expect(isKnownSafeBashCommand('bash -lc "git ls-files | head -20"')).toBe(true);
    expect(isKnownSafeBashCommand('bash -lc "git ls-files > files.txt"')).toBe(false);
  });

  test("rejects unsafe pipeline sinks", () => {
    expect(isKnownSafeBashCommand("git ls-files | sh")).toBe(false);
    expect(isKnownSafeBashCommand("git ls-files | xargs rm")).toBe(false);
  });

  test("rejects shell features that need guardian review", () => {
    expect(isKnownSafeBashCommand("git ls-files > files.txt")).toBe(false);
    expect(isKnownSafeBashCommand("echo $(whoami)")).toBe(false);
    expect(isKnownSafeBashCommand("ls *.ts")).toBe(false);
  });

  test("rejects unsafe command options", () => {
    expect(isKnownSafeBashCommand("find . -delete")).toBe(false);
    expect(isKnownSafeBashCommand("rg --pre ./script foo")).toBe(false);
    expect(isKnownSafeBashCommand("git --git-dir=.evil diff")).toBe(false);
    expect(isKnownSafeBashCommand("git diff --output=/tmp/out")).toBe(false);
  });
});
