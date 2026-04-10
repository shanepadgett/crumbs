import type {
  AuthorizedMultipleChoiceQuestion,
  AuthorizedQuestionNode,
  AuthorizedYesNoQuestion,
} from "./types.js";

export interface FlattenedQuestion {
  question: AuthorizedQuestionNode;
  path: string;
}

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

export function flattenQuestionsPreOrder(
  questions: AuthorizedQuestionNode[],
  basePath = "$.questions",
): FlattenedQuestion[] {
  const flattened: FlattenedQuestion[] = [];

  function visit(nodes: AuthorizedQuestionNode[], pathBase: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const question = nodes[i]!;
      const path = `${pathBase}[${i}]`;
      flattened.push({ question, path });
      if (Array.isArray(question.followUps) && question.followUps.length > 0) {
        visit(question.followUps, `${path}.followUps`);
      }
    }
  }

  visit(questions, basePath);
  return flattened;
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
