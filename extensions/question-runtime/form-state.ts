import type { FlattenedQuestion } from "./question-model.js";
import type {
  AuthorizedQuestionNode,
  QuestionClosureState,
  QuestionResponseState,
  QuestionRuntimeFormResult,
  QuestionRuntimeQuestionDraft,
  QuestionRuntimeQuestionOutcome,
  YesNoOptionId,
} from "./types.js";

export type FormValidationIssueCode = "missing_other_text" | "missing_clarification_note";

export interface FormValidationIssue {
  questionId: string;
  code: FormValidationIssueCode;
  message: string;
}

export interface QuestionRuntimeFormState {
  questions: Record<string, QuestionRuntimeQuestionDraft>;
  questionOrder: string[];
}

function createDraft(question: AuthorizedQuestionNode): QuestionRuntimeQuestionDraft {
  if (question.kind === "yes_no") {
    return {
      questionId: question.questionId,
      closureState: "open",
      questionNote: "",
      answerDraft: { kind: "yes_no", selectedOptionId: null, note: "" },
    };
  }

  if (question.kind === "freeform") {
    return {
      questionId: question.questionId,
      closureState: "open",
      questionNote: "",
      answerDraft: { kind: "freeform", text: "", note: "" },
    };
  }

  return {
    questionId: question.questionId,
    closureState: "open",
    questionNote: "",
    answerDraft: {
      kind: "multiple_choice",
      selectedOptionIds: [],
      otherText: "",
      optionNoteDrafts: {},
    },
  };
}

function cloneDraft(draft: QuestionRuntimeQuestionDraft): QuestionRuntimeQuestionDraft {
  if (draft.answerDraft.kind === "multiple_choice") {
    return {
      ...draft,
      answerDraft: {
        ...draft.answerDraft,
        selectedOptionIds: [...draft.answerDraft.selectedOptionIds],
        optionNoteDrafts: { ...draft.answerDraft.optionNoteDrafts },
      },
    };
  }

  return {
    ...draft,
    answerDraft: { ...draft.answerDraft },
  };
}

export function createQuestionRuntimeFormState(
  flattenedQuestions: FlattenedQuestion[],
): QuestionRuntimeFormState {
  const questions: Record<string, QuestionRuntimeQuestionDraft> = {};
  const questionOrder: string[] = [];

  for (const entry of flattenedQuestions) {
    const { questionId } = entry.question;
    questions[questionId] = createDraft(entry.question);
    questionOrder.push(questionId);
  }

  return { questions, questionOrder };
}

export function getQuestionDraft(
  state: QuestionRuntimeFormState,
  questionId: string,
): QuestionRuntimeQuestionDraft {
  const draft = state.questions[questionId];
  if (!draft) throw new Error(`Unknown question draft: ${questionId}`);
  return draft;
}

export function isAnswerDraftComplete(
  question: AuthorizedQuestionNode,
  draft: QuestionRuntimeQuestionDraft,
): boolean {
  if (question.kind === "yes_no") {
    return draft.answerDraft.kind === "yes_no" && draft.answerDraft.selectedOptionId !== null;
  }

  if (question.kind === "freeform") {
    return draft.answerDraft.kind === "freeform" && draft.answerDraft.text.trim().length > 0;
  }

  if (draft.answerDraft.kind !== "multiple_choice") return false;
  if (draft.answerDraft.selectedOptionIds.length === 0) return false;
  if (draft.answerDraft.selectedOptionIds.includes("other")) {
    return draft.answerDraft.otherText.trim().length > 0;
  }
  return true;
}

export function getQuestionResponseState(
  question: AuthorizedQuestionNode,
  draft: QuestionRuntimeQuestionDraft,
): QuestionResponseState {
  if (draft.closureState === "skipped") return "skipped";
  if (draft.closureState === "needs_clarification") return "needs_clarification";
  if (isAnswerDraftComplete(question, draft)) return "answered";
  return "open";
}

export function setClosureState(
  state: QuestionRuntimeFormState,
  questionId: string,
  closureState: QuestionClosureState,
): void {
  getQuestionDraft(state, questionId).closureState = closureState;
}

export function setYesNoSelection(
  state: QuestionRuntimeFormState,
  questionId: string,
  optionId: YesNoOptionId,
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind !== "yes_no") return;
  draft.answerDraft.selectedOptionId =
    draft.answerDraft.selectedOptionId === optionId ? null : optionId;
}

export function toggleMultipleChoiceOption(
  state: QuestionRuntimeFormState,
  questionId: string,
  optionId: string,
  selectionMode: "single" | "multi",
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind !== "multiple_choice") return;

  const selected = draft.answerDraft.selectedOptionIds;
  const index = selected.indexOf(optionId);
  if (selectionMode === "single") {
    draft.answerDraft.selectedOptionIds = index >= 0 ? [] : [optionId];
    return;
  }

  if (index >= 0) {
    draft.answerDraft.selectedOptionIds = selected.filter((value) => value !== optionId);
    return;
  }

  draft.answerDraft.selectedOptionIds = [...selected, optionId];
}

export function setMultipleChoiceOtherText(
  state: QuestionRuntimeFormState,
  questionId: string,
  otherText: string,
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind !== "multiple_choice") return;
  draft.answerDraft.otherText = otherText;
}

export function setMultipleChoiceOptionNote(
  state: QuestionRuntimeFormState,
  questionId: string,
  optionId: string,
  note: string,
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind !== "multiple_choice") return;
  draft.answerDraft.optionNoteDrafts[optionId] = note;
}

export function setFreeformText(
  state: QuestionRuntimeFormState,
  questionId: string,
  text: string,
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind !== "freeform") return;
  draft.answerDraft.text = text;
}

export function setAnswerNote(
  state: QuestionRuntimeFormState,
  questionId: string,
  note: string,
): void {
  const draft = getQuestionDraft(state, questionId);
  if (draft.answerDraft.kind === "yes_no" || draft.answerDraft.kind === "freeform") {
    draft.answerDraft.note = note;
  }
}

export function setQuestionNote(
  state: QuestionRuntimeFormState,
  questionId: string,
  note: string,
): void {
  getQuestionDraft(state, questionId).questionNote = note;
}

function sanitizedNote(note: string): string | undefined {
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildQuestionOutcome(
  question: AuthorizedQuestionNode,
  draft: QuestionRuntimeQuestionDraft,
): QuestionRuntimeQuestionOutcome {
  if (draft.closureState === "skipped") {
    return {
      questionId: question.questionId,
      state: "skipped",
      note: sanitizedNote(draft.questionNote),
    };
  }

  if (draft.closureState === "needs_clarification") {
    return {
      questionId: question.questionId,
      state: "needs_clarification",
      note: draft.questionNote.trim(),
    };
  }

  if (!isAnswerDraftComplete(question, draft)) {
    return { questionId: question.questionId, state: "open" };
  }

  if (question.kind === "yes_no" && draft.answerDraft.kind === "yes_no") {
    return {
      questionId: question.questionId,
      state: "answered",
      answer: {
        kind: "yes_no",
        optionId: draft.answerDraft.selectedOptionId ?? "yes",
        note: sanitizedNote(draft.answerDraft.note),
      },
    };
  }

  if (question.kind === "freeform" && draft.answerDraft.kind === "freeform") {
    return {
      questionId: question.questionId,
      state: "answered",
      answer: {
        kind: "freeform",
        text: draft.answerDraft.text,
        note: sanitizedNote(draft.answerDraft.note),
      },
    };
  }

  if (draft.answerDraft.kind !== "multiple_choice") {
    return { questionId: question.questionId, state: "open" };
  }

  const multipleChoiceDraft = draft.answerDraft;

  const selections = multipleChoiceDraft.selectedOptionIds.map((optionId) => ({
    optionId,
    note:
      optionId === "other"
        ? undefined
        : sanitizedNote(multipleChoiceDraft.optionNoteDrafts[optionId] ?? ""),
  }));

  return {
    questionId: question.questionId,
    state: "answered",
    answer: {
      kind: "multiple_choice",
      selections: selections.map((selection) =>
        selection.note ? selection : { optionId: selection.optionId },
      ),
      otherText: multipleChoiceDraft.selectedOptionIds.includes("other")
        ? multipleChoiceDraft.otherText.trim()
        : undefined,
    },
  };
}

export function validateFormForSubmit(
  flattenedQuestions: FlattenedQuestion[],
  state: QuestionRuntimeFormState,
): FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];

  for (const entry of flattenedQuestions) {
    const draft = getQuestionDraft(state, entry.question.questionId);
    if (draft.closureState === "needs_clarification" && draft.questionNote.trim().length === 0) {
      issues.push({
        questionId: entry.question.questionId,
        code: "missing_clarification_note",
        message: "Needs clarification requires a note.",
      });
    }

    if (
      entry.question.kind === "multiple_choice" &&
      draft.answerDraft.kind === "multiple_choice" &&
      draft.answerDraft.selectedOptionIds.includes("other") &&
      draft.answerDraft.otherText.trim().length === 0
    ) {
      issues.push({
        questionId: entry.question.questionId,
        code: "missing_other_text",
        message: "Other requires non-empty text before submit.",
      });
    }
  }

  return issues;
}

export function buildQuestionRuntimeFormResult(
  flattenedQuestions: FlattenedQuestion[],
  state: QuestionRuntimeFormState,
  action: "submit" | "cancel",
): QuestionRuntimeFormResult {
  const draftSnapshot = state.questionOrder.map((questionId) =>
    cloneDraft(getQuestionDraft(state, questionId)),
  );
  const outcomes = flattenedQuestions.map((entry) =>
    buildQuestionOutcome(entry.question, getQuestionDraft(state, entry.question.questionId)),
  );
  return { action, draftSnapshot, outcomes };
}
