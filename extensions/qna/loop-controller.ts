import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  buildQnaLoopKickoffMessage,
  isQnaLoopKickoffMessage,
  parseQnaLoopKickoffDetails,
} from "./loop-control-message.js";
import type { QnaLoopFinishReason, QnaOpenQuestionReference } from "./types.js";

interface ActiveLoopState {
  loopId: string;
  openQuestions: QnaOpenQuestionReference[];
  discoverySummary?: string;
  restoreQuestionRuntimeRequest: boolean;
}

function sameToolSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((name, index) => name === rightSorted[index]);
}

function nextLoopId(): string {
  return `qna_loop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatOpenQuestions(openQuestions: QnaOpenQuestionReference[]): string {
  if (openQuestions.length === 0) return "No open questions remain.";
  return openQuestions
    .map((question) => `- ${question.questionId}: ${question.questionText}`)
    .join("\n");
}

export class QnaLoopController {
  private activeLoop: ActiveLoopState | null = null;
  private pendingRestore: { restoreQuestionRuntimeRequest: boolean } | null = null;
  private lastFinishReason: QnaLoopFinishReason | null = null;

  constructor(private readonly pi: ExtensionAPI) {}

  isActive(): boolean {
    return this.activeLoop !== null;
  }

  startLoop(input: { openQuestions: QnaOpenQuestionReference[]; discoverySummary?: string }): {
    startedNewLoop: boolean;
    loopId: string;
  } {
    if (this.activeLoop) {
      this.activeLoop.openQuestions = [...input.openQuestions];
      this.activeLoop.discoverySummary = input.discoverySummary;
      return { startedNewLoop: false, loopId: this.activeLoop.loopId };
    }

    const currentActiveTools = this.pi.getActiveTools();
    const restoreQuestionRuntimeRequest = currentActiveTools.includes("question_runtime_request");
    const nextActiveTools = currentActiveTools.filter(
      (name) => name !== "question_runtime_request",
    );
    if (!nextActiveTools.includes("qna")) nextActiveTools.push("qna");
    if (!sameToolSet(currentActiveTools, nextActiveTools)) {
      this.pi.setActiveTools(nextActiveTools);
    }

    const loopId = nextLoopId();
    this.activeLoop = {
      loopId,
      openQuestions: [...input.openQuestions],
      discoverySummary: input.discoverySummary,
      restoreQuestionRuntimeRequest,
    };
    this.pendingRestore = null;
    this.lastFinishReason = null;

    this.pi.sendMessage(
      buildQnaLoopKickoffMessage({
        type: "kickoff",
        loopId,
        openQuestionIds: input.openQuestions.map((question) => question.questionId),
        discoverySummary: input.discoverySummary,
      }),
      { deliverAs: "steer", triggerTurn: true },
    );

    return { startedNewLoop: true, loopId };
  }

  markSettled(reason: QnaLoopFinishReason): void {
    if (!this.activeLoop) return;
    this.pendingRestore = {
      restoreQuestionRuntimeRequest: this.activeLoop.restoreQuestionRuntimeRequest,
    };
    this.activeLoop = null;
    this.lastFinishReason = reason;
    this.enforceInactiveToolBaseline();
  }

  handleBeforeAgentStart(
    event: { systemPrompt: string },
    _ctx: ExtensionContext,
  ): { systemPrompt: string } | undefined {
    if (!this.activeLoop) return undefined;

    const prompt = [
      "Manual /qna loop is active.",
      "You may ask ordinary clarifying questions in chat when structured capture is unnecessary.",
      "Use the qna tool only for structured review of open questions or to explicitly complete this loop.",
      'Calling qna with action: "complete" ends only the current loop and leaves any remaining open backlog for later.',
      this.activeLoop.discoverySummary
        ? `Discovery summary: ${this.activeLoop.discoverySummary}`
        : undefined,
      "Current open ordinary QnA questions:",
      formatOpenQuestions(this.activeLoop.openQuestions),
    ]
      .filter((line): line is string => !!line)
      .join("\n");

    return {
      systemPrompt: `${event.systemPrompt}\n\n${prompt}`,
    };
  }

  handleContext<
    TMessage extends { role?: unknown; customType?: unknown; details?: unknown },
  >(event: { messages: TMessage[] }): { messages: TMessage[] } | undefined {
    const filtered = event.messages.filter((message) => {
      if (!isQnaLoopKickoffMessage(message)) return true;
      const details = parseQnaLoopKickoffDetails(message.details);
      if (!details) return false;
      return !!this.activeLoop && details.loopId === this.activeLoop.loopId;
    });

    if (filtered.length === event.messages.length) return undefined;
    return { messages: filtered };
  }

  handleAgentEnd(_ctx: ExtensionContext): void {
    if (!this.pendingRestore) return;
    this.restoreTools(this.pendingRestore.restoreQuestionRuntimeRequest);
    this.pendingRestore = null;
  }

  handleSessionReset(): void {
    const restoreQuestionRuntimeRequest =
      this.activeLoop?.restoreQuestionRuntimeRequest ??
      this.pendingRestore?.restoreQuestionRuntimeRequest ??
      false;

    this.activeLoop = null;
    this.pendingRestore = null;
    this.lastFinishReason = "session_reset";
    this.restoreTools(restoreQuestionRuntimeRequest);
    this.enforceInactiveToolBaseline();
  }

  private enforceInactiveToolBaseline(): void {
    const currentActiveTools = this.pi.getActiveTools();
    const nextActiveTools = currentActiveTools.filter((name) => name !== "qna");
    if (!sameToolSet(currentActiveTools, nextActiveTools)) {
      this.pi.setActiveTools(nextActiveTools);
    }
  }

  private restoreTools(restoreQuestionRuntimeRequest: boolean): void {
    const currentActiveTools = this.pi.getActiveTools().filter((name) => name !== "qna");
    const runtimeToolExists = this.pi
      .getAllTools()
      .some((tool) => tool.name === "question_runtime_request");

    const nextActiveTools = [...currentActiveTools];
    if (
      restoreQuestionRuntimeRequest &&
      runtimeToolExists &&
      !nextActiveTools.includes("question_runtime_request")
    ) {
      nextActiveTools.push("question_runtime_request");
    }

    if (!sameToolSet(this.pi.getActiveTools(), nextActiveTools)) {
      this.pi.setActiveTools(nextActiveTools);
    }
  }
}

export function registerQnaLoopLifecycle(
  pi: ExtensionAPI,
  loopController: QnaLoopController,
): void {
  pi.on("before_agent_start", async (event, ctx) =>
    loopController.handleBeforeAgentStart(event, ctx),
  );
  pi.on("context", async (event) => loopController.handleContext(event));
  pi.on("agent_end", async (_event, ctx) => {
    loopController.handleAgentEnd(ctx);
  });
  pi.on("session_start", async () => {
    loopController.handleSessionReset();
  });
  pi.on("session_before_switch", async () => {
    loopController.handleSessionReset();
  });
  pi.on("session_before_tree", async () => {
    loopController.handleSessionReset();
  });
  pi.on("session_before_fork", async () => {
    loopController.handleSessionReset();
  });
  (pi as any).on("session_tree", async () => {
    loopController.handleSessionReset();
  });
  pi.on("session_shutdown", async () => {
    loopController.handleSessionReset();
  });
}
