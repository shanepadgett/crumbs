import type { Question, QuestionRecommendation } from "./types.js";

const MAX_QUESTIONS = 8;
const MAX_OPTIONS = 8;
const MAX_REASON_LENGTH = 240;

type RawQuestion = {
  id: string;
  label?: string;
  prompt: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  allowOther?: boolean;
  recommendation?: QuestionRecommendation;
};

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

function normalizeQuestions(input: unknown): Question[] {
  const payload =
    typeof input === "object" && input !== null
      ? (input as { questions?: unknown }).questions
      : undefined;
  if (!Array.isArray(payload)) throw new Error("Extractor returned invalid questionnaire payload");
  if (payload.length > MAX_QUESTIONS)
    throw new Error(`Extractor returned too many questions (${payload.length})`);

  const seen = new Set<string>();
  return payload.map((item, index) => {
    if (typeof item !== "object" || item === null) throw new Error(`Question ${index + 1} invalid`);
    const raw = item as RawQuestion;
    if (typeof raw.id !== "string" || !raw.id.trim())
      throw new Error(`Question ${index + 1} missing id`);
    if (seen.has(raw.id)) throw new Error(`Duplicate question id '${raw.id}'`);
    seen.add(raw.id);
    if (typeof raw.prompt !== "string" || !raw.prompt.trim())
      throw new Error(`Question '${raw.id}' missing prompt`);

    const options = Array.isArray(raw.options) ? raw.options : [];
    if (options.length > MAX_OPTIONS)
      throw new Error(`Question '${raw.id}' has too many options (${options.length})`);

    const normalizedOptions = options.map((option, optionIndex) => {
      if (typeof option !== "object" || option === null) {
        throw new Error(`Question '${raw.id}' option ${optionIndex + 1} invalid`);
      }
      if (typeof option.value !== "string" || !option.value.trim()) {
        throw new Error(`Question '${raw.id}' option ${optionIndex + 1} missing value`);
      }
      if (typeof option.label !== "string" || !option.label.trim()) {
        throw new Error(`Question '${raw.id}' option ${optionIndex + 1} missing label`);
      }
      return {
        value: option.value,
        label: option.label,
        description:
          typeof option.description === "string" && option.description.trim()
            ? option.description.trim()
            : undefined,
      };
    });

    const allowOther = raw.allowOther !== false;
    if (normalizedOptions.length === 0 && !allowOther) {
      throw new Error(`Question '${raw.id}' has no options and custom input disabled`);
    }

    const recommendation = normalizeRecommendation(raw.recommendation);

    return {
      id: raw.id,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : `Q${index + 1}`,
      prompt: raw.prompt.trim(),
      options: normalizedOptions,
      allowOther,
      recommendation,
    };
  });
}

function normalizeRecommendation(input: unknown): QuestionRecommendation | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const candidate = input as QuestionRecommendation;
  if (typeof candidate.reason !== "string" || !candidate.reason.trim()) return undefined;
  return {
    value:
      typeof candidate.value === "string" && candidate.value.trim()
        ? candidate.value.trim()
        : undefined,
    label:
      typeof candidate.label === "string" && candidate.label.trim()
        ? candidate.label.trim()
        : undefined,
    reason: candidate.reason.trim().slice(0, MAX_REASON_LENGTH),
  };
}

export const extractQuestionnaire = {
  systemPrompt: `You extract structured user-decision questionnaires.

Rules:
- Use FULL_CHAT_CONTEXT only for context and recommendation rationale.
- Questions must come from LAST_ASSISTANT_MESSAGE only.
- Do not invent questions from older turns.
- Return strict JSON only. No markdown. No explanation.
- Output object shape: {"questions":[...]}
- Each question object has:
  - id: short stable slug
  - label: short tab label
  - prompt: full question text for user
  - options: array of { value, label, description? }
  - allowOther: boolean
  - recommendation?: { value?, label?, reason }
- Recommendation is optional. Use short practical reason only.
- Prefer 2-6 concrete options when assistant clearly presents choices or decision paths.
- If assistant asks open question without clear options, you may use empty options only when allowOther is true.
- If no user decision or answer is needed from LAST_ASSISTANT_MESSAGE, return {"questions":[]}.`,
  parse(text: string): { questions: Question[] } {
    const json = stripCodeFence(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("Extractor returned invalid JSON");
    }
    return { questions: normalizeQuestions(parsed) };
  },
};
