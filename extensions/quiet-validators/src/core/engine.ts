import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildFailureContent, buildFailureDetails } from "./messages.js";
import { MISE_TASK_MESSAGE_TYPE, registerQuietValidationRenderer } from "./renderer.js";
import { buildValidationSignature, diffSnapshots } from "./snapshots.js";
import type { QuietCheck, QuietCheckProvider, Snapshot } from "./types.js";

type CheckState = {
  check: QuietCheck;
  baseline: Snapshot;
  turnStart: Snapshot;
  dirty: boolean;
  inFlight: boolean;
  lastAttemptedSignature: string | null;
};

type SummaryEntry = {
  title: string;
  status: "passed" | "failed";
};

function renderValidationSummary(entries: SummaryEntry[]): string {
  const lines = ["Validation:", "", ...entries.map((entry) => `${entry.title} - ${entry.status}`)];
  return lines.join("\n");
}

function hasToolResults(event: { toolResults?: unknown[] }): boolean {
  return Array.isArray(event.toolResults) && event.toolResults.length > 0;
}

async function runCheck(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: CheckState,
): Promise<SummaryEntry | null> {
  if (state.inFlight || !state.dirty) return null;

  const current = await state.check.scanInputs(ctx.cwd);
  const changedFiles = diffSnapshots(state.baseline, current);
  if (changedFiles.length === 0) {
    state.baseline = current;
    state.turnStart = current;
    state.dirty = false;
    state.lastAttemptedSignature = null;
    return null;
  }

  const validationSignature = buildValidationSignature(current, changedFiles);
  if (validationSignature === state.lastAttemptedSignature) return null;

  state.inFlight = true;
  state.lastAttemptedSignature = validationSignature;
  if (ctx.hasUI) ctx.ui.notify(`Validating ${state.check.title}...`, "info");

  try {
    const result = await state.check.run(pi, ctx);
    if (result.code === 0) {
      state.baseline = current;
      state.turnStart = current;
      state.dirty = false;
      state.lastAttemptedSignature = null;
      return { title: state.check.title, status: "passed" };
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    const failureGroups = state.check.parseFailureGroups(output);
    const message = {
      customType: MISE_TASK_MESSAGE_TYPE,
      content: buildFailureContent(state.check.title, changedFiles, failureGroups, output),
      display: true,
      details: buildFailureDetails(
        state.check.title,
        changedFiles,
        result.code,
        failureGroups,
        output,
      ),
    };

    if (ctx.isIdle()) {
      pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
    } else {
      pi.sendMessage(message, { deliverAs: "steer" });
    }

    state.baseline = current;
    state.turnStart = current;
    state.dirty = false;
    state.lastAttemptedSignature = null;
    return { title: state.check.title, status: "failed" };
  } finally {
    state.inFlight = false;
  }
}

export function registerQuietValidationEngine(
  pi: ExtensionAPI,
  provider: QuietCheckProvider,
): void {
  const states = new Map<string, CheckState>();

  registerQuietValidationRenderer(pi);

  async function runDirtyChecks(ctx: ExtensionContext): Promise<void> {
    const summary: SummaryEntry[] = [];
    for (const state of states.values()) {
      let entry: SummaryEntry | null = null;
      try {
        entry = await runCheck(pi, ctx, state);
      } catch {
        entry = null;
      }
      if (entry) summary.push(entry);
    }

    if (ctx.hasUI && summary.length > 0) {
      ctx.ui.notify(renderValidationSummary(summary), "info");
    }
  }

  pi.on("agent_start", async (_event, ctx) => {
    states.clear();
    const checks = await provider.loadChecks(ctx.cwd);

    for (const check of checks) {
      let baseline: Snapshot | null = null;
      try {
        if (!(await check.isSupported(pi, ctx))) continue;
        baseline = await check.scanInputs(ctx.cwd);
      } catch {
        continue;
      }
      if (!baseline) continue;

      states.set(check.id, {
        check,
        baseline,
        turnStart: baseline,
        dirty: false,
        inFlight: false,
        lastAttemptedSignature: null,
      });
    }
  });

  pi.on("turn_start", async (_event, ctx) => {
    for (const state of states.values()) {
      try {
        state.turnStart = await state.check.scanInputs(ctx.cwd);
      } catch {
        state.turnStart = state.baseline;
      }
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    for (const state of states.values()) {
      try {
        const current = await state.check.scanInputs(ctx.cwd);
        if (diffSnapshots(state.turnStart, current).length > 0) state.dirty = true;
      } catch {
        continue;
      }
    }

    if (hasToolResults(event)) return;
    await runDirtyChecks(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    await runDirtyChecks(ctx);
  });
}
