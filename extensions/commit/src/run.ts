import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

const MODEL_PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.5";
const THINKING_LEVEL = "high";
const ACTIVE_TOOLS = ["bash"];

type AssistantMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  errorMessage?: string;
};

export interface CommitAgentResult {
  output: string;
  model: string;
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

export async function runCommitAgent(
  cwd: string,
  systemPrompt: string,
): Promise<CommitAgentResult> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    appendSystemPromptOverride: (base) => [...base, systemPrompt],
    extensionsOverride: (base) => ({
      ...base,
      extensions: base.extensions.filter(
        (extension) => !extension.resolvedPath.includes("/extensions/notify/"),
      ),
    }),
  });

  let session: AgentSession | undefined;
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

    await session.prompt(
      "Create git commit(s) from injected /commit context only. First state intended commit groups, then execute those groups.",
    );

    const final = getFinalAssistant(session);
    const output =
      getAssistantText(final) || final?.errorMessage || "Commit agent finished without output.";

    return {
      output,
      model: `${MODEL_PROVIDER}/${MODEL_ID}`,
    };
  } finally {
    try {
      session?.dispose();
    } catch {}
  }
}
