import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.5";
const THINKING_LEVEL = "medium";
const ACTIVE_TOOLS = ["bash"];

type AssistantMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  errorMessage?: string;
};

export interface CommitAgentResult {
  output: string;
  model: string;
  thinkingLevel: typeof THINKING_LEVEL;
  durationMs: number;
}

export interface CommitAgentUpdate {
  message: string;
  level?: "info" | "warning" | "error";
}

function getAssistantText(message: AssistantMessage | undefined): string {
  if (message?.role !== "assistant") return "";
  for (const part of message.content ?? []) {
    if (part.type === "text" && typeof part.text === "string") return part.text;
  }
  return "";
}

function getFinalAssistant(session: AgentSession): AssistantMessage | undefined {
  let latest: AssistantMessage | undefined;
  for (const message of session.messages as AssistantMessage[]) {
    if (message.role === "assistant") latest = message;
  }
  return latest;
}

function requireCommitModel(session: AgentSession) {
  const model = session.modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
  if (!model) throw new Error(`Unable to find /commit model ${MODEL_PROVIDER}/${MODEL_ID}.`);
  return model;
}

function requireActiveTools(session: AgentSession): void {
  const available = new Set(session.getAllTools().map((tool) => tool.name));
  const missing = ACTIVE_TOOLS.filter((tool) => !available.has(tool));
  if (missing.length > 0) {
    throw new Error(
      `Unable to run /commit because required tool(s) are unavailable: ${missing.join(", ")}.`,
    );
  }
  session.setActiveToolsByName(ACTIVE_TOOLS);
}

function truncateInline(text: string, maxLength = 120): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function extractBashCommand(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" && command.trim() ? command.trim() : undefined;
}

function formatToolDescription(toolName: string, args: unknown): string {
  const command = toolName === "bash" ? extractBashCommand(args) : undefined;
  if (command) return `$ ${truncateInline(command)}`;
  return toolName;
}

export async function runCommitAgent(
  cwd: string,
  commitPrompt: string,
  onUpdate?: (update: CommitAgentUpdate) => void,
): Promise<CommitAgentResult> {
  const startedAt = Date.now();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionsOverride: (base) => ({
      ...base,
      extensions: base.extensions.filter(
        (extension) => !extension.resolvedPath.includes("/extensions/notify/"),
      ),
    }),
  });

  let session: AgentSession | undefined;
  let unsubscribe = () => {};
  let planned = false;
  let activeToolDescription: string | undefined;

  try {
    await loader.reload();
    const created = await createAgentSession({
      cwd,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
    });
    session = created.session;

    const model = requireCommitModel(session);
    await session.setModel(model);
    session.setThinkingLevel(THINKING_LEVEL);
    requireActiveTools(session);

    onUpdate?.({ message: "/commit planning commits…" });

    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        if (!planned) {
          planned = true;
          onUpdate?.({ message: "/commit planning commits…" });
        }
        return;
      }

      if (event.type === "tool_execution_start") {
        activeToolDescription = formatToolDescription(event.toolName, event.args);
        onUpdate?.({ message: `/commit ${activeToolDescription}` });
        return;
      }

      if (event.type === "tool_execution_end") {
        if (!event.isError) return;

        const failedTool = activeToolDescription ?? event.toolName;
        onUpdate?.({ message: `/commit failed ${failedTool}`, level: "error" });
      }
    });

    await session.prompt(commitPrompt);

    const final = getFinalAssistant(session);
    const output =
      getAssistantText(final) || final?.errorMessage || "Commit agent finished without output.";

    return {
      output,
      model: `${MODEL_PROVIDER}/${MODEL_ID}`,
      thinkingLevel: THINKING_LEVEL,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    unsubscribe();
    try {
      session?.dispose();
    } catch {}
  }
}
