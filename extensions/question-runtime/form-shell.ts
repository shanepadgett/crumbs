import { rawKeyHint, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import {
  buildQuestionRuntimeFormResult,
  createQuestionRuntimeFormState,
  getQuestionDraft,
  getQuestionResponseState,
  setAnswerNote,
  setClosureState,
  setFreeformText,
  setMultipleChoiceOptionNote,
  setMultipleChoiceOtherText,
  setQuestionNote,
  setYesNoSelection,
  toggleMultipleChoiceOption,
  validateFormForSubmit,
} from "./form-state.js";
import {
  buildChoiceQuestionModel,
  flattenQuestionsPreOrder,
  type FlattenedQuestion,
} from "./question-model.js";
import type {
  AuthorizedQuestionNode,
  AuthorizedQuestionRequest,
  QuestionRuntimeFormResult,
  QuestionRuntimeQuestionDraft,
} from "./types.js";

interface FocusableRow {
  id: string;
  lines: string[];
  tone?: "accent" | "text" | "muted" | "dim" | "warning" | "success";
  disabled?: boolean;
  action:
    | { kind: "toggle-context" }
    | { kind: "toggle-choice"; optionId: string }
    | { kind: "edit-answer" }
    | { kind: "edit-answer-note" }
    | { kind: "edit-other-text" }
    | { kind: "edit-option-note"; optionId: string; label: string }
    | { kind: "edit-question-note" }
    | { kind: "set-closure"; closureState: "open" | "skipped" | "needs_clarification" }
    | { kind: "jump-question"; questionId: string }
    | { kind: "submit" };
}

type ShellStep =
  | { kind: "cancel" }
  | { kind: "edit"; title: string; value: string }
  | { kind: "mutate"; apply: () => void }
  | { kind: "submit" };

function summarizeValue(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 0 ? singleLine : "(empty)";
}

function statusBadge(state: ReturnType<typeof getQuestionResponseState>): string {
  if (state === "answered") return "✓";
  if (state === "skipped") return "↷";
  if (state === "needs_clarification") return "?";
  return "•";
}

function tabLabel(
  entry: FlattenedQuestion,
  index: number,
  draft: QuestionRuntimeQuestionDraft,
): string {
  return `${statusBadge(getQuestionResponseState(entry.question, draft))} ${index + 1}:${entry.question.questionId}`;
}

function kindLabel(question: AuthorizedQuestionNode): string {
  if (question.kind === "multiple_choice") return `multiple_choice (${question.selectionMode})`;
  return question.kind;
}

function buildQuestionRows(
  entry: FlattenedQuestion,
  draft: QuestionRuntimeQuestionDraft,
  contextExpanded: boolean,
): FocusableRow[] {
  const rows: FocusableRow[] = [];
  const closed = draft.closureState !== "open";

  if (entry.question.context) {
    rows.push({
      id: "context",
      lines: [contextExpanded ? "Hide context" : "Show context"],
      tone: "muted",
      action: { kind: "toggle-context" },
    });
  }

  if (entry.question.kind === "yes_no") {
    const model = buildChoiceQuestionModel(entry.question);
    for (const option of model.options) {
      const selected =
        draft.answerDraft.kind === "yes_no" &&
        draft.answerDraft.selectedOptionId === option.optionId;
      rows.push({
        id: `choice:${option.optionId}`,
        lines: [
          `(${selected ? "x" : " "}) ${option.label}${option.recommended ? " [recommended]" : ""}`,
        ],
        disabled: closed,
        action: { kind: "toggle-choice", optionId: option.optionId },
      });
    }

    rows.push({
      id: "answer-note",
      lines: [
        `Answer note: ${summarizeValue(draft.answerDraft.kind === "yes_no" ? draft.answerDraft.note : "")}`,
      ],
      tone: "muted",
      disabled: closed,
      action: { kind: "edit-answer-note" },
    });
  }

  if (entry.question.kind === "multiple_choice") {
    const model = buildChoiceQuestionModel(entry.question);
    const selected =
      draft.answerDraft.kind === "multiple_choice" ? draft.answerDraft.selectedOptionIds : [];
    const notes =
      draft.answerDraft.kind === "multiple_choice" ? draft.answerDraft.optionNoteDrafts : {};

    for (const option of model.options) {
      const checked = selected.includes(option.optionId);
      const prefix =
        model.selectionMode === "single" ? `(${checked ? "x" : " "})` : `[${checked ? "x" : " "}]`;
      rows.push({
        id: `choice:${option.optionId}`,
        lines: [
          `${prefix} ${option.label}${option.recommended ? " [recommended]" : ""}${option.automatic ? " [auto]" : ""}`,
          ...(option.description ? [option.description] : []),
        ],
        disabled: closed,
        action: { kind: "toggle-choice", optionId: option.optionId },
      });

      if (option.optionId === "other") {
        rows.push({
          id: "other-text",
          lines: [
            `Other text: ${summarizeValue(draft.answerDraft.kind === "multiple_choice" ? draft.answerDraft.otherText : "")}`,
          ],
          tone: "muted",
          disabled: closed,
          action: { kind: "edit-other-text" },
        });
        continue;
      }

      rows.push({
        id: `note:${option.optionId}`,
        lines: [`Note for ${option.label}: ${summarizeValue(notes[option.optionId] ?? "")}`],
        tone: "muted",
        disabled: closed,
        action: { kind: "edit-option-note", optionId: option.optionId, label: option.label },
      });
    }
  }

  if (entry.question.kind === "freeform") {
    rows.push({
      id: "answer",
      lines: [
        `Answer: ${summarizeValue(draft.answerDraft.kind === "freeform" ? draft.answerDraft.text : "")}`,
      ],
      disabled: closed,
      action: { kind: "edit-answer" },
    });
    rows.push({
      id: "answer-note",
      lines: [
        `Answer note: ${summarizeValue(draft.answerDraft.kind === "freeform" ? draft.answerDraft.note : "")}`,
      ],
      tone: "muted",
      disabled: closed,
      action: { kind: "edit-answer-note" },
    });
  }

  if (closed) {
    rows.push({
      id: "question-note",
      lines: [`Question note: ${summarizeValue(draft.questionNote)}`],
      tone: "warning",
      action: { kind: "edit-question-note" },
    });
    rows.push({
      id: "reopen",
      lines: ["Reopen question"],
      tone: "accent",
      action: { kind: "set-closure", closureState: "open" },
    });
  } else {
    rows.push({
      id: "skip",
      lines: ["Mark skipped"],
      tone: "muted",
      action: { kind: "set-closure", closureState: "skipped" },
    });
    rows.push({
      id: "needs-clarification",
      lines: ["Mark needs clarification"],
      tone: "warning",
      action: { kind: "set-closure", closureState: "needs_clarification" },
    });
  }

  return rows;
}

function buildReviewRows(
  flattened: FlattenedQuestion[],
  state: ReturnType<typeof createQuestionRuntimeFormState>,
) {
  const blockers = validateFormForSubmit(flattened, state);
  const counts = { answered: 0, skipped: 0, needs_clarification: 0, open: 0 };
  for (const entry of flattened) {
    counts[
      getQuestionResponseState(entry.question, getQuestionDraft(state, entry.question.questionId))
    ] += 1;
  }

  const rows: FocusableRow[] = blockers.map((blocker) => ({
    id: `blocker:${blocker.questionId}:${blocker.code}`,
    lines: [`Fix ${blocker.questionId}: ${blocker.message}`],
    tone: "warning",
    action: { kind: "jump-question", questionId: blocker.questionId },
  }));

  for (const entry of flattened) {
    const questionId = entry.question.questionId;
    const responseState = getQuestionResponseState(
      entry.question,
      getQuestionDraft(state, questionId),
    );
    rows.push({
      id: `summary:${questionId}`,
      lines: [`${statusBadge(responseState)} ${questionId}: ${responseState}`],
      tone:
        responseState === "answered" ? "success" : responseState === "open" ? "muted" : "warning",
      action: { kind: "jump-question", questionId },
    });
  }

  rows.push({ id: "submit", lines: ["Submit form"], tone: "accent", action: { kind: "submit" } });
  return { rows, blockers, counts };
}

function style(theme: any, tone: NonNullable<FocusableRow["tone"]>, text: string): string {
  return theme.fg(tone, text);
}

export async function showQuestionRuntimeFormShell(
  ctx: ExtensionContext,
  payload: {
    requestId: string;
    projectRelativePath: string;
    request: AuthorizedQuestionRequest;
  },
): Promise<QuestionRuntimeFormResult> {
  const flattened = flattenQuestionsPreOrder(payload.request.questions);
  const state = createQuestionRuntimeFormState(flattened);
  const reviewTabIndex = flattened.length;
  const focusByTab = new Map<string, number>();
  const expandedContext = new Set<string>();
  let tabIndex = 0;

  function focusKey(): string {
    return tabIndex === reviewTabIndex ? "__review__" : flattened[tabIndex]!.question.questionId;
  }

  function getRows(): FocusableRow[] {
    if (tabIndex === reviewTabIndex) {
      return buildReviewRows(flattened, state).rows;
    }
    const entry = flattened[tabIndex]!;
    return buildQuestionRows(
      entry,
      getQuestionDraft(state, entry.question.questionId),
      expandedContext.has(entry.question.questionId),
    );
  }

  function clampFocus(): void {
    const rows = getRows();
    const max = Math.max(0, rows.length - 1);
    const current = focusByTab.get(focusKey()) ?? 0;
    focusByTab.set(focusKey(), Math.min(current, max));
  }

  clampFocus();

  while (true) {
    const step = await ctx.ui.custom<ShellStep>((tui, theme, _kb, done) => ({
      handleInput(data: string) {
        const rows = getRows();
        const key = focusKey();
        const currentFocus = focusByTab.get(key) ?? 0;

        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done({ kind: "cancel" });
          return;
        }

        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          tabIndex = (tabIndex + 1) % (flattened.length + 1);
          clampFocus();
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          tabIndex = (tabIndex - 1 + flattened.length + 1) % (flattened.length + 1);
          clampFocus();
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.up)) {
          focusByTab.set(key, Math.max(0, currentFocus - 1));
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.down)) {
          focusByTab.set(key, Math.min(rows.length - 1, currentFocus + 1));
          tui.requestRender();
          return;
        }

        if (!(matchesKey(data, Key.enter) || matchesKey(data, Key.space))) {
          return;
        }

        const row = rows[currentFocus];
        if (!row || row.disabled) return;

        if (row.action.kind === "toggle-context") {
          done({
            kind: "mutate",
            apply: () => {
              const questionId = flattened[tabIndex]!.question.questionId;
              if (expandedContext.has(questionId)) expandedContext.delete(questionId);
              else expandedContext.add(questionId);
            },
          });
          return;
        }

        if (row.action.kind === "toggle-choice") {
          const entry = flattened[tabIndex]!;
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => {
              if (entry.question.kind === "yes_no") {
                if (action.optionId === "yes" || action.optionId === "no") {
                  setYesNoSelection(state, entry.question.questionId, action.optionId);
                }
                return;
              }
              if (entry.question.kind === "multiple_choice") {
                toggleMultipleChoiceOption(
                  state,
                  entry.question.questionId,
                  action.optionId,
                  entry.question.selectionMode,
                );
              }
            },
          });
          return;
        }

        if (row.action.kind === "edit-answer") {
          const entry = flattened[tabIndex]!;
          const draft = getQuestionDraft(state, entry.question.questionId);
          done({
            kind: "edit",
            title: `Answer for ${entry.question.questionId}`,
            value: draft.answerDraft.kind === "freeform" ? draft.answerDraft.text : "",
          });
          return;
        }

        if (row.action.kind === "edit-answer-note") {
          const entry = flattened[tabIndex]!;
          const draft = getQuestionDraft(state, entry.question.questionId);
          const value = draft.answerDraft.kind === "multiple_choice" ? "" : draft.answerDraft.note;
          done({
            kind: "edit",
            title: `Answer note for ${entry.question.questionId}`,
            value,
          });
          return;
        }

        if (row.action.kind === "edit-other-text") {
          const entry = flattened[tabIndex]!;
          const draft = getQuestionDraft(state, entry.question.questionId);
          done({
            kind: "edit",
            title: `Other text for ${entry.question.questionId}`,
            value: draft.answerDraft.kind === "multiple_choice" ? draft.answerDraft.otherText : "",
          });
          return;
        }

        if (row.action.kind === "edit-option-note") {
          const entry = flattened[tabIndex]!;
          const draft = getQuestionDraft(state, entry.question.questionId);
          const action = row.action;
          done({
            kind: "edit",
            title: `Note for ${action.label}`,
            value:
              draft.answerDraft.kind === "multiple_choice"
                ? (draft.answerDraft.optionNoteDrafts[action.optionId] ?? "")
                : "",
          });
          return;
        }

        if (row.action.kind === "edit-question-note") {
          const entry = flattened[tabIndex]!;
          done({
            kind: "edit",
            title: `Question note for ${entry.question.questionId}`,
            value: getQuestionDraft(state, entry.question.questionId).questionNote,
          });
          return;
        }

        if (row.action.kind === "set-closure") {
          const entry = flattened[tabIndex]!;
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => setClosureState(state, entry.question.questionId, action.closureState),
          });
          return;
        }

        if (row.action.kind === "jump-question") {
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => {
              const targetIndex = flattened.findIndex(
                (entry) => entry.question.questionId === action.questionId,
              );
              if (targetIndex >= 0) tabIndex = targetIndex;
            },
          });
          return;
        }

        done({ kind: "submit" });
      },
      render(width: number) {
        const lines: string[] = [];
        lines.push(truncateToWidth(theme.fg("accent", theme.bold("Question Runtime")), width));
        lines.push(
          truncateToWidth(
            theme.fg(
              "muted",
              `requestId: ${payload.requestId}  file: ${payload.projectRelativePath}`,
            ),
            width,
          ),
        );
        lines.push("");

        const tabs = [
          ...flattened.map((entry, index) =>
            tabLabel(entry, index, getQuestionDraft(state, entry.question.questionId)),
          ),
          "Review",
        ];
        lines.push(
          truncateToWidth(
            tabs
              .map((label, index) => {
                const text = ` ${label} `;
                return index === tabIndex
                  ? theme.bg("selectedBg", theme.fg("text", text))
                  : theme.fg("muted", text);
              })
              .join(" "),
            width,
          ),
        );
        lines.push("");

        if (tabIndex === reviewTabIndex) {
          const review = buildReviewRows(flattened, state);
          lines.push(truncateToWidth(theme.fg("text", "Review"), width));
          lines.push(
            truncateToWidth(
              theme.fg(
                "muted",
                `answered: ${review.counts.answered}  open: ${review.counts.open}  skipped: ${review.counts.skipped}  needs_clarification: ${review.counts.needs_clarification}`,
              ),
              width,
            ),
          );
          lines.push("");
          if (review.blockers.length > 0) {
            lines.push(truncateToWidth(theme.fg("warning", "Submit blockers"), width));
          }

          const focus = focusByTab.get("__review__") ?? 0;
          for (let i = 0; i < review.rows.length; i++) {
            const row = review.rows[i]!;
            const prefix = i === focus ? theme.fg("accent", "❯") : " ";
            const tone = row.tone ?? "text";
            for (let lineIndex = 0; lineIndex < row.lines.length; lineIndex++) {
              const marker = lineIndex === 0 ? `${prefix} ` : "  ";
              lines.push(
                truncateToWidth(`${marker}${style(theme, tone, row.lines[lineIndex]!)}`, width),
              );
            }
          }
        } else {
          const entry = flattened[tabIndex]!;
          const draft = getQuestionDraft(state, entry.question.questionId);
          const rows = buildQuestionRows(
            entry,
            draft,
            expandedContext.has(entry.question.questionId),
          );
          const focus = focusByTab.get(entry.question.questionId) ?? 0;
          lines.push(truncateToWidth(theme.fg("text", entry.question.prompt), width));
          lines.push(
            truncateToWidth(
              theme.fg(
                "muted",
                `kind: ${kindLabel(entry.question)}  state: ${getQuestionResponseState(entry.question, draft)}`,
              ),
              width,
            ),
          );
          lines.push(truncateToWidth(theme.fg("dim", `path: ${entry.path}`), width));
          lines.push("");
          lines.push(truncateToWidth(theme.fg("muted", "Justification"), width));
          for (const line of entry.question.justification.split("\n")) {
            lines.push(truncateToWidth(theme.fg("text", line), width));
          }
          if (entry.question.context) {
            lines.push("");
            lines.push(
              truncateToWidth(
                theme.fg(
                  "muted",
                  expandedContext.has(entry.question.questionId)
                    ? "Context (expanded)"
                    : "Context (collapsed)",
                ),
                width,
              ),
            );
            if (expandedContext.has(entry.question.questionId)) {
              for (const line of entry.question.context.split("\n")) {
                lines.push(truncateToWidth(theme.fg("text", line), width));
              }
            }
          }
          if (entry.question.kind === "freeform") {
            lines.push("");
            lines.push(truncateToWidth(theme.fg("muted", "Suggested answer"), width));
            for (const line of entry.question.suggestedAnswer.split("\n")) {
              lines.push(truncateToWidth(theme.fg("text", line), width));
            }
          }
          lines.push("");
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const prefix = i === focus ? theme.fg("accent", "❯") : " ";
            const tone = row.disabled ? "dim" : (row.tone ?? "text");
            for (let lineIndex = 0; lineIndex < row.lines.length; lineIndex++) {
              const marker = lineIndex === 0 ? `${prefix} ` : "  ";
              lines.push(
                truncateToWidth(`${marker}${style(theme, tone, row.lines[lineIndex]!)}`, width),
              );
            }
          }
        }

        lines.push("");
        lines.push(
          truncateToWidth(
            [
              rawKeyHint("↑↓", "move"),
              rawKeyHint("Tab/←→", "switch tabs"),
              rawKeyHint("Enter/Space", "activate"),
              rawKeyHint("esc", "cancel"),
              rawKeyHint("ctrl+c", "cancel"),
            ].join(theme.fg("dim", " • ")),
            width,
          ),
        );
        return lines;
      },
      invalidate() {},
    }));

    if (step.kind === "cancel") {
      return buildQuestionRuntimeFormResult(flattened, state, "cancel");
    }

    if (step.kind === "mutate") {
      step.apply();
      clampFocus();
      continue;
    }

    if (step.kind === "submit") {
      const blockers = validateFormForSubmit(flattened, state);
      if (blockers.length === 0) {
        return buildQuestionRuntimeFormResult(flattened, state, "submit");
      }
      tabIndex = reviewTabIndex;
      focusByTab.set("__review__", 0);
      clampFocus();
      continue;
    }

    const edited = await ctx.ui.editor(step.title, step.value);
    if (edited === undefined) {
      continue;
    }

    const entry = flattened[tabIndex]!;
    const rows = getRows();
    const row = rows[focusByTab.get(focusKey()) ?? 0];
    if (!row) continue;

    if (row.action.kind === "edit-answer") {
      setFreeformText(state, entry.question.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-answer-note") {
      setAnswerNote(state, entry.question.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-other-text") {
      setMultipleChoiceOtherText(state, entry.question.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-option-note") {
      setMultipleChoiceOptionNote(state, entry.question.questionId, row.action.optionId, edited);
      continue;
    }
    if (row.action.kind === "edit-question-note") {
      setQuestionNote(state, entry.question.questionId, edited);
    }
  }
}
