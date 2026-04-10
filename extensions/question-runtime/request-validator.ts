import type {
  AuthorizedQuestionRequest,
  ReservedOptionId,
  RequestValidationResult,
  ValidationIssue,
  ValidationIssueCode,
} from "./types.js";

interface QuestionIdOccurrence {
  id: string;
  path: string;
}

interface OptionIdOccurrence {
  questionPath: string;
  optionId: string;
  path: string;
}

interface RecommendedOptionIdsOccurrence {
  questionPath: string;
  selectionMode: "single" | "multi" | null;
  values: Array<{ value: string; path: string }>;
}

interface MultipleChoiceQuestionReference {
  questionPath: string;
  optionIds: Set<string>;
  recommendedOptionIds: Array<{ value: string; path: string }>;
}

interface QuestionKindPreferenceContext {
  path: string;
  kind: "yes_no" | "multiple_choice" | "freeform";
  prompt: string;
  justification?: string;
  suggestedAnswer?: string;
  selectionMode?: "single" | "multi";
  optionLabels?: string[];
}

const FORBIDDEN_PRODUCT_FIELDS = new Set(["screen", "loopControl", "terminalScreen", "terminal"]);
const RESERVED_OPTION_IDS = new Set<ReservedOptionId>(["yes", "no", "other"]);

function issue(
  code: ValidationIssueCode,
  path: string,
  message: string,
  hint: string,
  expected?: string,
  actual?: string,
): ValidationIssue {
  return { code, path, message, hint, expected, actual };
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function validateRequiredString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | null {
  if (!(key in source)) {
    issues.push(
      issue(
        "missing_required",
        `${path}.${key}`,
        `Missing required field \`${key}\``,
        `Add a non-empty string for \`${key}\`.`,
        "non-empty string",
      ),
    );
    return null;
  }

  const raw = source[key];
  if (typeof raw !== "string") {
    issues.push(
      issue(
        "invalid_type",
        `${path}.${key}`,
        `Field \`${key}\` must be a string`,
        `Set \`${key}\` to a non-empty string.`,
        "string",
        typeName(raw),
      ),
    );
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    issues.push(
      issue(
        "empty_string",
        `${path}.${key}`,
        `Field \`${key}\` must not be empty`,
        `Provide a non-empty string for \`${key}\`.`,
        "non-empty string",
        "empty string",
      ),
    );
    return null;
  }

  return trimmed;
}

function validateOptionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): string | undefined {
  if (!(key in source)) return undefined;

  const raw = source[key];
  if (typeof raw !== "string") {
    issues.push(
      issue(
        "invalid_type",
        `${path}.${key}`,
        `Field \`${key}\` must be a string when provided`,
        `Set \`${key}\` to a non-empty string or remove it.`,
        "string",
        typeName(raw),
      ),
    );
    return undefined;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    issues.push(
      issue(
        "empty_string",
        `${path}.${key}`,
        `Field \`${key}\` must not be empty when provided`,
        `Provide a non-empty string for \`${key}\` or remove it.`,
        "non-empty string",
        "empty string",
      ),
    );
    return undefined;
  }

  return trimmed;
}

function validateRecommendedOptionId(
  question: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!("recommendedOptionId" in question)) {
    issues.push(
      issue(
        "missing_required",
        `${path}.recommendedOptionId`,
        "Missing required field `recommendedOptionId` for yes_no",
        "Set `recommendedOptionId` to `yes` or `no`.",
        "yes | no",
      ),
    );
    return;
  }

  const value = question.recommendedOptionId;
  if (typeof value !== "string") {
    issues.push(
      issue(
        "invalid_type",
        `${path}.recommendedOptionId`,
        "Field `recommendedOptionId` must be a string",
        "Set `recommendedOptionId` to `yes` or `no`.",
        "string",
        typeName(value),
      ),
    );
    return;
  }

  if (value !== "yes" && value !== "no") {
    issues.push(
      issue(
        "invalid_enum",
        `${path}.recommendedOptionId`,
        "Field `recommendedOptionId` has an unsupported value",
        "Use `yes` or `no`.",
        "yes | no",
        value,
      ),
    );
  }
}

function validateRecommendedOptionIds(
  question: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): RecommendedOptionIdsOccurrence | null {
  const selectionMode =
    question.selectionMode === "single" || question.selectionMode === "multi"
      ? question.selectionMode
      : null;

  if (!("recommendedOptionIds" in question)) {
    issues.push(
      issue(
        "missing_required",
        `${path}.recommendedOptionIds`,
        "Missing required field `recommendedOptionIds` for multiple_choice",
        "Provide recommended authored optionId values.",
        "array",
      ),
    );
    return null;
  }

  const raw = question.recommendedOptionIds;
  if (!Array.isArray(raw)) {
    issues.push(
      issue(
        "invalid_type",
        `${path}.recommendedOptionIds`,
        "Field `recommendedOptionIds` must be an array",
        "Provide recommended authored optionId values.",
        "array",
        typeName(raw),
      ),
    );
    return null;
  }

  if (raw.length === 0) {
    issues.push(
      issue(
        "empty_array",
        `${path}.recommendedOptionIds`,
        "Field `recommendedOptionIds` must not be empty",
        "Add at least one recommended authored optionId.",
        "non-empty array",
        "empty array",
      ),
    );
  }

  const values: Array<{ value: string; path: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    const valuePath = `${path}.recommendedOptionIds[${i}]`;
    if (typeof value !== "string") {
      issues.push(
        issue(
          "invalid_type",
          valuePath,
          "Recommended option references must be strings",
          "Use authored optionId strings in `recommendedOptionIds`.",
          "string",
          typeName(value),
        ),
      );
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      issues.push(
        issue(
          "empty_string",
          valuePath,
          "Recommended option references must not be empty",
          "Use authored optionId strings in `recommendedOptionIds`.",
          "non-empty string",
          "empty string",
        ),
      );
      continue;
    }

    values.push({ value: trimmed, path: valuePath });
  }

  if (selectionMode === "single" && values.length !== 1) {
    issues.push(
      issue(
        values.length === 0 ? "empty_array" : "invalid_type",
        `${path}.recommendedOptionIds`,
        "Single-select questions require exactly one recommended option",
        "Keep exactly one authored optionId in `recommendedOptionIds` when `selectionMode` is `single`.",
      ),
    );
  }

  if (selectionMode === "multi" && values.length === 0) {
    issues.push(
      issue(
        "empty_array",
        `${path}.recommendedOptionIds`,
        "Multi-select questions require at least one recommended option",
        "Add one or more authored optionId values to `recommendedOptionIds`.",
      ),
    );
  }

  return { questionPath: path, selectionMode, values };
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isYesToken(value: string): boolean {
  return new Set(["yes", "y", "true"]).has(normalizeToken(value));
}

function isNoToken(value: string): boolean {
  return new Set(["no", "n", "false"]).has(normalizeToken(value));
}

function looksLikeYesNoPrompt(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return /^(is|are|do|does|did|can|could|should|would|will|has|have|had|was|were|am)\b/.test(
    normalized,
  );
}

function parseEnumeratedChoices(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const bulletMatches = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(-|\*|\d+\.)\s+\S+/.test(line))
    .map((line) => line.replace(/^(-|\*|\d+\.)\s+/, "").trim())
    .filter(Boolean);

  if (bulletMatches.length >= 2 && bulletMatches.length <= 5) {
    return bulletMatches;
  }

  return [];
}

function appendQuestionKindPreferenceIssues(
  context: QuestionKindPreferenceContext,
  issues: ValidationIssue[],
): void {
  if (context.kind === "multiple_choice") {
    if (
      context.selectionMode !== "single" ||
      !context.optionLabels ||
      context.optionLabels.length !== 2
    ) {
      return;
    }

    const [first, second] = context.optionLabels;
    const looksYesNoPair =
      (isYesToken(first) && isNoToken(second)) || (isNoToken(first) && isYesToken(second));
    if (!looksYesNoPair) return;

    issues.push(
      issue(
        "authoring_guidance",
        `${context.path}.kind`,
        "This single-select choice is a yes/no decision and should be authored as `yes_no`",
        'Use `kind: "yes_no"` with `recommendedOptionId: "yes" | "no"` instead of a two-option yes/no multiple choice.',
      ),
    );
    return;
  }

  if (context.kind !== "freeform") return;

  const suggested = context.suggestedAnswer?.trim() ?? "";
  if (!suggested) return;

  if (looksLikeYesNoPrompt(context.prompt) && (isYesToken(suggested) || isNoToken(suggested))) {
    issues.push(
      issue(
        "authoring_guidance",
        `${context.path}.kind`,
        "This question reads like a yes/no decision and should be authored as `yes_no`",
        'Use `kind: "yes_no"` when the recommended answer is just `yes` or `no`.',
      ),
    );
    return;
  }

  const finiteChoices = parseEnumeratedChoices(suggested);
  if (finiteChoices.length >= 2) {
    issues.push(
      issue(
        "authoring_guidance",
        `${context.path}.kind`,
        "This freeform suggested answer contains a finite option list and should be authored as `multiple_choice`",
        "Move the enumerated choices into `options`, set `selectionMode`, and use `recommendedOptionIds`.",
      ),
    );
    return;
  }

  const justification = context.justification?.toLowerCase() ?? "";
  const signalsNuance =
    /(nuance|nuanced|context|explain|details|detail|why|because|tradeoff|trade-off|open ended|open-ended)/.test(
      justification,
    );
  if (!signalsNuance && suggested.split(/\s+/).length <= 3) {
    issues.push(
      issue(
        "authoring_guidance",
        `${context.path}.justification`,
        "Freeform questions should explain why fixed choices would lose essential nuance",
        "Expand `justification` to say what nuance must stay open-ended, or convert the question to `yes_no` or `multiple_choice`.",
      ),
    );
  }
}

function appendForbiddenFieldIssues(
  source: Record<string, unknown>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(source)) {
    if (!FORBIDDEN_PRODUCT_FIELDS.has(key)) continue;
    issues.push(
      issue(
        "forbidden_field",
        `${path}.${key}`,
        `Field \`${key}\` is product-level control data and is not allowed in the shared runtime request`,
        `Remove \`${key}\` and keep product loop-control or terminal-screen semantics in the calling extension.`,
      ),
    );
  }
}

function validateQuestionNode(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  questionIds: QuestionIdOccurrence[],
  optionIds: OptionIdOccurrence[],
  recommendedOptionIds: RecommendedOptionIdsOccurrence[],
  multipleChoiceReferences: MultipleChoiceQuestionReference[],
): void {
  const question = asObject(value);
  if (!question) {
    issues.push(
      issue(
        "invalid_type",
        path,
        "Question must be an object",
        "Replace this item with a question object.",
        "object",
        typeName(value),
      ),
    );
    return;
  }

  appendForbiddenFieldIssues(question, path, issues);

  const questionId = validateRequiredString(question, "questionId", path, issues);
  if (questionId) questionIds.push({ id: questionId, path: `${path}.questionId` });

  const kindRaw = question.kind;
  let kind: "yes_no" | "multiple_choice" | "freeform" | null = null;
  if (!("kind" in question)) {
    issues.push(
      issue(
        "missing_required",
        `${path}.kind`,
        "Missing required field `kind`",
        "Set `kind` to one of: yes_no, multiple_choice, freeform.",
        "yes_no | multiple_choice | freeform",
      ),
    );
  } else if (typeof kindRaw !== "string") {
    issues.push(
      issue(
        "invalid_type",
        `${path}.kind`,
        "Field `kind` must be a string",
        "Set `kind` to one of: yes_no, multiple_choice, freeform.",
        "string",
        typeName(kindRaw),
      ),
    );
  } else if (kindRaw !== "yes_no" && kindRaw !== "multiple_choice" && kindRaw !== "freeform") {
    issues.push(
      issue(
        "invalid_enum",
        `${path}.kind`,
        "Field `kind` has an unsupported value",
        "Use one of: yes_no, multiple_choice, freeform.",
        "yes_no | multiple_choice | freeform",
        kindRaw,
      ),
    );
  } else {
    kind = kindRaw;
  }

  const prompt = validateRequiredString(question, "prompt", path, issues);
  const contextText = validateOptionalString(question, "context", path, issues);
  const justification = validateRequiredString(question, "justification", path, issues);
  void contextText;

  if (kind === "yes_no") {
    validateRecommendedOptionId(question, path, issues);
  }

  let freeformSuggestedAnswer: string | null = null;
  if (kind === "freeform") {
    freeformSuggestedAnswer = validateRequiredString(question, "suggestedAnswer", path, issues);
  }

  if (kind === "multiple_choice") {
    if (!("selectionMode" in question)) {
      issues.push(
        issue(
          "missing_required",
          `${path}.selectionMode`,
          "Missing required field `selectionMode` for multiple_choice",
          "Set `selectionMode` to `single` or `multi`.",
          "single | multi",
        ),
      );
    } else if (typeof question.selectionMode !== "string") {
      issues.push(
        issue(
          "invalid_type",
          `${path}.selectionMode`,
          "Field `selectionMode` must be a string",
          "Set `selectionMode` to `single` or `multi`.",
          "string",
          typeName(question.selectionMode),
        ),
      );
    } else if (question.selectionMode !== "single" && question.selectionMode !== "multi") {
      issues.push(
        issue(
          "invalid_enum",
          `${path}.selectionMode`,
          "Field `selectionMode` has an unsupported value",
          "Use `single` or `multi`.",
          "single | multi",
          question.selectionMode,
        ),
      );
    }

    const optionIdSet = new Set<string>();
    const optionLabels: string[] = [];

    if (!("options" in question)) {
      issues.push(
        issue(
          "missing_required",
          `${path}.options`,
          "Missing required field `options` for multiple_choice",
          "Provide a non-empty `options` array.",
          "non-empty array",
        ),
      );
    } else if (!Array.isArray(question.options)) {
      issues.push(
        issue(
          "invalid_type",
          `${path}.options`,
          "Field `options` must be an array",
          "Provide a non-empty `options` array.",
          "array",
          typeName(question.options),
        ),
      );
    } else if (question.options.length === 0) {
      issues.push(
        issue(
          "empty_array",
          `${path}.options`,
          "Field `options` must not be empty",
          "Add at least one option object.",
          "non-empty array",
          "empty array",
        ),
      );
    } else {
      for (let i = 0; i < question.options.length; i++) {
        const optionValue = question.options[i];
        const optionPath = `${path}.options[${i}]`;
        const option = asObject(optionValue);
        if (!option) {
          issues.push(
            issue(
              "invalid_type",
              optionPath,
              "Option must be an object",
              "Replace this item with an option object.",
              "object",
              typeName(optionValue),
            ),
          );
          continue;
        }

        appendForbiddenFieldIssues(option, optionPath, issues);

        const optionId = validateRequiredString(option, "optionId", optionPath, issues);
        if (optionId) {
          if (RESERVED_OPTION_IDS.has(optionId as ReservedOptionId)) {
            issues.push(
              issue(
                "reserved_identifier",
                `${optionPath}.optionId`,
                `Option ID \`${optionId}\` is reserved by the shared runtime`,
                "Use a different authored optionId. `yes`, `no`, and `other` are reserved.",
              ),
            );
          }
          optionIds.push({
            questionPath: path,
            optionId,
            path: `${optionPath}.optionId`,
          });
          optionIdSet.add(optionId);
        }
        const label = validateRequiredString(option, "label", optionPath, issues);
        if (label) optionLabels.push(label);
        validateOptionalString(option, "description", optionPath, issues);
      }
    }

    const recommended = validateRecommendedOptionIds(question, path, issues);
    if (recommended) {
      recommendedOptionIds.push(recommended);
      multipleChoiceReferences.push({
        questionPath: path,
        optionIds: optionIdSet,
        recommendedOptionIds: recommended.values,
      });
    }

    appendQuestionKindPreferenceIssues(
      {
        path,
        kind,
        prompt: prompt ?? "",
        justification: justification ?? undefined,
        selectionMode:
          question.selectionMode === "single" || question.selectionMode === "multi"
            ? question.selectionMode
            : undefined,
        optionLabels,
      },
      issues,
    );
  }

  if ("followUps" in question) {
    if (!Array.isArray(question.followUps)) {
      issues.push(
        issue(
          "invalid_type",
          `${path}.followUps`,
          "Field `followUps` must be an array when provided",
          "Set `followUps` to an array of question objects.",
          "array",
          typeName(question.followUps),
        ),
      );
    } else {
      for (let i = 0; i < question.followUps.length; i++) {
        validateQuestionNode(
          question.followUps[i],
          `${path}.followUps[${i}]`,
          issues,
          questionIds,
          optionIds,
          recommendedOptionIds,
          multipleChoiceReferences,
        );
      }
    }
  }

  if (!kind || !questionId || !prompt) return;

  if (kind === "freeform") {
    appendQuestionKindPreferenceIssues(
      {
        path,
        kind,
        prompt,
        justification: justification ?? undefined,
        suggestedAnswer: freeformSuggestedAnswer ?? undefined,
      },
      issues,
    );
  }
}

function appendDuplicateRecommendedOptionIssues(
  occurrences: RecommendedOptionIdsOccurrence[],
  issues: ValidationIssue[],
): void {
  for (const occurrence of occurrences) {
    const seen = new Set<string>();
    for (const value of occurrence.values) {
      if (!seen.has(value.value)) {
        seen.add(value.value);
        continue;
      }

      issues.push(
        issue(
          "duplicate_array_value",
          value.path,
          `Duplicate recommended option reference \`${value.value}\``,
          "Keep each recommended optionId only once per question.",
        ),
      );
    }
  }
}

function appendRecommendedOptionReferenceIssues(
  questions: MultipleChoiceQuestionReference[],
  issues: ValidationIssue[],
): void {
  for (const question of questions) {
    for (const reference of question.recommendedOptionIds) {
      if (question.optionIds.has(reference.value)) continue;
      issues.push(
        issue(
          "invalid_reference",
          reference.path,
          `Recommended option \`${reference.value}\` does not reference an authored option in this question`,
          "Reference an authored multiple_choice optionId. Synthetic `other` is not allowed here.",
        ),
      );
    }
  }
}

function appendDuplicateQuestionIssues(
  questionIds: QuestionIdOccurrence[],
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const occurrence of questionIds) {
    if (!seen.has(occurrence.id)) {
      seen.add(occurrence.id);
      continue;
    }

    issues.push(
      issue(
        "duplicate_question_id",
        occurrence.path,
        `Duplicate questionId \`${occurrence.id}\``,
        "Use a unique questionId for every question in pre-order traversal.",
      ),
    );
  }
}

function appendDuplicateOptionIssues(
  optionIds: OptionIdOccurrence[],
  issues: ValidationIssue[],
): void {
  const seenByQuestion = new Map<string, Set<string>>();

  for (const occurrence of optionIds) {
    let seen = seenByQuestion.get(occurrence.questionPath);
    if (!seen) {
      seen = new Set<string>();
      seenByQuestion.set(occurrence.questionPath, seen);
    }

    if (!seen.has(occurrence.optionId)) {
      seen.add(occurrence.optionId);
      continue;
    }

    issues.push(
      issue(
        "duplicate_option_id",
        occurrence.path,
        `Duplicate optionId \`${occurrence.optionId}\` within the same question`,
        "Use unique optionId values within each multiple_choice question.",
      ),
    );
  }
}

export function validateAuthorizedQuestionRequest(text: string): RequestValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return {
      ok: false,
      issues: [
        issue(
          "json_parse",
          "$",
          `Failed to parse JSON: ${message}`,
          "Write one valid JSON object with a non-empty `questions` array.",
          "valid JSON object",
        ),
      ],
    };
  }

  const root = asObject(parsed);
  if (!root) {
    return {
      ok: false,
      issues: [
        issue(
          "expected_object",
          "$",
          "Top-level value must be a JSON object",
          "Wrap the payload in `{ ... }`.",
          "object",
          typeName(parsed),
        ),
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const questionIds: QuestionIdOccurrence[] = [];
  const optionIds: OptionIdOccurrence[] = [];
  const recommendedOptionIds: RecommendedOptionIdsOccurrence[] = [];
  const multipleChoiceReferences: MultipleChoiceQuestionReference[] = [];

  appendForbiddenFieldIssues(root, "$", issues);

  if (!("questions" in root)) {
    issues.push(
      issue(
        "missing_required",
        "$.questions",
        "Missing required field `questions`",
        "Add a non-empty `questions` array.",
        "non-empty array",
      ),
    );
  } else if (!Array.isArray(root.questions)) {
    issues.push(
      issue(
        "invalid_type",
        "$.questions",
        "Field `questions` must be an array",
        "Set `questions` to an array of question objects.",
        "array",
        typeName(root.questions),
      ),
    );
  } else if (root.questions.length === 0) {
    issues.push(
      issue(
        "empty_array",
        "$.questions",
        "Field `questions` must not be empty",
        "Add at least one question object.",
        "non-empty array",
        "empty array",
      ),
    );
  } else {
    for (let i = 0; i < root.questions.length; i++) {
      validateQuestionNode(
        root.questions[i],
        `$.questions[${i}]`,
        issues,
        questionIds,
        optionIds,
        recommendedOptionIds,
        multipleChoiceReferences,
      );
    }
  }

  appendDuplicateQuestionIssues(questionIds, issues);
  appendDuplicateOptionIssues(optionIds, issues);
  appendDuplicateRecommendedOptionIssues(recommendedOptionIds, issues);
  appendRecommendedOptionReferenceIssues(multipleChoiceReferences, issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues: [],
    request: root as unknown as AuthorizedQuestionRequest,
  };
}
