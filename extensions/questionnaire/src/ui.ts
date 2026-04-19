import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import type { Answer, Question, QuestionnaireResult } from "./types.js";

type RenderOption = Question["options"][number] & { isOther?: boolean };

function toResult(
  questions: Question[],
  answers: Answer[],
  cancelled: boolean,
): QuestionnaireResult {
  return {
    questions,
    answers,
    answersById: Object.fromEntries(answers.map((answer) => [answer.id, answer])),
    cancelled,
  };
}

export async function openQuestionnaire(
  ctx: ExtensionContext,
  questions: Question[],
): Promise<QuestionnaireResult> {
  return ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
    const isMulti = questions.length > 1;
    const totalTabs = questions.length + 1;
    let currentTab = 0;
    let optionIndex = 0;
    let inputMode = false;
    let inputQuestionId: string | null = null;
    let cachedLines: string[] | undefined;
    const answers = new Map<string, Answer>();

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      },
    };
    const editor = new Editor(tui, editorTheme);

    function refresh() {
      cachedLines = undefined;
      tui.requestRender();
    }

    function submit(cancelled: boolean) {
      done(toResult(questions, Array.from(answers.values()), cancelled));
    }

    function currentQuestion(): Question | undefined {
      return questions[currentTab];
    }

    function currentOptions(): RenderOption[] {
      const question = currentQuestion();
      if (!question) return [];
      const options: RenderOption[] = [...question.options];
      if (question.allowOther) {
        options.push({ value: "__other__", label: "Type something.", isOther: true });
      }
      return options;
    }

    function allAnswered(): boolean {
      return questions.every((question) => answers.has(question.id));
    }

    function advanceAfterAnswer() {
      if (!isMulti) {
        submit(false);
        return;
      }
      if (currentTab < questions.length - 1) {
        currentTab += 1;
      } else {
        currentTab = questions.length;
      }
      optionIndex = 0;
      refresh();
    }

    function saveAnswer(
      questionId: string,
      value: string,
      label: string,
      wasCustom: boolean,
      index?: number,
    ) {
      answers.set(questionId, { id: questionId, value, label, wasCustom, index });
    }

    editor.onSubmit = (value) => {
      if (!inputQuestionId) return;
      const trimmed = value.trim() || "(no response)";
      saveAnswer(inputQuestionId, trimmed, trimmed, true);
      inputMode = false;
      inputQuestionId = null;
      editor.setText("");
      advanceAfterAnswer();
    };

    function handleInput(data: string) {
      if (inputMode) {
        if (matchesKey(data, Key.escape)) {
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      const question = currentQuestion();
      const options = currentOptions();

      if (isMulti) {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          currentTab = (currentTab + 1) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          currentTab = (currentTab - 1 + totalTabs) % totalTabs;
          optionIndex = 0;
          refresh();
          return;
        }
      }

      if (currentTab === questions.length) {
        if (matchesKey(data, Key.enter) && allAnswered()) {
          submit(false);
          return;
        }
        if (matchesKey(data, Key.escape)) submit(true);
        return;
      }

      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(Math.max(0, options.length - 1), optionIndex + 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.enter) && question) {
        const option = options[optionIndex];
        if (!option) return;
        if (option.isOther) {
          inputMode = true;
          inputQuestionId = question.id;
          editor.setText("");
          refresh();
          return;
        }
        saveAnswer(question.id, option.value, option.label, false, optionIndex + 1);
        advanceAfterAnswer();
        return;
      }

      if (matchesKey(data, Key.escape)) submit(true);
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;

      const safeWidth = Math.max(20, width);
      const lines: string[] = [];
      const question = currentQuestion();
      const options = currentOptions();

      const add = (text: string) => lines.push(truncateToWidth(text, safeWidth));

      add(theme.fg("accent", "─".repeat(safeWidth)));

      if (isMulti) {
        const tabs: string[] = ["← "];
        for (let index = 0; index < questions.length; index += 1) {
          const isActive = index === currentTab;
          const isAnswered = answers.has(questions[index].id);
          const box = isAnswered ? "■" : "□";
          const text = ` ${box} ${questions[index].label} `;
          const styled = isActive
            ? theme.bg("selectedBg", theme.fg("text", text))
            : theme.fg(isAnswered ? "success" : "muted", text);
          tabs.push(`${styled} `);
        }
        const canSubmit = allAnswered();
        const isSubmitTab = currentTab === questions.length;
        const submitText = " ✓ Submit ";
        const submitStyled = isSubmitTab
          ? theme.bg("selectedBg", theme.fg("text", submitText))
          : theme.fg(canSubmit ? "success" : "dim", submitText);
        tabs.push(`${submitStyled} →`);
        add(` ${tabs.join("")}`);
        lines.push("");
      }

      function renderOptions() {
        for (let index = 0; index < options.length; index += 1) {
          const option = options[index];
          const selected = index === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          const color = selected ? "accent" : "text";
          if (option.isOther && inputMode) {
            add(prefix + theme.fg("accent", `${index + 1}. ${option.label} ✎`));
          } else {
            add(prefix + theme.fg(color, `${index + 1}. ${option.label}`));
          }
          if (option.description) add(`     ${theme.fg("muted", option.description)}`);
        }
      }

      if (inputMode && question) {
        add(theme.fg("text", ` ${question.prompt}`));
        lines.push("");
        if (question.recommendation) {
          const recommendation =
            question.recommendation.label || question.recommendation.value || "recommended option";
          add(theme.fg("accent", ` Recommended: ${recommendation}`));
          add(theme.fg("muted", ` Why: ${question.recommendation.reason}`));
          lines.push("");
        }
        renderOptions();
        lines.push("");
        add(theme.fg("muted", " Your answer:"));
        for (const line of editor.render(Math.max(1, safeWidth - 2))) add(` ${line}`);
        lines.push("");
        add(theme.fg("dim", " Enter to submit • Esc to cancel"));
      } else if (currentTab === questions.length) {
        add(theme.fg("accent", theme.bold(" Ready to submit")));
        lines.push("");
        for (const item of questions) {
          const answer = answers.get(item.id);
          if (!answer) continue;
          const prefix = answer.wasCustom ? "(wrote) " : "";
          add(`${theme.fg("muted", ` ${item.label}: `)}${theme.fg("text", prefix + answer.label)}`);
        }
        lines.push("");
        if (allAnswered()) {
          add(theme.fg("success", " Press Enter to continue"));
        } else {
          const missing = questions
            .filter((item) => !answers.has(item.id))
            .map((item) => item.label)
            .join(", ");
          add(theme.fg("warning", ` Unanswered: ${missing}`));
        }
      } else if (question) {
        add(theme.fg("text", ` ${question.prompt}`));
        lines.push("");
        if (question.recommendation) {
          const recommendation =
            question.recommendation.label || question.recommendation.value || "recommended option";
          add(theme.fg("accent", ` Recommended: ${recommendation}`));
          add(theme.fg("muted", ` Why: ${question.recommendation.reason}`));
          lines.push("");
        }
        renderOptions();
      }

      lines.push("");
      if (!inputMode) {
        add(
          theme.fg(
            "dim",
            isMulti
              ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
              : " ↑↓ navigate • Enter select • Esc cancel",
          ),
        );
      }
      add(theme.fg("accent", "─".repeat(safeWidth)));

      cachedLines = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cachedLines = undefined;
      },
      handleInput,
    };
  });
}

export function formatAnswersMessage(result: QuestionnaireResult): string {
  const body = result.answers
    .map((answer) => {
      const question = result.questions.find((item) => item.id === answer.id);
      const prompt = question?.prompt || answer.id;
      return `Q: ${prompt}\nA: ${answer.label}`;
    })
    .join("\n\n");
  return `User completed /qna questionnaire. Treat these as authoritative user answers.\n\n${body}`;
}

export function renderAnswersMessage(
  answers: Array<{ id: string; label: string; wasCustom: boolean; index?: number }>,
  theme: { fg(color: string, text: string): string; bold(text: string): string },
): Text {
  const lines = [theme.fg("toolTitle", theme.bold("qna answers"))];
  for (const answer of answers) {
    const display = answer.wasCustom
      ? `${theme.fg("muted", "(wrote) ")}${answer.label}`
      : `${answer.index ? `${answer.index}. ` : ""}${answer.label}`;
    lines.push(`${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`);
  }
  return new Text(lines.join("\n"), 0, 0);
}
