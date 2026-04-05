import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { truncateTail } from "@mariozechner/pi-coding-agent";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_EXEC_YIELD_MS = 10_000;
const DEFAULT_WRITE_YIELD_MS = 250;
const MIN_YIELD_MS = 250;
const MIN_EMPTY_POLL_MS = 5_000;
const MAX_YIELD_MS = 30_000;
const TERMINATION_GRACE_MS = 250;
const SESSION_WARNING_THRESHOLD = 60;
const MAX_TRACKED_SESSIONS = 64;
const FAST_EXIT_SETTLE_MS = 40;
let ensuredPtyHelpers = false;

function takeTailByBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  return bytes.subarray(bytes.length - maxBytes).toString("utf8");
}

function ensurePtyHelpersExecutable() {
  if (ensuredPtyHelpers) return;
  ensuredPtyHelpers = true;

  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve("node-pty/package.json");
    const packageRoot = dirname(packageJsonPath);
    const platformArch = `${process.platform}-${process.arch}`;
    const candidates = [
      join(packageRoot, "build", "Release", "spawn-helper"),
      join(packageRoot, "prebuilds", platformArch, "spawn-helper"),
    ];

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      chmodSync(path, 0o755);
    }
  } catch {
    // no-op
  }
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") next[key] = value;
  }
  return next;
}

export interface ExecCommandParams {
  cmd: string;
  workdir: string;
  shell?: string;
  login?: boolean;
  tty?: boolean;
  timeoutMs?: number;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
}

export interface WriteStdinParams {
  sessionId: number;
  chars?: string;
  yieldTimeMs?: number;
  maxOutputTokens?: number;
}

export interface ShellResultShape {
  chunk_id?: string;
  output: string;
  wall_time_seconds: number;
  exit_code?: number;
  session_id?: number;
  original_token_count?: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

class ShellSession {
  readonly id: number;
  readonly child: ChildProcess | undefined;
  readonly pty: IPty | undefined;
  readonly startedAt = Date.now();
  readonly waiters = new Set<Waiter>();
  readonly tty: boolean;
  lastUsedAt = Date.now();
  output = "";
  emittedChars = 0;
  endedAt: number | undefined;
  exitCode: number | undefined;
  timeoutHandle: NodeJS.Timeout | undefined;
  timedOut = false;
  finalReported = false;
  private chunkCounter = 0;

  constructor(id: number, child: ChildProcess | undefined, ptyProcess: IPty | undefined) {
    this.id = id;
    this.child = child;
    this.pty = ptyProcess;
    this.tty = ptyProcess !== undefined;
  }

  get wallTimeSeconds(): number {
    const end = this.endedAt ?? Date.now();
    return Math.max(0, (end - this.startedAt) / 1000);
  }

  append(text: string) {
    if (!text) return;
    this.output += text;
    this.lastUsedAt = Date.now();
    this.wake();
  }

  finish(exitCode: number | null | undefined) {
    if (this.endedAt !== undefined) return;
    this.endedAt = Date.now();
    this.lastUsedAt = this.endedAt;
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }

    if (this.timedOut) {
      this.exitCode = 124;
    } else if (exitCode === null || exitCode === undefined) {
      this.exitCode = 1;
    } else {
      this.exitCode = exitCode;
    }

    this.wake();
  }

  isRunning(): boolean {
    return this.endedAt === undefined;
  }

  isComplete(): boolean {
    return !this.isRunning();
  }

  nextChunkId(): string {
    this.chunkCounter += 1;
    return `${this.id}:${this.chunkCounter}`;
  }

  async waitForChangeOrExit(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.isComplete()) return;
    if (this.output.length !== this.emittedChars) return;

    const waitMs = Math.max(0, ms);
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (abortListener) signal?.removeEventListener("abort", abortListener);
        this.waiters.delete(waiter);
      };

      const waiter: Waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };

      timer = setTimeout(() => waiter.resolve(), waitMs);

      if (signal) {
        abortListener = () => {
          terminateSessionProcess(this);
          waiter.reject(new Error("Exec session aborted."));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }

      this.waiters.add(waiter);
    });
  }

  async waitForExit(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.isComplete()) return;

    const waitMs = Math.max(0, ms);
    await new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (abortListener) signal?.removeEventListener("abort", abortListener);
        this.waiters.delete(waiter);
      };

      const waiter: Waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };

      timer = setTimeout(() => waiter.resolve(), waitMs);

      if (signal) {
        abortListener = () => {
          terminateSessionProcess(this);
          waiter.reject(new Error("Exec session aborted."));
        };
        signal.addEventListener("abort", abortListener, { once: true });
      }

      this.waiters.add(waiter);
    });
  }

  consumeDelta(maxOutputTokens?: number): { output: string; originalTokenCount?: number } {
    const delta = this.output.slice(this.emittedChars);
    this.emittedChars = this.output.length;
    this.lastUsedAt = Date.now();

    if (!delta) return { output: "" };

    const truncation = truncateTail(delta, {
      maxBytes: maxOutputTokens ? Math.max(1024, maxOutputTokens * 4) : undefined,
    });

    if (!truncation.truncated) {
      return { output: delta };
    }

    const fallbackTail =
      truncation.content.length > 0
        ? truncation.content
        : takeTailByBytes(delta, maxOutputTokens ? Math.max(1024, maxOutputTokens * 4) : 1024);

    return {
      output: `${fallbackTail}\n\n[output truncated]`,
      originalTokenCount: Math.ceil(truncation.totalBytes / 4),
    };
  }

  writeInput(chars: string) {
    if (this.pty) {
      this.pty.write(chars);
      return;
    }

    throw new Error(
      "stdin is closed for this session; rerun exec_command with tty=true to keep stdin open",
    );
  }

  private wake() {
    for (const waiter of Array.from(this.waiters)) {
      waiter.resolve();
    }
  }
}

async function commandExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function buildPtyEnv(): Record<string, string> {
  return sanitizeEnv({
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    LC_CTYPE: process.env.LC_CTYPE || "C.UTF-8",
  });
}

function buildPipeEnv(): Record<string, string> {
  return sanitizeEnv({
    ...process.env,
    NO_COLOR: "1",
    TERM: "dumb",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    LC_CTYPE: process.env.LC_CTYPE || "C.UTF-8",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GH_PAGER: "cat",
  });
}

async function resolveShellCommand(
  login: boolean,
  explicitShell?: string,
): Promise<{ command: string; args: string[] }> {
  if (process.platform === "win32") {
    const chosen = explicitShell?.trim() || process.env.COMSPEC || "cmd.exe";
    if (/powershell/i.test(chosen)) {
      return { command: chosen, args: ["-NoProfile", "-Command"] };
    }
    return {
      command: chosen,
      args: ["/d", "/s", "/c"],
    };
  }

  const preferred = explicitShell?.trim() || process.env.SHELL?.trim();
  const candidates = [preferred, "/bin/bash", "/bin/zsh", "/bin/sh"].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      const supportsLogin = candidate.endsWith("bash") || candidate.endsWith("zsh");
      if (login && supportsLogin) return { command: candidate, args: ["-lc"] };
      return { command: candidate, args: ["-c"] };
    }
  }

  return {
    command: "sh",
    args: ["-c"],
  };
}

function terminateSessionProcess(session: ShellSession) {
  if (session.pty) {
    try {
      session.pty.kill();
    } catch {
      // no-op
    }
    return;
  }

  if (!session.child || session.child.killed) return;
  session.child.kill("SIGTERM");
  setTimeout(() => {
    if (!session.child || session.child.killed) return;
    session.child.kill("SIGKILL");
  }, TERMINATION_GRACE_MS).unref();
}

function clampWriteYield(yieldTimeMs: number | undefined, hasInput: boolean): number {
  const value = yieldTimeMs ?? DEFAULT_WRITE_YIELD_MS;
  const clamped = Math.max(MIN_YIELD_MS, Math.min(MAX_YIELD_MS, Math.floor(value)));
  if (!hasInput) return Math.max(MIN_EMPTY_POLL_MS, clamped);
  return clamped;
}

function clampStartYield(yieldTimeMs: number | undefined): number {
  if (yieldTimeMs === undefined) return DEFAULT_EXEC_YIELD_MS;
  return Math.max(MIN_YIELD_MS, Math.min(MAX_YIELD_MS, Math.floor(yieldTimeMs)));
}

export class ShellSessionManager {
  private nextSessionId = 1;
  private readonly sessions = new Map<number, ShellSession>();
  private warnedNearCapacity = false;

  async start(params: ExecCommandParams, signal?: AbortSignal): Promise<ShellResultShape> {
    this.pruneSessions();
    if (this.sessions.size >= MAX_TRACKED_SESSIONS) {
      throw new Error(`Too many active exec sessions (${this.sessions.size}).`);
    }

    const shell = await resolveShellCommand(params.login ?? true, params.shell);
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const session = params.tty
      ? this.startPtySession(shell.command, shell.args, params.cmd, params.workdir)
      : this.startPipeSession(shell.command, shell.args, params.cmd, params.workdir);

    this.sessions.set(session.id, session);
    this.maybeWarnNearCapacity();

    session.timeoutHandle = setTimeout(() => {
      if (!session.isRunning()) return;
      session.timedOut = true;
      session.append(`\n[command timed out after ${timeoutMs}ms]\n`);
      terminateSessionProcess(session);
    }, timeoutMs);

    await session.waitForChangeOrExit(clampStartYield(params.yieldTimeMs), signal);

    const hasUnconsumedOutput = session.output.length !== session.emittedChars;
    if (session.isRunning() && hasUnconsumedOutput) {
      await session.waitForExit(FAST_EXIT_SETTLE_MS, signal);
    }

    return this.buildResult(session, params.maxOutputTokens);
  }

  async write(params: WriteStdinParams, signal?: AbortSignal): Promise<ShellResultShape> {
    this.pruneSessions();

    const session = this.sessions.get(params.sessionId);
    if (!session || session.finalReported) {
      throw new Error(`Unknown or completed session_id: ${params.sessionId}`);
    }

    const hasInput = typeof params.chars === "string" && params.chars.length > 0;
    if (hasInput) {
      session.writeInput(params.chars as string);
    }

    await session.waitForChangeOrExit(clampWriteYield(params.yieldTimeMs, hasInput), signal);
    return this.buildResult(session, params.maxOutputTokens);
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      terminateSessionProcess(session);
    }
    this.sessions.clear();
  }

  private startPipeSession(
    command: string,
    shellArgs: string[],
    cmd: string,
    workdir: string,
  ): ShellSession {
    const child = spawn(command, [...shellArgs, cmd], {
      cwd: workdir,
      env: buildPipeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const session = new ShellSession(this.nextSessionId++, child, undefined);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => session.append(chunk));
    child.stderr?.on("data", (chunk: string) => session.append(chunk));
    child.on("error", (error) => {
      session.append(`\n[exec error] ${error.message}\n`);
      session.finish(1);
    });
    child.on("close", (code) => session.finish(code));
    return session;
  }

  private startPtySession(
    command: string,
    shellArgs: string[],
    cmd: string,
    workdir: string,
  ): ShellSession {
    ensurePtyHelpersExecutable();
    const ptyProcess = pty.spawn(command, [...shellArgs, cmd], {
      cwd: workdir,
      env: buildPtyEnv(),
      name: process.env.TERM || "xterm-256color",
      cols: 120,
      rows: 30,
    });

    const session = new ShellSession(this.nextSessionId++, undefined, ptyProcess);
    ptyProcess.onData((chunk) => session.append(chunk));
    ptyProcess.onExit(({ exitCode }) => session.finish(exitCode));
    return session;
  }

  private buildResult(session: ShellSession, maxOutputTokens?: number): ShellResultShape {
    const delta = session.consumeDelta(maxOutputTokens);
    const status: string[] = [];
    if (session.isRunning()) {
      status.push(`session ${session.id} running`);
    } else {
      status.push(`exit ${session.exitCode ?? 1}`);
    }
    status.push(`${session.wallTimeSeconds.toFixed(2)}s`);

    const output = delta.output.length > 0 ? delta.output : `[${status.join(" · ")}]`;
    const result: ShellResultShape = {
      output,
      wall_time_seconds: session.wallTimeSeconds,
    };

    if (delta.originalTokenCount !== undefined) {
      result.original_token_count = delta.originalTokenCount;
    }

    const hasStateTransition = session.isComplete();
    if (delta.output.length > 0 || hasStateTransition) {
      result.chunk_id = session.nextChunkId();
    }

    if (session.isRunning()) {
      result.session_id = session.id;
      return result;
    }

    result.exit_code = session.exitCode ?? 1;
    session.finalReported = true;
    this.sessions.delete(session.id);
    this.resetCapacityWarningIfRecovered();
    return result;
  }

  private pruneSessions() {
    if (this.sessions.size < MAX_TRACKED_SESSIONS) return;

    const completed = Array.from(this.sessions.values())
      .filter((session) => session.isComplete())
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    for (const session of completed) {
      if (this.sessions.size < MAX_TRACKED_SESSIONS) break;
      this.sessions.delete(session.id);
    }

    const running = Array.from(this.sessions.values())
      .filter((session) => session.isRunning())
      .sort((a, b) => a.startedAt - b.startedAt);

    for (const session of running) {
      if (this.sessions.size < MAX_TRACKED_SESSIONS) break;
      session.append("\n[session closed due to session limit]\n");
      terminateSessionProcess(session);
      this.sessions.delete(session.id);
    }

    this.resetCapacityWarningIfRecovered();
  }

  private maybeWarnNearCapacity() {
    if (this.warnedNearCapacity || this.sessions.size < SESSION_WARNING_THRESHOLD) return;
    this.warnedNearCapacity = true;
    console.warn(`codex-compat: ${this.sessions.size} exec sessions are currently tracked.`);
  }

  private resetCapacityWarningIfRecovered() {
    if (this.sessions.size < SESSION_WARNING_THRESHOLD) {
      this.warnedNearCapacity = false;
    }
  }
}

export function normalizeTimeoutMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}

export function normalizeYieldMs(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

export function normalizeMaxOutputTokens(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}
