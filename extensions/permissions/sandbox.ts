import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { wrapCommandWithSandboxLinux } from "@anthropic-ai/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js";
import { wrapCommandWithSandboxMacOS } from "@anthropic-ai/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js";
import { getDefaultWritePaths } from "@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js";
import type { BashOperations, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveConfiguredPath } from "./config.js";
import { scrubEnvironment } from "./env.js";
import type { PermissionsConfig, ResolvedPermissionMode, RuntimeStatus } from "./types.js";

let restrictedInitialized = false;
let restrictedEnabled = false;

function filesystemForMode(cwd: string, mode: ResolvedPermissionMode, config: PermissionsConfig) {
  return {
    denyRead: config.blockedPaths.map((path) => resolveConfiguredPath(cwd, path)),
    allowWrite: mode.shellWriteRoots.map((path) => resolveConfiguredPath(cwd, path)),
    denyWrite: config.blockedPaths.map((path) => resolveConfiguredPath(cwd, path)),
  };
}

async function wrapCommand(
  command: string,
  cwd: string,
  config: PermissionsConfig,
): Promise<string> {
  if (config.activeMode.networkMode === "restricted") {
    return SandboxManager.wrapWithSandbox(command);
  }

  const filesystem = filesystemForMode(cwd, config.activeMode, config);
  const readConfig = {
    denyOnly: filesystem.denyRead,
  };
  const writeConfig = {
    allowOnly: [...getDefaultWritePaths(), ...filesystem.allowWrite],
    denyWithinAllow: filesystem.denyWrite,
  };

  if (process.platform === "linux") {
    return wrapCommandWithSandboxLinux({
      command,
      needsNetworkRestriction: false,
      readConfig,
      writeConfig,
    });
  }

  return wrapCommandWithSandboxMacOS({
    command,
    needsNetworkRestriction: false,
    readConfig,
    writeConfig,
  });
}

export async function initializeSandbox(
  ctx: ExtensionContext,
  runtime: RuntimeStatus,
  config: PermissionsConfig,
): Promise<void> {
  const mode = config.activeMode;

  if (!mode.sandbox) {
    restrictedEnabled = false;
    restrictedInitialized = false;
    runtime.sandboxState = "off";
    runtime.sandboxReason = "disabled by mode";
    return;
  }

  if (process.platform !== "darwin" && process.platform !== "linux") {
    restrictedEnabled = false;
    restrictedInitialized = false;
    runtime.sandboxState = "unsupported";
    runtime.sandboxReason = `unsupported on ${process.platform}`;
    return;
  }

  if (mode.networkMode === "open") {
    restrictedEnabled = false;
    restrictedInitialized = false;
    runtime.sandboxState = "on";
    runtime.sandboxReason = undefined;
    return;
  }

  try {
    await SandboxManager.initialize({
      network: {
        allowedDomains: config.network.allowedDomains,
        deniedDomains: [],
      },
      filesystem: filesystemForMode(ctx.cwd, mode, config),
    });
    restrictedEnabled = true;
    restrictedInitialized = true;
    runtime.sandboxState = "on";
    runtime.sandboxReason = undefined;
  } catch (error) {
    restrictedEnabled = false;
    restrictedInitialized = false;
    runtime.sandboxState = "degraded";
    runtime.sandboxReason = error instanceof Error ? error.message : String(error);
  }
}

export async function resetSandbox() {
  if (!restrictedInitialized) return;
  restrictedInitialized = false;
  restrictedEnabled = false;
  try {
    await SandboxManager.reset();
  } catch {
    // ignore
  }
}

export function createBashOperations(
  runtime: RuntimeStatus,
  config: PermissionsConfig,
): BashOperations | null {
  if (!config.activeMode.sandbox || runtime.sandboxState !== "on") return null;
  if (
    config.activeMode.networkMode === "restricted" &&
    (!restrictedEnabled || !restrictedInitialized)
  ) {
    return null;
  }

  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }

      const wrappedCommand = await wrapCommand(command, cwd, config);

      return new Promise((resolvePromise, reject) => {
        const child = spawn("bash", ["-c", wrappedCommand], {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: scrubEnvironment({ ...process.env, PWD: cwd }),
        });

        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            }
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("error", (error) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(error);
        });

        const onAbort = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }
        };

        signal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);

          if (signal?.aborted) {
            reject(new Error("aborted"));
          } else if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
          } else {
            resolvePromise({ exitCode: code });
          }
        });
      });
    },
  };
}
