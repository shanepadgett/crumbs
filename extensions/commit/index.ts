/**
 * Fast Commit Command Extension
 *
 * What this does:
 * - Adds `/commit` command that collects compact git snapshot (status, summaries, staged+unstaged diffs).
 * - Runs commit work in clean child session using `openai-codex/gpt-5.5` with `high` thinking.
 * - Reports child session result without injecting commit context into current chat.
 *
 * How to use:
 * - Run `/commit` inside git repo with uncommitted changes.
 * - Agent first states commit groups, then executes commits.
 *
 * Example:
 * - Make edits across files.
 * - Run `/commit`.
 * - Agent proposes groups, then creates commit(s).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { collectCommitEvidence } from "./src/evidence.js";
import { renderCommitPrompt } from "./src/prompt.js";
import { runCommitAgent } from "./src/run.js";

const COMMAND_DESCRIPTION = "Create semantic git commit(s) from injected git snapshot";

function formatResult(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= 4000) return trimmed;
  return `${trimmed.slice(0, 3990)}…`;
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
        ctx.ui.notify("/commit running in clean child session…", "info");
        const result = await runCommitAgent(evidence.repoRoot, prompt);
        ctx.ui.notify(
          formatResult(`/commit finished (${result.model})\n\n${result.output}`),
          "info",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to run /commit: ${message}`, "error");
      }
    },
  });
}
