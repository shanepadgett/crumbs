import { describe, expect, test } from "bun:test";
import type { MiseTaskConfig } from "./config.js";
import { buildMiseCheck } from "./checks.js";

function config(overrides: Partial<MiseTaskConfig> = {}): MiseTaskConfig {
  return {
    enabled: true,
    name: null,
    task: "check:web",
    trackedExtensions: [".ts"],
    excludeGlobs: [],
    ...overrides,
  };
}

function ctx() {
  return { cwd: "/repo", signal: undefined };
}

describe("mise checks", () => {
  test("uses optional name for id label and title", () => {
    const check = buildMiseCheck(config({ name: "Web Checks" }), 2);

    expect(check.id).toBe("quiet-mise-task:2:web-checks");
    expect(check.title).toBe("mise task: Web Checks");
  });

  test("falls back to task for id label and title", () => {
    const check = buildMiseCheck(config({ task: "check:web" }), 0);

    expect(check.id).toBe("quiet-mise-task:0:check:web");
    expect(check.title).toBe("mise task: check:web");
  });

  test("support probe uses configured task and tracked extensions", async () => {
    const calls: unknown[] = [];
    const pi = {
      async exec(command: string, args: string[], options: unknown) {
        calls.push({ command, args, options });
        return { code: 0, stdout: "", stderr: "" };
      },
    };
    const check = buildMiseCheck(config({ task: "check:web", trackedExtensions: [".ts"] }), 0);

    expect(await check.isSupported(pi as any, ctx() as any)).toBe(true);
    expect(calls.length).toBe(1);
    expect((calls[0] as { command: string }).command).toBe("bash");
    expect(
      (calls[0] as { args: string[] }).args[1].includes('mise tasks info "check:web" --json'),
    ).toBe(true);
  });

  test("support is false when disabled or no tracked extensions", async () => {
    const pi = {
      async exec() {
        return { code: 0, stdout: "", stderr: "" };
      },
    };

    expect(
      await buildMiseCheck(config({ enabled: false }), 0).isSupported(pi as any, ctx() as any),
    ).toBe(false);
    expect(
      await buildMiseCheck(config({ trackedExtensions: [] }), 0).isSupported(
        pi as any,
        ctx() as any,
      ),
    ).toBe(false);
  });

  test("run invokes mise run task", async () => {
    const calls: unknown[] = [];
    const pi = {
      async exec(command: string, args: string[], options: unknown) {
        calls.push({ command, args, options });
        return { code: 1, stdout: "out", stderr: "err" };
      },
    };
    const check = buildMiseCheck(config({ task: "check:web" }), 0);

    expect(await check.run(pi as any, ctx() as any)).toEqual({
      code: 1,
      stdout: "out",
      stderr: "err",
    });
    expect(calls[0]).toEqual({
      command: "mise",
      args: ["run", "check:web"],
      options: { signal: undefined },
    });
  });
});
