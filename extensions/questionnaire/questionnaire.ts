import { complete, type UserMessage } from "@mariozechner/pi-ai";
import { BorderedLoader, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { extractQuestionnaire } from "./src/extract.js";
import { formatAnswersMessage, openQuestionnaire, renderAnswersMessage } from "./src/ui.js";

const QNA_ANSWERS_MESSAGE_TYPE = "qna-answers";

function getTextContent(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildBranchTranscript(branch: any[]): string {
  const lines: string[] = [];

  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!("role" in message)) continue;

    const text = getTextContent(message.content as Array<{ type: string; text?: string }>);
    if (!text) continue;

    if (message.role === "toolResult") {
      lines.push(`[tool:${message.toolName}]\n${text}`);
      continue;
    }

    lines.push(`[${message.role}]\n${text}`);
  }

  return lines.join("\n\n");
}

function getLastAssistantMessage(branch: any[]): { text?: string; error?: string } {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!("role" in message) || message.role !== "assistant") continue;
    if (message.stopReason !== "stop") {
      return { error: `Last assistant message incomplete (${message.stopReason})` };
    }

    const text = getTextContent(message.content as Array<{ type: string; text?: string }>);
    if (text) return { text };
  }

  return { error: "No assistant messages found" };
}

export default function questionnaire(pi: ExtensionAPI) {
  pi.registerCommand("qna", {
    description: "Ask questions from last assistant message with multiple-choice UI",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("qna requires interactive mode", "error");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const branch = ctx.sessionManager.getBranch();
      const lastAssistant = getLastAssistantMessage(branch);
      if (!lastAssistant.text) {
        ctx.ui.notify(lastAssistant.error || "No assistant messages found", "error");
        return;
      }

      const transcript = buildBranchTranscript(branch);
      const extraction = await ctx.ui.custom<
        | { questions: Awaited<ReturnType<typeof openQuestionnaire>>["questions"] }
        | { error: string }
        | null
      >((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, `Preparing /qna using ${ctx.model!.id}...`);
        loader.onAbort = () => done(null);

        const run = async () => {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
          if (!auth.ok || !auth.apiKey) {
            throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error);
          }

          const prompt = [
            "FULL_CHAT_CONTEXT:",
            transcript,
            "",
            "LAST_ASSISTANT_MESSAGE:",
            lastAssistant.text,
          ].join("\n");

          const userMessage: UserMessage = {
            role: "user",
            content: [{ type: "text", text: prompt }],
            timestamp: Date.now(),
          };

          const response = await complete(
            ctx.model!,
            {
              systemPrompt: extractQuestionnaire.systemPrompt,
              messages: [userMessage],
            },
            { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
          );

          if (response.stopReason === "aborted") return null;

          const text = response.content
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim();

          return extractQuestionnaire.parse(text);
        };

        run()
          .then(done)
          .catch((error) =>
            done({
              error: error instanceof Error ? error.message : "Failed to prepare questionnaire",
            }),
          );

        return loader;
      });

      if (extraction === null) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      if ("error" in extraction) {
        ctx.ui.notify(extraction.error, "error");
        return;
      }

      if (extraction.questions.length === 0) {
        ctx.ui.notify("No questions found in last assistant message", "info");
        return;
      }

      const result = await openQuestionnaire(ctx, extraction.questions);
      if (result.cancelled) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      pi.sendMessage(
        {
          customType: QNA_ANSWERS_MESSAGE_TYPE,
          content: formatAnswersMessage(result),
          display: true,
          details: result,
        },
        { triggerTurn: true },
      );
    },
  });

  pi.registerMessageRenderer(QNA_ANSWERS_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details as
      | { answers?: Array<{ id: string; label: string; wasCustom: boolean; index?: number }> }
      | undefined;
    const answers = Array.isArray(details?.answers) ? details.answers : [];
    return renderAnswersMessage(answers, theme);
  });
}
