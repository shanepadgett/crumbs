import { spawn } from "node:child_process";

export type PathfinderPhase = "starting" | "searching" | "reading" | "synthesizing";

export interface PathfinderUsage {
  input: number;
  output: number;
  cost: number;
  turns: number;
  model?: string;
}

export interface PathfinderProgress {
  phase: PathfinderPhase;
  note?: string;
  searches: number;
  fetches: number;
}

export interface RunPathfinderOptions {
  cwd: string;
  task: string;
  systemPrompt: string;
  model: string;
  extensionPaths: string[];
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  onProgress?: (progress: PathfinderProgress) => void;
}

export interface RunPathfinderResult {
  exitCode: number;
  output: string;
  stderr: string;
  usage: PathfinderUsage;
  searches: number;
  fetches: number;
  elapsedMs: number;
  abortedBy?: "signal";
  budgetExhausted?: true;
}

interface JsonEvent {
  type?: string;
  message?: {
    role?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cost?: { total?: number };
    };
    content?: Array<{ type?: string; text?: string }>;
  };
  toolName?: string;
  arguments?: unknown;
  input?: unknown;
  params?: unknown;
  args?: unknown;
  toolArguments?: unknown;
  toolInput?: unknown;
  toolCall?: {
    arguments?: unknown;
    params?: unknown;
    input?: unknown;
  };
}

function parseJsonLine(line: string): JsonEvent | null {
  try {
    const parsed = JSON.parse(line) as JsonEvent;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function messageText(message: JsonEvent["message"]): string {
  if (!message?.content || !Array.isArray(message.content)) return "";
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function assistantText(message: JsonEvent["message"]): string {
  return messageText(message);
}

function usageFromMessage(message: JsonEvent["message"]): PathfinderUsage {
  return {
    input: message?.usage?.input ?? 0,
    output: message?.usage?.output ?? 0,
    cost: message?.usage?.cost?.total ?? 0,
    turns: 1,
    model: message?.model,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function extractToolArg(event: JsonEvent, key: "query" | "url"): string | undefined {
  const candidates: unknown[] = [
    event.arguments,
    event.input,
    event.params,
    event.args,
    event.toolArguments,
    event.toolInput,
    event.toolCall?.arguments,
    event.toolCall?.params,
    event.toolCall?.input,
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

export async function runPathfinder(options: RunPathfinderOptions): Promise<RunPathfinderResult> {
  const args: string[] = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-tools",
    "--model",
    options.model,
  ];

  for (const extPath of options.extensionPaths) {
    args.push("-e", extPath);
  }

  args.push("--append-system-prompt", options.systemPrompt, options.task);

  const usage: PathfinderUsage = {
    input: 0,
    output: 0,
    cost: 0,
    turns: 0,
    model: options.model,
  };

  const startedAt = Date.now();
  let finalOutput = "";
  let stderr = "";
  let searches = 0;
  let fetches = 0;
  let abortedBy: "signal" | undefined;
  let budgetExhausted: true | undefined;

  options.onProgress?.({ phase: "starting", searches, fetches, note: "launching process" });

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn("pi", args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...options.env,
        CRUMBS_PATHFINDER_CHILD: "1",
      },
    });

    let stdoutBuffer = "";

    const emitProgress = (progress: PathfinderProgress) => {
      options.onProgress?.(progress);
    };

    const handleLine = (line: string) => {
      const event = parseJsonLine(line);
      if (!event?.type) return;

      if (event.type === "tool_execution_start") {
        if (event.toolName === "websearch") {
          searches++;
          const query = extractToolArg(event, "query");
          emitProgress({
            phase: "searching",
            searches,
            fetches,
            note: query ? `query: ${query}` : `search ${searches}`,
          });
          return;
        }

        if (event.toolName === "webfetch") {
          fetches++;
          const url = extractToolArg(event, "url");
          emitProgress({
            phase: "reading",
            searches,
            fetches,
            note: url ? `url: ${url}` : `page ${fetches}`,
          });
          return;
        }
      }

      if (event.type === "message_end" && event.message?.role === "user") {
        const text = messageText(event.message);
        if (text.startsWith("Stop searching and fetching now.")) {
          budgetExhausted = true;
        }
        return;
      }

      if (event.type === "message_end" && event.message?.role === "assistant") {
        const text = assistantText(event.message);
        if (text.length > 0) finalOutput = text;

        const sample = usageFromMessage(event.message);
        usage.turns += sample.turns;
        usage.input += sample.input;
        usage.output += sample.output;
        usage.cost += sample.cost;
        if (sample.model) usage.model = sample.model;
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        handleLine(trimmed);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const last = stdoutBuffer.trim();
      if (last) handleLine(last);
      resolve(code ?? 0);
    });

    proc.on("error", () => {
      resolve(1);
    });

    if (options.signal) {
      const terminate = () => {
        if (!abortedBy) abortedBy = "signal";
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 3000);
      };

      if (options.signal.aborted) terminate();
      else options.signal.addEventListener("abort", terminate, { once: true });
    }
  });

  return {
    exitCode,
    output: finalOutput,
    stderr,
    usage,
    searches,
    fetches,
    elapsedMs: Date.now() - startedAt,
    abortedBy,
    budgetExhausted,
  };
}
