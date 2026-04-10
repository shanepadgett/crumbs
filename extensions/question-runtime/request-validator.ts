import { sameCanonicalQuestionDefinition } from "./question-definition.js";
import { getSelectableOptionIds } from "./question-model.js";
import type {
  AuthorizedQuestionNode,
  AuthorizedQuestionRequest,
  QuestionRuntimeQuestionDraft,
  RequestValidationResult,
  ReservedOptionId,
  ValidationIssue,
  ValidationIssueCode,
} from "./types.js";

const FORBIDDEN_PRODUCT_FIELDS = new Set(["screen", "loopControl", "terminalScreen", "terminal"]);
const RESERVED_OPTION_IDS = new Set<ReservedOptionId>(["yes", "no", "other"]);

interface TraversalOccurrence {
  question: AuthorizedQuestionNode;
  path: string;
  isRoot: boolean;
  parentQuestion?: AuthorizedQuestionNode;
}

interface DraftValidationContext {
  questionsById: Map<string, AuthorizedQuestionNode>;
  seenDraftIds: Set<string>;
}

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
  options?: { allowEmpty?: boolean },
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

  if (options?.allowEmpty) {
    return raw;
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

function validateStringArray(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  options?: { allowEmpty?: boolean },
): Array<{ value: string; path: string }> | null {
  if (!(key in source)) return [];
  const raw = source[key];
  if (!Array.isArray(raw)) {
    issues.push(
      issue(
        "invalid_type",
        `${path}.${key}`,
        `Field \`${key}\` must be an array`,
        `Set \`${key}\` to an array of strings.`,
        "array",
        typeName(raw),
      ),
    );
    return null;
  }
  if (!options?.allowEmpty && raw.length === 0) {
    issues.push(
      issue(
        "empty_array",
        `${path}.${key}`,
        `Field \`${key}\` must not be empty`,
        `Add at least one string or remove \`${key}\`.`,
        "non-empty array",
        "empty array",
      ),
    );
  }

  const values: Array<{ value: string; path: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    const itemPath = `${path}.${key}[${index}]`;
    if (typeof item !== "string") {
      issues.push(
        issue(
          "invalid_type",
          itemPath,
          `Array item in \`${key}\` must be a string`,
          `Use non-empty strings in \`${key}\`.`,
          "string",
          typeName(item),
        ),
      );
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      issues.push(
        issue(
          "empty_string",
          itemPath,
          `Array item in \`${key}\` must not be empty`,
          `Use non-empty strings in \`${key}\`.`,
          "non-empty string",
          "empty string",
        ),
      );
      continue;
    }
    if (seen.has(trimmed)) {
      issues.push(
        issue(
          "duplicate_array_value",
          itemPath,
          `Duplicate value \`${trimmed}\``,
          `Keep each value only once in \`${key}\`.`,
        ),
      );
      continue;
    }
    seen.add(trimmed);
    values.push({ value: trimmed, path: itemPath });
  }
  return values;
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
  occurrences: TraversalOccurrence[],
  questionDefinitions: Map<string, TraversalOccurrence[]>,
  parentQuestion?: AuthorizedQuestionNode,
  isRoot = false,
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
  const prompt = validateRequiredString(question, "prompt", path, issues);
  validateOptionalString(question, "context", path, issues);
  validateRequiredString(question, "justification", path, issues);
  const dependsOn = validateStringArray(question, "dependsOnQuestionIds", path, issues, {
    allowEmpty: false,
  });

  const anyOf = validateStringArray(question, "anyOfSelectedOptionIds", path, issues, {
    allowEmpty: false,
  });
  const allOf = validateStringArray(question, "allOfSelectedOptionIds", path, issues, {
    allowEmpty: false,
  });

  const kindRaw = question.kind;
  let kind: AuthorizedQuestionNode["kind"] | null = null;
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
  } else if (kindRaw === "yes_no" || kindRaw === "multiple_choice" || kindRaw === "freeform") {
    kind = kindRaw;
  } else {
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
  }

  if (isRoot && ((anyOf?.length ?? 0) > 0 || (allOf?.length ?? 0) > 0)) {
    if ((anyOf?.length ?? 0) > 0) {
      issues.push(
        issue(
          "invalid_activation",
          `${path}.anyOfSelectedOptionIds`,
          "Root questions cannot declare activation arrays",
          "Remove activation arrays from top-level questions.",
        ),
      );
    }
    if ((allOf?.length ?? 0) > 0) {
      issues.push(
        issue(
          "invalid_activation",
          `${path}.allOfSelectedOptionIds`,
          "Root questions cannot declare activation arrays",
          "Remove activation arrays from top-level questions.",
        ),
      );
    }
  }

  if (kind === "yes_no") {
    const recommendedOptionId = validateRequiredString(
      question,
      "recommendedOptionId",
      path,
      issues,
    );
    if (recommendedOptionId && recommendedOptionId !== "yes" && recommendedOptionId !== "no") {
      issues.push(
        issue(
          "invalid_enum",
          `${path}.recommendedOptionId`,
          "Field `recommendedOptionId` has an unsupported value",
          "Use `yes` or `no`.",
          "yes | no",
          recommendedOptionId,
        ),
      );
    }
  }

  if (kind === "freeform") {
    validateRequiredString(question, "suggestedAnswer", path, issues);
  }

  if (kind === "multiple_choice") {
    const selectionMode = validateRequiredString(question, "selectionMode", path, issues);
    if (selectionMode && selectionMode !== "single" && selectionMode !== "multi") {
      issues.push(
        issue(
          "invalid_enum",
          `${path}.selectionMode`,
          "Field `selectionMode` has an unsupported value",
          "Use `single` or `multi`.",
          "single | multi",
          selectionMode,
        ),
      );
    }

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
      const optionIds = new Set<string>();
      for (let index = 0; index < question.options.length; index++) {
        const optionPath = `${path}.options[${index}]`;
        const option = asObject(question.options[index]);
        if (!option) {
          issues.push(
            issue(
              "invalid_type",
              optionPath,
              "Option must be an object",
              "Replace this item with an option object.",
              "object",
              typeName(question.options[index]),
            ),
          );
          continue;
        }
        appendForbiddenFieldIssues(option, optionPath, issues);
        const optionId = validateRequiredString(option, "optionId", optionPath, issues);
        validateRequiredString(option, "label", optionPath, issues);
        validateOptionalString(option, "description", optionPath, issues);
        if (!optionId) continue;
        if (RESERVED_OPTION_IDS.has(optionId as ReservedOptionId)) {
          issues.push(
            issue(
              "reserved_identifier",
              `${optionPath}.optionId`,
              `Option ID \`${optionId}\` is reserved by the shared runtime`,
              "Use a different authored optionId. `yes`, `no`, and `other` are reserved.",
            ),
          );
          continue;
        }
        if (optionIds.has(optionId)) {
          issues.push(
            issue(
              "duplicate_option_id",
              `${optionPath}.optionId`,
              `Duplicate optionId \`${optionId}\` within the same question`,
              "Use unique optionId values within each multiple_choice question.",
            ),
          );
          continue;
        }
        optionIds.add(optionId);
      }

      const recommended = validateStringArray(question, "recommendedOptionIds", path, issues, {
        allowEmpty: false,
      });
      for (const value of recommended ?? []) {
        if (!optionIds.has(value.value)) {
          issues.push(
            issue(
              "invalid_reference",
              value.path,
              `Recommended option \`${value.value}\` does not reference an authored option in this question`,
              "Reference an authored multiple_choice optionId. Synthetic `other` is not allowed here.",
            ),
          );
        }
      }
    }
  }

  const built = question as unknown as AuthorizedQuestionNode;
  if (questionId && prompt && kind) {
    const occurrence = { question: built, path, isRoot, parentQuestion };
    occurrences.push(occurrence);
    const group = questionDefinitions.get(questionId) ?? [];
    group.push(occurrence);
    questionDefinitions.set(questionId, group);
  }

  if (parentQuestion && (anyOf || allOf)) {
    appendActivationRuleIssues(parentQuestion, path, anyOf ?? [], allOf ?? [], issues);
  }

  if (kind === "freeform" && Array.isArray(question.followUps) && question.followUps.length > 0) {
    issues.push(
      issue(
        "invalid_activation",
        `${path}.followUps`,
        "Freeform questions cannot declare follow-ups",
        "Remove `followUps` from freeform questions.",
      ),
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
      for (let index = 0; index < question.followUps.length; index++) {
        validateQuestionNode(
          question.followUps[index],
          `${path}.followUps[${index}]`,
          issues,
          occurrences,
          questionDefinitions,
          built,
          false,
        );
      }
    }
  }

  if (dependsOn) {
    for (const dependency of dependsOn) {
      if (dependency.value === questionId) {
        issues.push(
          issue(
            "invalid_reference",
            dependency.path,
            `Question \`${questionId}\` cannot depend on itself`,
            "Remove self-dependencies from `dependsOnQuestionIds`.",
          ),
        );
      }
    }
  }
}

function appendConflictingQuestionDefinitionIssues(
  questionDefinitions: Map<string, TraversalOccurrence[]>,
  issues: ValidationIssue[],
): void {
  for (const [questionId, occurrences] of questionDefinitions.entries()) {
    if (occurrences.length < 2) continue;
    const first = occurrences[0]!;
    for (let index = 1; index < occurrences.length; index++) {
      const next = occurrences[index]!;
      if (sameCanonicalQuestionDefinition(first.question, next.question)) continue;
      issues.push(
        issue(
          "conflicting_question_definition",
          `${next.path}.questionId`,
          `Repeated questionId \`${questionId}\` must keep the same canonical question definition`,
          "Keep prompt, kind, dependencies, recommendations, and authored options identical across repeated occurrences.",
        ),
      );
    }
  }
}

function appendDependencyReferenceIssues(
  occurrences: TraversalOccurrence[],
  issues: ValidationIssue[],
): void {
  const allQuestionIds = new Set(occurrences.map((occurrence) => occurrence.question.questionId));
  for (const occurrence of occurrences) {
    for (let index = 0; index < (occurrence.question.dependsOnQuestionIds ?? []).length; index++) {
      const dependencyId = occurrence.question.dependsOnQuestionIds![index]!;
      if (!allQuestionIds.has(dependencyId)) {
        issues.push(
          issue(
            "invalid_reference",
            `${occurrence.path}.dependsOnQuestionIds[${index}]`,
            `Dependency \`${dependencyId}\` does not reference a declared questionId`,
            "Reference another declared questionId in this request.",
          ),
        );
      }
    }
  }
}

function appendActivationRuleIssues(
  parentQuestion: AuthorizedQuestionNode,
  path: string,
  anyOf: Array<{ value: string; path: string }>,
  allOf: Array<{ value: string; path: string }>,
  issues: ValidationIssue[],
): void {
  if (parentQuestion.kind === "freeform") {
    if (anyOf.length > 0) {
      issues.push(
        issue(
          "invalid_activation",
          `${path}.anyOfSelectedOptionIds`,
          "Freeform parents cannot drive activation rules",
          "Remove activation arrays from follow-ups under freeform questions.",
        ),
      );
    }
    if (allOf.length > 0) {
      issues.push(
        issue(
          "invalid_activation",
          `${path}.allOfSelectedOptionIds`,
          "Freeform parents cannot drive activation rules",
          "Remove activation arrays from follow-ups under freeform questions.",
        ),
      );
    }
    return;
  }

  const selectable = new Set(getSelectableOptionIds(parentQuestion));
  for (const entry of [...anyOf, ...allOf]) {
    if (!selectable.has(entry.value)) {
      issues.push(
        issue(
          "invalid_reference",
          entry.path,
          `Activation option \`${entry.value}\` is not valid for parent question \`${parentQuestion.questionId}\``,
          "Use one of the parent question's selectable optionIds.",
        ),
      );
    }
  }
}

function validateDraftSnapshot(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  context: DraftValidationContext,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(
      issue(
        "invalid_type",
        path,
        "Field `draftSnapshot` must be an array when provided",
        "Set `draftSnapshot` to an array of question draft objects.",
        "array",
        typeName(value),
      ),
    );
    return;
  }

  for (let index = 0; index < value.length; index++) {
    const itemPath = `${path}[${index}]`;
    const item = asObject(value[index]);
    if (!item) {
      issues.push(
        issue(
          "invalid_type",
          itemPath,
          "Draft entry must be an object",
          "Replace this item with a question draft object.",
          "object",
          typeName(value[index]),
        ),
      );
      continue;
    }

    const questionId = validateRequiredString(item, "questionId", itemPath, issues);
    if (!questionId) continue;
    if (context.seenDraftIds.has(questionId)) {
      issues.push(
        issue(
          "duplicate_question_id",
          `${itemPath}.questionId`,
          `Duplicate draftSnapshot questionId \`${questionId}\``,
          "Keep one draft entry per questionId.",
        ),
      );
      continue;
    }
    context.seenDraftIds.add(questionId);

    const question = context.questionsById.get(questionId);
    if (!question) {
      issues.push(
        issue(
          "invalid_reference",
          `${itemPath}.questionId`,
          `Draft snapshot questionId \`${questionId}\` does not reference a declared question`,
          "Keep only draft entries for questions that exist in this request.",
        ),
      );
      continue;
    }

    const closureState = validateRequiredString(item, "closureState", itemPath, issues);
    if (
      closureState &&
      closureState !== "open" &&
      closureState !== "skipped" &&
      closureState !== "needs_clarification"
    ) {
      issues.push(
        issue(
          "invalid_enum",
          `${itemPath}.closureState`,
          "Field `closureState` has an unsupported value",
          "Use `open`, `skipped`, or `needs_clarification`.",
          "open | skipped | needs_clarification",
          closureState,
        ),
      );
    }

    const answerDraft = asObject(item.answerDraft);
    if (!answerDraft) {
      issues.push(
        issue(
          "invalid_type",
          `${itemPath}.answerDraft`,
          "Field `answerDraft` must be an object",
          "Provide an answerDraft matching the question kind.",
          "object",
          typeName(item.answerDraft),
        ),
      );
      continue;
    }

    const answerKind = validateRequiredString(
      answerDraft,
      "kind",
      `${itemPath}.answerDraft`,
      issues,
    );
    if (answerKind !== question.kind) {
      issues.push(
        issue(
          "invalid_type",
          `${itemPath}.answerDraft.kind`,
          `Draft answer kind must match question kind \`${question.kind}\``,
          "Keep draft answer kind aligned with the current question kind.",
          question.kind,
          answerKind ?? "missing",
        ),
      );
    }

    validateRequiredString(item, "questionNote", itemPath, issues, { allowEmpty: true });
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
  const occurrences: TraversalOccurrence[] = [];
  const questionDefinitions = new Map<string, TraversalOccurrence[]>();

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
    for (let index = 0; index < root.questions.length; index++) {
      validateQuestionNode(
        root.questions[index],
        `$.questions[${index}]`,
        issues,
        occurrences,
        questionDefinitions,
        undefined,
        true,
      );
    }
  }

  appendConflictingQuestionDefinitionIssues(questionDefinitions, issues);
  appendDependencyReferenceIssues(occurrences, issues);

  validateDraftSnapshot(root.draftSnapshot, "$.draftSnapshot", issues, {
    questionsById: new Map(
      occurrences.map((occurrence) => [occurrence.question.questionId, occurrence.question]),
    ),
    seenDraftIds: new Set<string>(),
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    issues: [],
    request: root as unknown as AuthorizedQuestionRequest,
  };
}

export function isQuestionRuntimeDraftSnapshot(
  value: unknown,
): value is QuestionRuntimeQuestionDraft[] {
  return Array.isArray(value);
}
