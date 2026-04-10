import type { AuthorizedMultipleChoiceQuestion, AuthorizedYesNoQuestion } from "./types.js";

export interface RuntimeChoiceOption {
  optionId: string;
  label: string;
  description?: string;
  recommended: boolean;
  noteAllowed: boolean;
  automatic: boolean;
}

export interface RuntimeChoiceQuestionModel {
  selectionMode: "single" | "multi";
  options: RuntimeChoiceOption[];
}

export function buildChoiceQuestionModel(
  question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
): RuntimeChoiceQuestionModel {
  if (question.kind === "yes_no") {
    return {
      selectionMode: "single",
      options: [
        {
          optionId: "yes",
          label: "Yes",
          recommended: question.recommendedOptionId === "yes",
          noteAllowed: true,
          automatic: true,
        },
        {
          optionId: "no",
          label: "No",
          recommended: question.recommendedOptionId === "no",
          noteAllowed: true,
          automatic: true,
        },
      ],
    };
  }

  return {
    selectionMode: question.selectionMode,
    options: [
      ...question.options.map((option) => ({
        optionId: option.optionId,
        label: option.label,
        description: option.description,
        recommended: question.recommendedOptionIds.includes(option.optionId),
        noteAllowed: true,
        automatic: false,
      })),
      {
        optionId: "other",
        label: "Other",
        recommended: false,
        noteAllowed: false,
        automatic: true,
      },
    ],
  };
}

export function getSelectableOptionIds(
  question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
): string[] {
  return buildChoiceQuestionModel(question).options.map((option) => option.optionId);
}

export function getChoiceOptionLabel(
  question: AuthorizedYesNoQuestion | AuthorizedMultipleChoiceQuestion,
  optionId: string,
): string | null {
  return (
    buildChoiceQuestionModel(question).options.find((option) => option.optionId === optionId)
      ?.label ?? null
  );
}
