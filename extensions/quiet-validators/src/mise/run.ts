import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ValidationRunResult } from "../core/types.js";

export async function canRunMiseTask(
  pi: ExtensionAPI,
  task: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await pi.exec(
    "bash",
    [
      "-lc",
      `command -v mise >/dev/null 2>&1 || exit 127\n` +
        `test -f mise.toml || exit 126\n` +
        `mise tasks info ${JSON.stringify(task)} --json >/dev/null 2>&1 || exit 125`,
    ],
    { signal },
  );
  return result.code === 0;
}

export async function runMiseTask(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  task: string,
): Promise<ValidationRunResult> {
  const result = await pi.exec("mise", ["run", task], { signal: ctx.signal });
  return { code: result.code, stdout: result.stdout || "", stderr: result.stderr || "" };
}
