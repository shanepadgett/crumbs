import {
  DynamicBorder,
  type ExtensionAPI,
  type ExtensionCommandContext,
  keyHint,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Container, Loader, Spacer, Text, type TUI } from "@earendil-works/pi-tui";
import { loadCommitConfig } from "./config.js";
import { collectCommitEvidence } from "./evidence.js";
import { renderCommitPrompt } from "./prompt.js";
import { type CommitAgentUpdate, runCommitAgent } from "./run.js";
import { CRUMBS_EVENT_GIT_STATUS_REFRESH_REQUESTED } from "../../shared/crumbs-events.js";

const COMMAND_DESCRIPTION = "Create semantic git commit(s) from injected git snapshot";
type CommitCancelResult = "cancelled" | "done";
type CommitProgressUpdate = CommitAgentUpdate;
interface CommitNotification {
  message: string;
  level: "info" | "warning" | "error";
}

class CommitProgressComponent extends Container {
  private loader: Loader;

  constructor(
    tui: TUI,
    theme: Theme,
    private keybindings: KeybindingsManager,
    message: string,
    private onCancel: () => void,
  ) {
    super();
    const borderColor = (text: string) => theme.fg("border", text);
    this.loader = new Loader(
      tui,
      (text) => theme.fg("accent", text),
      (text) => theme.fg("muted", text),
      message,
    );

    this.addChild(new DynamicBorder(borderColor));
    this.addChild(this.loader);
    this.addChild(new Spacer(1));
    this.addChild(new Text(keyHint("tui.select.cancel", "cancel"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder(borderColor));
  }

  setStatus(update: CommitProgressUpdate): void {
    this.loader.setMessage(update.message);
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) this.onCancel();
  }

  dispose(): void {
    this.loader.stop();
  }
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

async function runWithCommitCancelUI(
  ctx: ExtensionCommandContext,
  run: (
    signal: AbortSignal,
    setProgress: (update: CommitProgressUpdate) => void,
  ) => Promise<CommitNotification | undefined>,
): Promise<CommitNotification | undefined> {
  const controller = new AbortController();
  const parentSignal = ctx.signal;
  let closeCancelUi: ((result: CommitCancelResult) => void) | undefined;
  let progressComponent: CommitProgressComponent | undefined;
  let latestProgress: CommitProgressUpdate = { message: "Preparing git snapshot…" };
  let progressClosed = false;

  const setProgress = (update: CommitProgressUpdate) => {
    latestProgress = update;
    if (!progressClosed) progressComponent?.setStatus(update);
  };

  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
    closeCancelUi?.("cancelled");
  };

  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });

  if (!ctx.hasUI) {
    try {
      return await run(controller.signal, setProgress);
    } finally {
      parentSignal?.removeEventListener("abort", abort);
    }
  }

  const cancelUi = ctx.ui.custom<CommitCancelResult>((tui, theme, keybindings, done) => {
    closeCancelUi = done;
    progressComponent = new CommitProgressComponent(
      tui,
      theme,
      keybindings,
      latestProgress.message,
      abort,
    );
    progressComponent.setStatus(latestProgress);
    return progressComponent;
  });

  const work = run(controller.signal, setProgress);
  try {
    const first = await Promise.race([cancelUi, work.then((): CommitCancelResult => "done")]);
    if (first === "cancelled") abort();
    return await work;
  } finally {
    progressClosed = true;
    parentSignal?.removeEventListener("abort", abort);
    closeCancelUi?.("done");
    progressComponent = undefined;
  }
}

async function handleCommit(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  signal: AbortSignal,
  setProgress: (update: CommitProgressUpdate) => void,
): Promise<CommitNotification | undefined> {
  let evidence;
  try {
    setProgress({ message: "Preparing git snapshot…" });
    evidence = await collectCommitEvidence(pi, ctx.cwd, { signal });
  } catch (error) {
    if (wasCancelled(signal)) {
      return { message: "Commit cancelled.", level: "info" };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { message: `Unable to prepare commit snapshot: ${message}`, level: "error" };
  }

  if (wasCancelled(signal)) {
    return { message: "Commit cancelled.", level: "info" };
  }

  if (!evidence) {
    return {
      message: "No git repository found or no uncommitted changes detected.",
      level: "info",
    };
  }

  setProgress({ message: "Loading commit config…" });
  const config = await loadCommitConfig(evidence.repoRoot);
  if (wasCancelled(signal)) {
    return { message: "Commit cancelled.", level: "info" };
  }

  const prompt = renderCommitPrompt(evidence, config);

  try {
    setProgress({ message: "Starting commit agent…" });
    const result = await runCommitAgent(evidence.repoRoot, prompt, setProgress, { signal });

    if (wasCancelled(signal)) {
      return { message: "Commit cancelled.", level: "info" };
    }

    pi.events.emit(CRUMBS_EVENT_GIT_STATUS_REFRESH_REQUESTED, { cwd: evidence.repoRoot });

    return {
      message: formatResult(
        `Commit finished in ${formatDuration(result.durationMs)} (${result.model}, ${result.thinkingLevel})\n\n${result.output}`,
      ),
      level: "info",
    };
  } catch (error) {
    if (wasCancelled(signal)) {
      return { message: "Commit cancelled.", level: "info" };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { message: `Unable to run commit: ${message}`, level: "error" };
  }
}

export default function commitExtension(pi: ExtensionAPI): void {
  pi.registerCommand("commit", {
    description: COMMAND_DESCRIPTION,
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const notification = await runWithCommitCancelUI(ctx, (signal, setProgress) =>
        handleCommit(pi, ctx, signal, setProgress),
      );
      if (notification) ctx.ui.notify(notification.message, notification.level);
    },
  });
}
