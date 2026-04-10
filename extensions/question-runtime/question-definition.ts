import type {
  AuthorizedMultipleChoiceQuestion,
  AuthorizedQuestionNode,
  AuthorizedYesNoQuestion,
} from "./types.js";

export interface CanonicalQuestionDefinitionSignature {
  questionId: string;
  kind: "yes_no" | "multiple_choice" | "freeform";
  prompt: string;
  context?: string;
  justification: string;
  dependsOnQuestionIds: string[];
  recommendedOptionId?: "yes" | "no";
  suggestedAnswer?: string;
  selectionMode?: "single" | "multi";
  options?: Array<{ optionId: string; label: string; description?: string }>;
  recommendedOptionIds?: string[];
}

export function getCanonicalQuestionDefinitionSignature(
  question: AuthorizedQuestionNode,
): CanonicalQuestionDefinitionSignature {
  const base = {
    questionId: question.questionId,
    kind: question.kind,
    prompt: question.prompt,
    context: question.context,
    justification: question.justification,
    dependsOnQuestionIds: [...(question.dependsOnQuestionIds ?? [])],
  } satisfies Omit<
    CanonicalQuestionDefinitionSignature,
    "recommendedOptionId" | "suggestedAnswer" | "selectionMode" | "options" | "recommendedOptionIds"
  >;

  if (question.kind === "yes_no") {
    return {
      ...base,
      recommendedOptionId: question.recommendedOptionId,
    };
  }

  if (question.kind === "freeform") {
    return {
      ...base,
      suggestedAnswer: question.suggestedAnswer,
    };
  }

  return {
    ...base,
    selectionMode: question.selectionMode,
    options: question.options.map((option) => ({
      optionId: option.optionId,
      label: option.label,
      description: option.description,
    })),
    recommendedOptionIds: [...question.recommendedOptionIds],
  };
}

export function sameCanonicalQuestionDefinition(
  left: AuthorizedQuestionNode,
  right: AuthorizedQuestionNode,
): boolean {
  return (
    stableStringify(getCanonicalQuestionDefinitionSignature(left)) ===
    stableStringify(getCanonicalQuestionDefinitionSignature(right))
  );
}

export function stripOccurrenceFields(question: AuthorizedQuestionNode): AuthorizedQuestionNode {
  const base = {
    questionId: question.questionId,
    kind: question.kind,
    prompt: question.prompt,
    context: question.context,
    justification: question.justification,
    dependsOnQuestionIds: question.dependsOnQuestionIds
      ? [...question.dependsOnQuestionIds]
      : undefined,
  };

  if (question.kind === "yes_no") {
    return {
      ...base,
      kind: "yes_no",
      recommendedOptionId: question.recommendedOptionId,
    } satisfies AuthorizedYesNoQuestion;
  }

  if (question.kind === "freeform") {
    return {
      ...base,
      kind: "freeform",
      suggestedAnswer: question.suggestedAnswer,
    };
  }

  return {
    ...base,
    kind: "multiple_choice",
    selectionMode: question.selectionMode,
    options: question.options.map((option) => ({ ...option })),
    recommendedOptionIds: [...question.recommendedOptionIds],
  } satisfies AuthorizedMultipleChoiceQuestion;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}
