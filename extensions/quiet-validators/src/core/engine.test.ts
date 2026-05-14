import { describe, expect, test } from "bun:test";
import { registerQuietValidationEngine } from "./engine.js";
import type { QuietCheck, QuietCheckProvider, Snapshot, ValidationRunResult } from "./types.js";

type Handler = (event: any, ctx: any) => Promise<void> | void;

type FakePi = {
  handlers: Map<string, Handler[]>;
  messages: Array<{ message: unknown; options: unknown }>;
  on(event: string, handler: Handler): void;
  sendMessage(message: unknown, options: unknown): void;
  registerMessageRenderer(): void;
};

function snapshot(entries: Array<[string, string]>): Snapshot {
  return new Map(entries);
}

function createPi(): FakePi {
  return {
    handlers: new Map(),
    messages: [],
    on(event, handler) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    },
    sendMessage(message, options) {
      this.messages.push({ message, options });
    },
    registerMessageRenderer() {},
  };
}

function createCtx() {
  const notifications: string[] = [];
  return {
    cwd: "/repo",
    hasUI: true,
    signal: undefined,
    notifications,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
    isIdle() {
      return true;
    },
  };
}

async function emit(pi: FakePi, event: string, payload: unknown, ctx: unknown): Promise<void> {
  for (const handler of pi.handlers.get(event) ?? []) {
    await handler(payload, ctx);
  }
}

function createCheck(options: {
  id: string;
  title: string;
  supported?: boolean;
  snapshots: Snapshot[];
  result?: ValidationRunResult;
  runs?: string[];
  throwOnScan?: boolean;
}): QuietCheck {
  let scanIndex = 0;
  return {
    id: options.id,
    title: options.title,
    async isSupported() {
      return options.supported ?? true;
    },
    async scanInputs() {
      if (options.throwOnScan) throw new Error("scan failed");
      const snapshotValue = options.snapshots[Math.min(scanIndex, options.snapshots.length - 1)];
      scanIndex += 1;
      return snapshotValue ?? snapshot([]);
    },
    async run() {
      options.runs?.push(options.id);
      return options.result ?? { code: 0, stdout: "", stderr: "" };
    },
    parseFailureGroups(output) {
      return [{ key: "failure", title: "Failure", count: 1, examples: output ? [output] : [] }];
    },
  };
}

function provider(checks: QuietCheck[]): QuietCheckProvider {
  return {
    async loadChecks() {
      return checks;
    },
  };
}

describe("quiet validation engine", () => {
  test("runs only dirty supported checks and summarizes ran checks", async () => {
    const runs: string[] = [];
    const dirty = createCheck({
      id: "dirty",
      title: "mise task: web",
      snapshots: [
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "2"]]),
        snapshot([["app.ts", "2"]]),
      ],
      runs,
    });
    const clean = createCheck({
      id: "clean",
      title: "mise task: swift",
      snapshots: [
        snapshot([["App.swift", "1"]]),
        snapshot([["App.swift", "1"]]),
        snapshot([["App.swift", "1"]]),
      ],
      runs,
    });
    const unsupported = createCheck({
      id: "unsupported",
      title: "mise task: docs",
      supported: false,
      snapshots: [],
      runs,
    });
    const pi = createPi();
    const ctx = createCtx();
    registerQuietValidationEngine(pi as any, provider([dirty, clean, unsupported]));

    await emit(pi, "agent_start", {}, ctx);
    await emit(pi, "turn_start", {}, ctx);
    await emit(pi, "turn_end", { toolResults: [] }, ctx);

    expect(runs).toEqual(["dirty"]);
    expect(ctx.notifications.includes("Validating mise task: web...")).toBe(true);
    expect(ctx.notifications.includes("Validation:\n\nmise task: web - passed")).toBe(true);
  });

  test("delays dirty checks when turn used tools and runs at agent_end", async () => {
    const runs: string[] = [];
    const check = createCheck({
      id: "web",
      title: "mise task: web",
      snapshots: [
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "2"]]),
        snapshot([["app.ts", "2"]]),
      ],
      runs,
    });
    const pi = createPi();
    const ctx = createCtx();
    registerQuietValidationEngine(pi as any, provider([check]));

    await emit(pi, "agent_start", {}, ctx);
    await emit(pi, "turn_start", {}, ctx);
    await emit(pi, "turn_end", { toolResults: [{ id: "tool" }] }, ctx);
    expect(runs).toEqual([]);

    await emit(pi, "agent_end", {}, ctx);
    expect(runs).toEqual(["web"]);
  });

  test("failed run sends steer message with details", async () => {
    const check = createCheck({
      id: "swift",
      title: "mise task: swift",
      snapshots: [
        snapshot([["App.swift", "1"]]),
        snapshot([["App.swift", "1"]]),
        snapshot([["App.swift", "2"]]),
        snapshot([["App.swift", "2"]]),
      ],
      result: { code: 1, stdout: "App.swift:1:1: error: bad", stderr: "" },
    });
    const pi = createPi();
    const ctx = createCtx();
    registerQuietValidationEngine(pi as any, provider([check]));

    await emit(pi, "agent_start", {}, ctx);
    await emit(pi, "turn_start", {}, ctx);
    await emit(pi, "turn_end", { toolResults: [] }, ctx);

    expect(pi.messages.length).toBe(1);
    expect(pi.messages[0]?.options).toEqual({ deliverAs: "steer", triggerTurn: true });
    const message = pi.messages[0]?.message as {
      customType?: string;
      display?: boolean;
      details?: Record<string, unknown>;
    };
    expect(message.customType).toBe("automation.mise-task");
    expect(message.display).toBe(true);
    expect(message.details).toEqual({
      changedFiles: ["App.swift"],
      exitCode: 1,
      failureGroups: [
        { key: "failure", title: "Failure", count: 1, examples: ["App.swift:1:1: error: bad"] },
      ],
      output: "App.swift:1:1: error: bad",
      title: "mise task: swift",
    });
    expect(message).toEqual({
      customType: "automation.mise-task",
      content:
        "mise task: swift failed after validator-relevant file changes.\nFix the reported failures before continuing.\n\nChanged files:\n- App.swift\n\nFailure groups:\n- Failure: 1\n  • App.swift:1:1: error: bad\n\nFailure excerpt:\nApp.swift:1:1: error: bad",
      display: true,
      details: {
        changedFiles: ["App.swift"],
        exitCode: 1,
        failureGroups: [
          { key: "failure", title: "Failure", count: 1, examples: ["App.swift:1:1: error: bad"] },
        ],
        title: "mise task: swift",
        output: "App.swift:1:1: error: bad",
      },
    });
    expect(ctx.notifications.includes("Validation:\n\nmise task: swift - failed")).toBe(true);
  });

  test("does not rerun without a new dirty snapshot", async () => {
    const runs: string[] = [];
    const check = createCheck({
      id: "web",
      title: "mise task: web",
      snapshots: [
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "2"]]),
        snapshot([["app.ts", "2"]]),
      ],
      result: { code: 1, stdout: "failed", stderr: "" },
      runs,
    });
    const pi = createPi();
    const ctx = createCtx();
    registerQuietValidationEngine(pi as any, provider([check]));

    await emit(pi, "agent_start", {}, ctx);
    await emit(pi, "turn_start", {}, ctx);
    await emit(pi, "turn_end", { toolResults: [] }, ctx);
    await emit(pi, "agent_end", {}, ctx);

    expect(runs).toEqual(["web"]);
  });

  test("one throwing check does not block other checks", async () => {
    const runs: string[] = [];
    const throwing = createCheck({
      id: "throwing",
      title: "mise task: throwing",
      snapshots: [],
      throwOnScan: true,
      runs,
    });
    const dirty = createCheck({
      id: "web",
      title: "mise task: web",
      snapshots: [
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "1"]]),
        snapshot([["app.ts", "2"]]),
        snapshot([["app.ts", "2"]]),
      ],
      runs,
    });
    const pi = createPi();
    const ctx = createCtx();
    registerQuietValidationEngine(pi as any, provider([throwing, dirty]));

    await emit(pi, "agent_start", {}, ctx);
    await emit(pi, "turn_start", {}, ctx);
    await emit(pi, "turn_end", { toolResults: [] }, ctx);

    expect(runs).toEqual(["web"]);
  });
});
