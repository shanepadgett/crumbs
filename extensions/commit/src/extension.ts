import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadCommitConfig } from "./config.js";
import { collectCommitEvidence } from "./evidence.js";
import { renderCommitPrompt } from "./prompt.js";
import { runCommitAgent } from "./run.js";

const COMMAND_DESCRIPTION = "Create semantic git commit(s) from injected git snapshot";
const ESCAPE_KEY = "\x1b";

interface CommitCancelScope {
  signal: AbortSignal;
  dispose(): void;
}

function formatResult(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= 4000) return trimmed;
  return `${trimmed.slice(0, 3990)}…`;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function wasCancelled(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function createCommitCancelScope(ctx: ExtensionCommandContext): CommitCancelScope {
  const controller = new AbortController();
  const parentSignal = ctx.signal;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };

  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });

  const removeTerminalInput = ctx.ui.onTerminalInput((data) => {
    if (data !== ESCAPE_KEY) return undefined;
    abort();
    return { consume: true };
  });

  return {
    signal: controller.signal,
    dispose() {
      parentSignal?.removeEventListener("abort", abort);
      removeTerminalInput();
    },
  };
}

async function handleCommit(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  signal: AbortSignal,
): Promise<void> {
  let evidence;
  try {
    evidence = await collectCommitEvidence(pi, ctx.cwd, { signal });
  } catch (error) {
    if (wasCancelled(signal)) {
      ctx.ui.notify("/commit cancelled.", "info");
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Unable to prepare /commit snapshot: ${message}`, "error");
    return;
  }

  if (wasCancelled(signal)) {
    ctx.ui.notify("/commit cancelled.", "info");
    return;
  }

  if (!evidence) {
    ctx.ui.notify("No git repository found or no uncommitted changes detected.", "info");
    return;
  }

  const config = await loadCommitConfig(evidence.repoRoot);
  if (wasCancelled(signal)) {
    ctx.ui.notify("/commit cancelled.", "info");
    return;
  }

  const prompt = renderCommitPrompt(evidence, config);

  try {
    ctx.ui.notify("/commit working…", "info");
    const result = await runCommitAgent(
      evidence.repoRoot,
      prompt,
      (update) => {
        ctx.ui.notify(update.message, update.level ?? "info");
      },
      { signal },
    );

    if (wasCancelled(signal)) {
      ctx.ui.notify("/commit cancelled.", "info");
      return;
    }

    ctx.ui.notify(
      formatResult(
        `/commit finished in ${formatDuration(result.durationMs)} (${result.model}, ${result.thinkingLevel})\n\n${result.output}`,
      ),
      "info",
    );
  } catch (error) {
    if (wasCancelled(signal)) {
      ctx.ui.notify("/commit cancelled.", "info");
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Unable to run /commit: ${message}`, "error");
  }
}

export default function commitExtension(pi: ExtensionAPI): void {
  pi.registerCommand("commit", {
    description: COMMAND_DESCRIPTION,
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const cancelScope = createCommitCancelScope(ctx);
      try {
        await handleCommit(pi, ctx, cancelScope.signal);
      } finally {
        cancelScope.dispose();
      }
    },
  });
}
