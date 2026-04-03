/**
 * QnA Form Extension
 *
 * What it does: adds a `/qna` command that extracts questions from the last
 * assistant message, asks the model for a short opinion per question, and opens
 * a paged input UI so you can answer each question manually.
 *
 * How to use it: run `/qna` in an interactive session, fill answers per page,
 * then press Enter on the Submit page. Blank answers are recorded as
 * "(no response)".
 *
 * Example:
 * 1) Let the agent produce a long response with open questions.
 * 2) Run `/qna`.
 * 3) Use Tab / Shift+Tab to move between questions, type answers, submit.
 */

import { complete, type UserMessage } from "@mariozechner/pi-ai";
import {
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { Input, Key, type Keybinding, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

interface ExtractedQnaItem {
  question: string;
  opinion: string;
}

interface ExtractedQnaPayload {
  items: ExtractedQnaItem[];
}

interface AnsweredQnaItem extends ExtractedQnaItem {
  answer: string;
}

const NO_RESPONSE = "(no response)";

const EXTRACTION_SYSTEM_PROMPT = `You extract actionable questions from assistant output.

Return JSON only. No markdown, no code fences, no extra prose.

Schema:
{
  "items": [
    {
      "question": "string",
      "opinion": "string"
    }
  ]
}

Rules:
- Keep question order from the source text.
- Include only questions that are asking the user for a decision, confirmation, missing info, or preference.
- opinion must be concise (1-2 sentences) and useful.
- If there are no user-facing questions, return: {"items": []}
- Ensure question is non-empty.`;

function getLastAssistantMessageText(branch: SessionEntry[]): string | null {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (!("role" in message) || message.role !== "assistant") continue;
    if (message.stopReason !== "stop") return null;
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text.length > 0) return text;
  }
  return null;
}

function normalizePayload(parsed: unknown): ExtractedQnaPayload | null {
  if (!parsed || typeof parsed !== "object") return null;
  const rawItems = (parsed as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return null;

  const items: ExtractedQnaItem[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const questionRaw = (item as { question?: unknown }).question;
    const opinionRaw = (item as { opinion?: unknown }).opinion;
    if (typeof questionRaw !== "string") continue;
    const question = questionRaw.trim();
    if (!question) continue;
    const opinion =
      typeof opinionRaw === "string" && opinionRaw.trim().length > 0
        ? opinionRaw.trim()
        : "No opinion provided.";
    items.push({ question, opinion });
  }

  return { items };
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty model response");

  // Direct JSON first.
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try extracting from fenced or mixed output.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }

  throw new Error("No JSON object found in model response");
}

async function extractQnaItems(
  lastAssistantText: string,
  ctx: ExtensionCommandContext,
  signal?: AbortSignal,
): Promise<ExtractedQnaItem[] | null> {
  if (!ctx.model) return null;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) return null;

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: lastAssistantText }],
    timestamp: Date.now(),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await complete(
      ctx.model,
      {
        systemPrompt:
          attempt === 0
            ? EXTRACTION_SYSTEM_PROMPT
            : `${EXTRACTION_SYSTEM_PROMPT}\n\nPrevious output was invalid. Return valid JSON only, exactly matching schema.`,
        messages: [userMessage],
      },
      { apiKey: auth.apiKey, headers: auth.headers, signal },
    );

    if (response.stopReason === "aborted") {
      return null;
    }

    const text = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    try {
      const parsed = parseJsonObject(text);
      const normalized = normalizePayload(parsed);
      if (normalized) return normalized.items;
    } catch {
      // retry once
    }
  }

  return null;
}

function formatFinalOutput(items: AnsweredQnaItem[]): string {
  return items.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n");
}

export default function qnaExtension(pi: ExtensionAPI) {
  pi.registerCommand("qna", {
    description:
      "Extract questions + model opinions from last assistant message into a paged answer form",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/qna requires interactive UI mode", "error");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      const lastAssistantText = getLastAssistantMessageText(ctx.sessionManager.getBranch());
      if (!lastAssistantText) {
        ctx.ui.notify("No completed assistant message found", "error");
        return;
      }

      const extracted = await ctx.ui.custom<ExtractedQnaItem[] | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `Extracting Q&A prompts with ${ctx.model!.id}...`,
        );
        let finished = false;

        function finish(value: ExtractedQnaItem[] | null) {
          if (finished) return;
          finished = true;
          done(value);
        }

        loader.onAbort = () => finish(null);

        extractQnaItems(lastAssistantText, ctx, loader.signal)
          .then(finish)
          .catch(() => finish(null));

        return loader;
      });

      if (extracted === null) {
        ctx.ui.notify("Q&A extraction cancelled or failed", "warning");
        return;
      }

      if (extracted.length === 0) {
        ctx.ui.notify("No user-facing questions found in the last assistant message", "info");
        return;
      }

      const extractedItems = extracted;

      const answered = await ctx.ui.custom<AnsweredQnaItem[] | null>(
        (tui, theme, keybindings, done) => {
          const totalTabs = extractedItems.length + 1;
          let currentTab = 0;
          const draftAnswers = extractedItems.map(() => "");
          const input = new Input();
          let finished = false;

          function finish(value: AnsweredQnaItem[] | null) {
            if (finished) return;
            finished = true;
            done(value);
          }

          function refresh() {
            tui.requestRender();
          }

          function formatBindingHint(binding: Keybinding, description: string): string {
            const keys = keybindings.getKeys(binding).join("/");
            if (!keys) return theme.fg("muted", description);
            return `${theme.fg("dim", keys)}${theme.fg("muted", ` ${description}`)}`;
          }

          function formatRawHint(key: string, description: string): string {
            return `${theme.fg("dim", key)}${theme.fg("muted", ` ${description}`)}`;
          }

          function onQuestionTab(): boolean {
            return currentTab < extractedItems.length;
          }

          function answeredCount(): number {
            return draftAnswers.filter((a) => a.trim().length > 0).length;
          }

          function saveCurrentAnswer() {
            if (!onQuestionTab()) return;
            draftAnswers[currentTab] = input.getValue().trim();
          }

          function loadCurrentAnswer() {
            if (!onQuestionTab()) {
              input.setValue("");
              return;
            }
            input.setValue(draftAnswers[currentTab] ?? "");
          }

          function moveTab(delta: number) {
            saveCurrentAnswer();
            currentTab = (currentTab + delta + totalTabs) % totalTabs;
            loadCurrentAnswer();
            refresh();
          }

          function submitResult() {
            saveCurrentAnswer();
            finish(
              extractedItems.map((item, i) => ({
                ...item,
                answer: draftAnswers[i].trim().length > 0 ? draftAnswers[i].trim() : NO_RESPONSE,
              })),
            );
          }

          input.onSubmit = () => {
            saveCurrentAnswer();
            if (currentTab < extractedItems.length - 1) {
              currentTab++;
              loadCurrentAnswer();
              refresh();
              return;
            }
            currentTab = extractedItems.length;
            loadCurrentAnswer();
            refresh();
          };

          loadCurrentAnswer();

          return {
            handleInput(data: string) {
              if (keybindings.matches(data, "tui.select.cancel")) {
                finish(null);
                return;
              }

              if (keybindings.matches(data, "tui.input.tab")) {
                moveTab(1);
                return;
              }

              if (matchesKey(data, Key.shift("tab"))) {
                moveTab(-1);
                return;
              }

              if (!onQuestionTab()) {
                if (keybindings.matches(data, "tui.input.submit")) {
                  submitResult();
                }
                return;
              }

              input.handleInput(data);
              refresh();
            },
            render(width: number): string[] {
              const lines: string[] = [];
              const add = (text: string) => lines.push(truncateToWidth(text, width));
              const separator = theme.fg("dim", " • ");

              add(theme.fg("accent", "─".repeat(width)));

              const tabParts: string[] = [];
              for (let i = 0; i < extractedItems.length; i++) {
                const isActive = i === currentTab;
                const hasAnswer = (draftAnswers[i] ?? "").trim().length > 0;
                const marker = hasAnswer ? "■" : "□";
                const label = ` ${marker} Q${i + 1} `;
                tabParts.push(
                  isActive
                    ? theme.bg("selectedBg", theme.fg("text", label))
                    : theme.fg(hasAnswer ? "success" : "muted", label),
                );
              }
              const submitActive = currentTab === extractedItems.length;
              tabParts.push(
                submitActive
                  ? theme.bg("selectedBg", theme.fg("text", " ✓ Submit "))
                  : theme.fg("dim", " ✓ Submit "),
              );
              add(` ${tabParts.join(" ")}`);
              lines.push("");

              if (onQuestionTab()) {
                const item = extractedItems[currentTab];
                add(theme.fg("text", ` Q: ${item.question}`));
                lines.push("");
                add(theme.fg("muted", ` 🤖: ${item.opinion}`));
                lines.push("");

                const renderedInput = input.render(Math.max(1, width - 4))[0] ?? "> ";
                const answerLine = renderedInput.startsWith("> ")
                  ? renderedInput.slice(2)
                  : renderedInput;
                add(theme.fg("text", " A: ") + answerLine);

                lines.push("");
                add(
                  [
                    formatBindingHint("tui.input.submit", "next"),
                    formatBindingHint("tui.input.tab", "next"),
                    formatRawHint("shift+tab", "prev"),
                    formatBindingHint("tui.editor.deleteWordBackward", "delete word"),
                    formatBindingHint("tui.select.cancel", "cancel"),
                  ].join(separator),
                );
              } else {
                const answeredNow = answeredCount();
                add(theme.fg("accent", " Ready to send"));
                lines.push("");
                add(theme.fg("text", ` Answered: ${answeredNow}/${extractedItems.length}`));

                const unanswered = extractedItems
                  .map((item, i) => ({ item, i }))
                  .filter(({ i }) => (draftAnswers[i] ?? "").trim().length === 0);

                if (unanswered.length > 0) {
                  lines.push("");
                  add(theme.fg("warning", " Unanswered questions:"));
                  for (const { item, i } of unanswered) {
                    add(theme.fg("muted", `  Q${i + 1}: ${item.question}`));
                  }
                }

                lines.push("");
                add(
                  [
                    formatBindingHint("tui.input.submit", "send Q/A to agent"),
                    formatBindingHint("tui.input.tab", "review next"),
                    formatRawHint("shift+tab", "review prev"),
                    formatBindingHint("tui.select.cancel", "cancel"),
                  ].join(separator),
                );
              }

              add(theme.fg("accent", "─".repeat(width)));
              return lines;
            },
            invalidate() {},
          };
        },
      );

      if (answered === null) {
        ctx.ui.notify("Q&A form cancelled", "info");
        return;
      }

      const finalText = formatFinalOutput(answered);
      pi.sendUserMessage(finalText);
      ctx.ui.notify("Sent Q/A responses to agent.", "info");
    },
  });
}
