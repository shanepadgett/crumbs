import { rawKeyHint, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import {
  buildQuestionRuntimeFormResult,
  buildStructuredSubmitResult,
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
  buildActiveQuestionView,
  normalizeQuestionGraph,
  type ActiveQuestionEntry,
  type ActiveQuestionView,
} from "./question-graph.js";
import { buildChoiceQuestionModel, getChoiceOptionLabel } from "./question-model.js";
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

function kindLabel(question: AuthorizedQuestionNode): string {
  if (question.kind === "multiple_choice") return `multiple_choice (${question.selectionMode})`;
  return question.kind;
}

function tabLabel(
  entry: ActiveQuestionEntry,
  index: number,
  draft: QuestionRuntimeQuestionDraft,
): string {
  return `${statusBadge(getQuestionResponseState(entry.question, draft))} ${index + 1}:${entry.question.questionId}`;
}

function buildQuestionRows(
  entry: ActiveQuestionEntry,
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

function renderVisibilityReasons(entry: ActiveQuestionEntry): string[] {
  const rendered: string[] = [];

  for (const reason of entry.visibilityReasons) {
    if (reason.kind === "root") {
      rendered.push("Visible because root question");
      continue;
    }

    const optionText = reason.matchedOptionIds?.length
      ? ` (${reason.matchedOptionIds.join(", ")})`
      : "";
    rendered.push(`Visible because ${reason.parentQuestionId}${optionText}`);
  }

  return rendered;
}

function buildReviewRows(
  activeView: ActiveQuestionView,
  state: ReturnType<typeof createQuestionRuntimeFormState>,
) {
  const blockers = validateFormForSubmit(activeView, state);
  const counts = { answered: 0, skipped: 0, needs_clarification: 0, open: 0 };

  for (const entry of activeView.entries) {
    counts[getQuestionResponseState(entry.question, getQuestionDraft(state, entry.questionId))] +=
      1;
  }

  const rows: FocusableRow[] = blockers.map((blocker) => ({
    id: `blocker:${blocker.questionId}:${blocker.code}`,
    lines: [`Fix ${blocker.questionId}: ${blocker.message}`],
    tone: "warning",
    action: { kind: "jump-question", questionId: blocker.questionId },
  }));

  for (const entry of activeView.entries) {
    const responseState = getQuestionResponseState(
      entry.question,
      getQuestionDraft(state, entry.questionId),
    );
    rows.push({
      id: `summary:${entry.questionId}`,
      lines: [`${statusBadge(responseState)} ${entry.questionId}: ${responseState}`],
      tone:
        responseState === "answered" ? "success" : responseState === "open" ? "muted" : "warning",
      action: { kind: "jump-question", questionId: entry.questionId },
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
  const graph = normalizeQuestionGraph(payload.request);
  const state = createQuestionRuntimeFormState(graph, payload.request.draftSnapshot);
  const focusByQuestionId = new Map<string, number>();
  const expandedContextByQuestionId = new Set<string>();
  let currentTabId: string | "__review__" = graph.rootQuestionIds[0] ?? "__review__";
  let lastActiveQuestionIds: string[] = [];

  function getActiveView(): ActiveQuestionView {
    return buildActiveQuestionView(graph, (questionId) => {
      const entry = graph.questionsById[questionId]!;
      const draft = getQuestionDraft(state, questionId);
      return {
        draft,
        responseState: getQuestionResponseState(entry.question, draft),
      };
    });
  }

  function syncCurrentTabAfterActiveViewChange(activeView: ActiveQuestionView): void {
    const activeQuestionIds = activeView.entries.map((entry) => entry.questionId);
    if (currentTabId === "__review__") {
      lastActiveQuestionIds = activeQuestionIds;
      return;
    }
    if (activeQuestionIds.includes(currentTabId)) {
      lastActiveQuestionIds = activeQuestionIds;
      return;
    }

    const previousIndex = lastActiveQuestionIds.indexOf(currentTabId);
    if (previousIndex >= 0) {
      const left = activeQuestionIds[Math.min(previousIndex, activeQuestionIds.length - 1)];
      if (left) {
        currentTabId = left;
        lastActiveQuestionIds = activeQuestionIds;
        return;
      }
    }

    currentTabId = activeQuestionIds[0] ?? "__review__";
    lastActiveQuestionIds = activeQuestionIds;
  }

  function focusKey(): string {
    return currentTabId;
  }

  function currentEntry(activeView: ActiveQuestionView): ActiveQuestionEntry | null {
    if (currentTabId === "__review__") return null;
    return activeView.entries.find((entry) => entry.questionId === currentTabId) ?? null;
  }

  function getRows(activeView: ActiveQuestionView): FocusableRow[] {
    const entry = currentEntry(activeView);
    if (!entry) {
      return buildReviewRows(activeView, state).rows;
    }

    return buildQuestionRows(
      entry,
      getQuestionDraft(state, entry.questionId),
      expandedContextByQuestionId.has(entry.questionId),
    );
  }

  function clampFocus(activeView: ActiveQuestionView): void {
    const rows = getRows(activeView);
    const max = Math.max(0, rows.length - 1);
    const current = focusByQuestionId.get(focusKey()) ?? 0;
    focusByQuestionId.set(focusKey(), Math.min(current, max));
  }

  let activeView = getActiveView();
  syncCurrentTabAfterActiveViewChange(activeView);
  clampFocus(activeView);

  while (true) {
    activeView = getActiveView();
    syncCurrentTabAfterActiveViewChange(activeView);
    clampFocus(activeView);

    const step = await ctx.ui.custom<ShellStep>((tui, theme, _kb, done) => ({
      handleInput(data: string) {
        activeView = getActiveView();
        syncCurrentTabAfterActiveViewChange(activeView);
        const rows = getRows(activeView);
        const key = focusKey();
        const currentFocus = focusByQuestionId.get(key) ?? 0;
        const activeQuestionIds = activeView.entries.map((entry) => entry.questionId);

        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done({ kind: "cancel" });
          return;
        }

        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          const tabs = [...activeQuestionIds, "__review__"];
          const index = tabs.indexOf(currentTabId);
          currentTabId = tabs[(index + 1) % tabs.length] as string | "__review__";
          clampFocus(activeView);
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          const tabs = [...activeQuestionIds, "__review__"];
          const index = tabs.indexOf(currentTabId);
          currentTabId = tabs[(index - 1 + tabs.length) % tabs.length] as string | "__review__";
          clampFocus(activeView);
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.up)) {
          focusByQuestionId.set(key, Math.max(0, currentFocus - 1));
          tui.requestRender();
          return;
        }

        if (matchesKey(data, Key.down)) {
          focusByQuestionId.set(key, Math.min(rows.length - 1, currentFocus + 1));
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
              if (currentTabId === "__review__") return;
              if (expandedContextByQuestionId.has(currentTabId))
                expandedContextByQuestionId.delete(currentTabId);
              else expandedContextByQuestionId.add(currentTabId);
            },
          });
          return;
        }

        const entry = currentEntry(activeView);

        if (row.action.kind === "toggle-choice" && entry) {
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => {
              if (entry.question.kind === "yes_no") {
                if (action.optionId === "yes" || action.optionId === "no") {
                  setYesNoSelection(state, entry.questionId, action.optionId);
                }
                return;
              }

              if (entry.question.kind === "multiple_choice") {
                toggleMultipleChoiceOption(
                  state,
                  entry.questionId,
                  action.optionId,
                  entry.question.selectionMode,
                );
              }
            },
          });
          return;
        }

        if (row.action.kind === "edit-answer" && entry) {
          const draft = getQuestionDraft(state, entry.questionId);
          done({
            kind: "edit",
            title: `Answer for ${entry.questionId}`,
            value: draft.answerDraft.kind === "freeform" ? draft.answerDraft.text : "",
          });
          return;
        }

        if (row.action.kind === "edit-answer-note" && entry) {
          const draft = getQuestionDraft(state, entry.questionId);
          done({
            kind: "edit",
            title: `Answer note for ${entry.questionId}`,
            value: draft.answerDraft.kind === "multiple_choice" ? "" : draft.answerDraft.note,
          });
          return;
        }

        if (row.action.kind === "edit-other-text" && entry) {
          const draft = getQuestionDraft(state, entry.questionId);
          done({
            kind: "edit",
            title: `Other text for ${entry.questionId}`,
            value: draft.answerDraft.kind === "multiple_choice" ? draft.answerDraft.otherText : "",
          });
          return;
        }

        if (row.action.kind === "edit-option-note" && entry) {
          const action = row.action;
          const draft = getQuestionDraft(state, entry.questionId);
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

        if (row.action.kind === "edit-question-note" && entry) {
          done({
            kind: "edit",
            title: `Question note for ${entry.questionId}`,
            value: getQuestionDraft(state, entry.questionId).questionNote,
          });
          return;
        }

        if (row.action.kind === "set-closure" && entry) {
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => setClosureState(state, entry.questionId, action.closureState),
          });
          return;
        }

        if (row.action.kind === "jump-question") {
          const action = row.action;
          done({
            kind: "mutate",
            apply: () => {
              currentTabId = action.questionId;
            },
          });
          return;
        }

        done({ kind: "submit" });
      },
      render(width: number) {
        activeView = getActiveView();
        syncCurrentTabAfterActiveViewChange(activeView);
        const entry = currentEntry(activeView);
        const rows = getRows(activeView);

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
          ...activeView.entries.map((tabEntry, index) =>
            tabLabel(tabEntry, index, getQuestionDraft(state, tabEntry.questionId)),
          ),
          "Review",
        ];
        const selectedTabIndex =
          currentTabId === "__review__"
            ? activeView.entries.length
            : activeView.entries.findIndex((tabEntry) => tabEntry.questionId === currentTabId);

        lines.push(
          truncateToWidth(
            tabs
              .map((label, index) => {
                const text = ` ${label} `;
                return index === selectedTabIndex
                  ? theme.bg("selectedBg", theme.fg("text", text))
                  : theme.fg("muted", text);
              })
              .join(" "),
            width,
          ),
        );
        lines.push("");

        if (!entry) {
          const review = buildReviewRows(activeView, state);
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

          const focus = focusByQuestionId.get("__review__") ?? 0;
          for (let index = 0; index < review.rows.length; index++) {
            const row = review.rows[index]!;
            const prefix = index === focus ? theme.fg("accent", "❯") : " ";
            const tone = row.tone ?? "text";
            for (let lineIndex = 0; lineIndex < row.lines.length; lineIndex++) {
              const marker = lineIndex === 0 ? `${prefix} ` : "  ";
              lines.push(
                truncateToWidth(`${marker}${style(theme, tone, row.lines[lineIndex]!)}`, width),
              );
            }
          }
        } else {
          const draft = getQuestionDraft(state, entry.questionId);
          const focus = focusByQuestionId.get(entry.questionId) ?? 0;
          lines.push(truncateToWidth(theme.fg("text", entry.question.prompt), width));
          lines.push(
            truncateToWidth(
              theme.fg(
                "muted",
                `kind: ${kindLabel(entry.question)}  state: ${getQuestionResponseState(entry.question, draft)}  depth: ${entry.activationDepth}`,
              ),
              width,
            ),
          );
          lines.push("");
          lines.push(truncateToWidth(theme.fg("muted", "Justification"), width));
          for (const line of entry.question.justification.split("\n")) {
            lines.push(truncateToWidth(theme.fg("text", line), width));
          }
          lines.push("");
          lines.push(truncateToWidth(theme.fg("muted", "Visible because"), width));
          for (const reason of renderVisibilityReasons({
            ...entry,
            visibilityReasons: entry.visibilityReasons.map((reason) => ({
              ...reason,
              matchedOptionIds:
                reason.parentQuestionId && reason.matchedOptionIds
                  ? reason.matchedOptionIds.map((optionId) => {
                      const parentQuestionId = reason.parentQuestionId;
                      const parent = parentQuestionId
                        ? graph.questionsById[parentQuestionId]?.question
                        : undefined;
                      if (!parent || parent.kind === "freeform") return optionId;
                      return getChoiceOptionLabel(parent, optionId) ?? optionId;
                    })
                  : reason.matchedOptionIds,
            })),
          })) {
            lines.push(truncateToWidth(theme.fg("text", reason), width));
          }
          if (entry.question.context) {
            lines.push("");
            lines.push(
              truncateToWidth(
                theme.fg(
                  "muted",
                  expandedContextByQuestionId.has(entry.questionId)
                    ? "Context (expanded)"
                    : "Context (collapsed)",
                ),
                width,
              ),
            );
            if (expandedContextByQuestionId.has(entry.questionId)) {
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
          for (let index = 0; index < rows.length; index++) {
            const row = rows[index]!;
            const prefix = index === focus ? theme.fg("accent", "❯") : " ";
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
      return buildQuestionRuntimeFormResult({ action: "cancel", state });
    }

    if (step.kind === "mutate") {
      step.apply();
      activeView = getActiveView();
      syncCurrentTabAfterActiveViewChange(activeView);
      clampFocus(activeView);
      continue;
    }

    if (step.kind === "submit") {
      activeView = getActiveView();
      const blockers = validateFormForSubmit(activeView, state);
      if (blockers.length === 0) {
        return buildQuestionRuntimeFormResult({
          action: "submit",
          state,
          submitResult: buildStructuredSubmitResult(activeView, state),
        });
      }
      currentTabId = "__review__";
      focusByQuestionId.set("__review__", 0);
      clampFocus(activeView);
      continue;
    }

    const edited = await ctx.ui.editor(step.title, step.value);
    if (edited === undefined) continue;

    activeView = getActiveView();
    const entry = currentEntry(activeView);
    const row = getRows(activeView)[focusByQuestionId.get(focusKey()) ?? 0];
    if (!entry || !row) continue;

    if (row.action.kind === "edit-answer") {
      setFreeformText(state, entry.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-answer-note") {
      setAnswerNote(state, entry.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-other-text") {
      setMultipleChoiceOtherText(state, entry.questionId, edited);
      continue;
    }
    if (row.action.kind === "edit-option-note") {
      setMultipleChoiceOptionNote(state, entry.questionId, row.action.optionId, edited);
      continue;
    }
    if (row.action.kind === "edit-question-note") {
      setQuestionNote(state, entry.questionId, edited);
    }
  }
}
