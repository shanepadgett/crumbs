import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type TerminalClearState = {
  startupCleared: boolean;
  exitHooked: boolean;
  clearOnExit: boolean;
};

const STATE_KEY = Symbol.for("@crumbs-pi/terminal-clear/state");

function getState(): TerminalClearState {
  const globalState = globalThis as typeof globalThis &
    Record<symbol, TerminalClearState | undefined>;
  const state = globalState[STATE_KEY] ?? {
    startupCleared: false,
    exitHooked: false,
    clearOnExit: false,
  };
  globalState[STATE_KEY] = state;
  return state;
}

function supportsAnsiClear(): boolean {
  if (process.platform !== "win32") return true;

  return Boolean(
    process.env.WT_SESSION ||
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.TERM?.includes("xterm") ||
    process.env.ANSICON ||
    process.env.ConEmuANSI === "ON",
  );
}

function getClearSequence(): string {
  if (!supportsAnsiClear()) {
    return "\n".repeat(process.stdout.rows || 30) + "\x1b[H\x1b[0m\x1b[?25h";
  }

  return "\x1b[0m\x1b[?25h\x1b[H\x1b[2J\x1b[3J";
}

function clearTerminal(): void {
  try {
    process.stdout.write(getClearSequence());
  } catch {
    // Ignore terminal write failures during process shutdown.
  }
}

function shouldClearAfterShutdown(event: { type: "session_shutdown"; reason?: unknown }): boolean {
  if (typeof event.reason === "string") return event.reason === "quit";
  return true;
}

export default function terminalClearExtension(pi: ExtensionAPI): void {
  if (!process.stdout.isTTY) return;

  const state = getState();
  state.clearOnExit = false;

  pi.on("session_shutdown", (event) => {
    state.clearOnExit = shouldClearAfterShutdown(event);
  });

  if (!state.exitHooked) {
    state.exitHooked = true;
    process.on("exit", () => {
      if (state.clearOnExit) clearTerminal();
    });
  }

  if (!state.startupCleared) {
    state.startupCleared = true;
    clearTerminal();
  }
}
