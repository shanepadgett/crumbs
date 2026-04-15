/**
 * Fast Commit Command Extension
 *
 * What this does:
 * - Adds `/commit` command that injects compact git snapshot (status, summaries, staged+unstaged diffs).
 * - Always switches `/commit` run to `openai-codex/gpt-5.4-mini` with `high` thinking.
 * - Restores previous model and thinking level after run ends or session changes.
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

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { collectCommitEvidence } from "./src/evidence.js";
import { renderCommitPrompt } from "./src/prompt.js";

const COMMAND_DESCRIPTION = "Create semantic git commit(s) from injected git snapshot";
const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.4-mini";
const THINKING_LEVEL = "high";
const TRIGGER_PREFIX =
  "Create git commit(s) from injected /commit context only. First state intended commit groups, then execute those groups.";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PendingCommitRun {
  expectedPrompt: string;
  injected: boolean;
  prompt: string;
  restoreModelProvider?: string;
  restoreModelId?: string;
  restoreThinkingLevel: ThinkingLevel;
}

type RestoreContext = Pick<ExtensionCommandContext, "modelRegistry">;

function buildTriggerMessage(nonce: string): string {
  return `${TRIGGER_PREFIX}\n\ncommit_nonce: ${nonce}`;
}

async function restoreRun(
  pi: ExtensionAPI,
  run: PendingCommitRun,
  ctx: RestoreContext,
): Promise<void> {
  if (run.restoreModelProvider && run.restoreModelId) {
    const model = ctx.modelRegistry.find(run.restoreModelProvider, run.restoreModelId);
    if (model) await pi.setModel(model);
  }

  pi.setThinkingLevel(run.restoreThinkingLevel);
}

export default function commitExtension(pi: ExtensionAPI): void {
  let pendingRun: PendingCommitRun | null = null;

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

      const nonce = randomUUID();
      const trigger = buildTriggerMessage(nonce);
      const prompt = renderCommitPrompt(evidence);

      pendingRun = {
        expectedPrompt: trigger,
        injected: false,
        prompt,
        restoreModelProvider: ctx.model?.provider,
        restoreModelId: ctx.model?.id,
        restoreThinkingLevel: pi.getThinkingLevel(),
      };

      const miniModel = ctx.modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
      if (miniModel) {
        const switched = await pi.setModel(miniModel);
        if (!switched)
          ctx.ui.notify(
            `Unable to switch /commit model to ${MODEL_PROVIDER}/${MODEL_ID}.`,
            "warning",
          );
      } else {
        ctx.ui.notify(`Unable to find /commit model ${MODEL_PROVIDER}/${MODEL_ID}.`, "warning");
      }

      pi.setThinkingLevel(THINKING_LEVEL);

      try {
        pi.sendUserMessage(trigger);
      } catch (error) {
        if (pendingRun) await restoreRun(pi, pendingRun, ctx);
        pendingRun = null;

        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unable to start /commit run: ${message}`, "error");
      }
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!pendingRun) return;

    if (event.prompt !== pendingRun.expectedPrompt) {
      await restoreRun(pi, pendingRun, ctx);
      pendingRun = null;
      return;
    }

    if (pendingRun.injected) return;
    pendingRun.injected = true;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${pendingRun.prompt}`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!pendingRun) return;
    const restore = pendingRun;
    pendingRun = null;
    await restoreRun(pi, restore, ctx);
  });

  pi.on("session_before_switch", async (_event, ctx) => {
    if (!pendingRun) return;
    const restore = pendingRun;
    pendingRun = null;
    await restoreRun(pi, restore, ctx);
  });

  pi.on("session_before_fork", async (_event, ctx) => {
    if (!pendingRun) return;
    const restore = pendingRun;
    pendingRun = null;
    await restoreRun(pi, restore, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!pendingRun) return;
    const restore = pendingRun;
    pendingRun = null;
    await restoreRun(pi, restore, ctx);
  });
}
