import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";
import { parseGuardianConfig } from "./config.js";
import { runGuardian } from "./guardian.js";
import type { GateRequest, GuardianComplete, GuardianDeps } from "./types.js";

const TEST_MODEL: Model<Api> = {
  id: "guardian-test",
  name: "Guardian Test",
  api: "openai-responses",
  provider: "test",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
};

function message(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: TEST_MODEL.api,
    provider: TEST_MODEL.provider,
    model: TEST_MODEL.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function request(): GateRequest {
  return {
    toolName: "bash",
    toolCallId: "call-1",
    kind: "bash",
    cwd: "/repo",
    command: "git status",
    inputSummary: "bash: git status",
  };
}

function deps(complete: GuardianComplete): GuardianDeps {
  return {
    resolveModel: async () => TEST_MODEL,
    resolveAuth: async () => ({ ok: true, apiKey: "key" }),
    complete,
    signal: undefined,
  };
}

describe("runGuardian", () => {
  test("returns allow and deny outcomes from valid JSON", async () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: true } });

    const allowed = await runGuardian(
      request(),
      config,
      deps(async () => message('{"outcome":"allow","reason":"safe"}')),
    );
    expect(allowed).toEqual({ outcome: "allow", reason: "safe" });

    const denied = await runGuardian(
      request(),
      config,
      deps(async () => message('{"outcome":"deny","reason":"risky"}')),
    );
    expect(denied).toEqual({ outcome: "deny", reason: "risky" });
  });

  test("retries once on malformed JSON", async () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: true } });
    const responses = [message("not json"), message('{"outcome":"allow","reason":"fixed"}')];
    let calls = 0;

    const result = await runGuardian(
      request(),
      config,
      deps(async () => responses[calls++] ?? message("{}")),
    );

    expect(result).toEqual({ outcome: "allow", reason: "fixed" });
    expect(calls).toBe(2);
  });

  test("returns error after double-malformed JSON", async () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: true } });

    const result = await runGuardian(
      request(),
      config,
      deps(async () => message("not json")),
    );

    expect(result.outcome).toBe("error");
  });

  test("returns error for model stopReason error", async () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: true } });

    const result = await runGuardian(
      request(),
      config,
      deps(async () => ({ ...message(""), stopReason: "error", errorMessage: "boom" })),
    );

    expect(result).toEqual({ outcome: "error", reason: "boom" });
  });

  test("returns error when model auth is unavailable", async () => {
    const config = parseGuardianConfig({ autoApprove: { enabled: true } });
    const result = await runGuardian(request(), config, {
      resolveModel: async () => TEST_MODEL,
      resolveAuth: async () => ({ ok: false, error: "missing auth" }),
      complete: async () => message("{}"),
      signal: undefined,
    });

    expect(result).toEqual({ outcome: "error", reason: "missing auth" });
  });
});
