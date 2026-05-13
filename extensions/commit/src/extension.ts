import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { collectCommitEvidence } from "./evidence.js";
import { renderCommitPrompt } from "./prompt.js";
import { runCommitAgent } from "./run.js";

const COMMAND_DESCRIPTION = "Create semantic git commit(s) from injected git snapshot";

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

export default function commitExtension(pi: ExtensionAPI): void {
  pi.registerCommand("commit", {
    description: COMMAND_DESCRIPTION,
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      let evidence;
      try {
        evidence = await collectCommitEvidence(pi, ctx.cwd);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to prepare /commit snapshot: ${message}`, "error");
        return;
      }

      if (!evidence) {
        ctx.ui.notify("No git repository found or no uncommitted changes detected.", "info");
        return;
      }

      const prompt = renderCommitPrompt(evidence);

      try {
        ctx.ui.notify("/commit working…", "info");
        const result = await runCommitAgent(evidence.repoRoot, prompt, (update) => {
          ctx.ui.notify(update.message, update.level ?? "info");
        });
        ctx.ui.notify(
          formatResult(
            `/commit finished in ${formatDuration(result.durationMs)} (${result.model}, ${result.thinkingLevel})\n\n${result.output}`,
          ),
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to run /commit: ${message}`, "error");
      }
    },
  });
}
