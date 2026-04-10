export type QuestionKind = "yes_no" | "multiple_choice" | "freeform";

export const RESERVED_OPTION_IDS = ["yes", "no", "other"] as const;
export type ReservedOptionId = (typeof RESERVED_OPTION_IDS)[number];
export type YesNoOptionId = Extract<ReservedOptionId, "yes" | "no">;
export type QuestionClosureState = "open" | "skipped" | "needs_clarification";
export type QuestionResponseState = "answered" | "needs_clarification" | "skipped" | "open";

export interface AuthorizedQuestionRequest {
  questions: AuthorizedQuestionNode[];
  draftSnapshot?: QuestionRuntimeQuestionDraft[];
}

export interface AuthorizedQuestionBase {
  questionId: string;
  prompt: string;
  context?: string;
  justification: string;
  dependsOnQuestionIds?: string[];
  followUps?: AuthorizedQuestionNode[];
}

export interface AuthorizedQuestionOccurrenceMetadata {
  anyOfSelectedOptionIds?: string[];
  allOfSelectedOptionIds?: string[];
}

export interface AuthorizedYesNoQuestion extends AuthorizedQuestionBase {
  kind: "yes_no";
  recommendedOptionId: YesNoOptionId;
}

export interface AuthorizedFreeformQuestion extends AuthorizedQuestionBase {
  kind: "freeform";
  suggestedAnswer: string;
}

export interface AuthorizedMultipleChoiceOption {
  optionId: string;
  label: string;
  description?: string;
}

export interface AuthorizedMultipleChoiceQuestion extends AuthorizedQuestionBase {
  kind: "multiple_choice";
  selectionMode: "single" | "multi";
  options: AuthorizedMultipleChoiceOption[];
  recommendedOptionIds: string[];
}

export type AuthorizedQuestionNode =
  | (AuthorizedYesNoQuestion & AuthorizedQuestionOccurrenceMetadata)
  | (AuthorizedFreeformQuestion & AuthorizedQuestionOccurrenceMetadata)
  | (AuthorizedMultipleChoiceQuestion & AuthorizedQuestionOccurrenceMetadata);

export type ValidationIssueCode =
  | "json_parse"
  | "expected_object"
  | "forbidden_field"
  | "missing_required"
  | "invalid_type"
  | "invalid_enum"
  | "empty_string"
  | "empty_array"
  | "duplicate_question_id"
  | "duplicate_option_id"
  | "duplicate_array_value"
  | "reserved_identifier"
  | "invalid_reference"
  | "authoring_guidance"
  | "conflicting_question_definition"
  | "invalid_activation";

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: string;
  message: string;
  expected?: string;
  actual?: string;
  hint: string;
}

export type RequestValidationResult =
  | {
      ok: true;
      issues: [];
      request: AuthorizedQuestionRequest;
    }
  | {
      ok: false;
      issues: ValidationIssue[];
      request?: undefined;
    };

export interface YesNoAnswerDraft {
  kind: "yes_no";
  selectedOptionId: YesNoOptionId | null;
  note: string;
}

export interface MultipleChoiceAnswerDraft {
  kind: "multiple_choice";
  selectedOptionIds: string[];
  otherText: string;
  optionNoteDrafts: Record<string, string>;
}

export interface FreeformAnswerDraft {
  kind: "freeform";
  text: string;
  note: string;
}

export type QuestionAnswerDraft =
  | YesNoAnswerDraft
  | MultipleChoiceAnswerDraft
  | FreeformAnswerDraft;

export interface QuestionRuntimeQuestionDraft {
  questionId: string;
  closureState: QuestionClosureState;
  answerDraft: QuestionAnswerDraft;
  questionNote: string;
}

export type QuestionRuntimeQuestionOutcome =
  | { questionId: string; state: "open" }
  | { questionId: string; state: "skipped"; note?: string }
  | { questionId: string; state: "needs_clarification"; note: string }
  | {
      questionId: string;
      state: "answered";
      answer:
        | { kind: "yes_no"; optionId: YesNoOptionId; note?: string }
        | {
            kind: "multiple_choice";
            selections: Array<{ optionId: string; note?: string }>;
            otherText?: string;
          }
        | { kind: "freeform"; text: string; note?: string };
    };

export type SubmittedQuestionRuntimeQuestionOutcome = Exclude<
  QuestionRuntimeQuestionOutcome,
  { state: "open" }
>;

export type QuestionRuntimeStructuredSubmitResult =
  | {
      kind: "question_outcomes";
      requiresClarification: boolean;
      outcomes: SubmittedQuestionRuntimeQuestionOutcome[];
    }
  | {
      kind: "no_user_response";
      requiresClarification: false;
      outcomes: [];
    };

export type QuestionRuntimeFormResult =
  | {
      action: "cancel";
      draftSnapshot: QuestionRuntimeQuestionDraft[];
    }
  | {
      action: "submit";
      draftSnapshot: QuestionRuntimeQuestionDraft[];
      submitResult: QuestionRuntimeStructuredSubmitResult;
    };

export const QUESTION_RUNTIME_STATE_ENTRY = "question-runtime.state";

export type RuntimeRequestStatus = "pending" | "ready" | "locked" | "aborted";

export interface RuntimeRequestRecord {
  requestId: string;
  path: string;
  projectRelativePath: string;
  status: RuntimeRequestStatus;
  failureCount: number;
  extraRetryBlocksGranted: number;
  pendingRetryDecision: boolean;
  lastProcessedContentHash?: string;
}

export interface QuestionRuntimeStateSnapshot {
  requests: RuntimeRequestRecord[];
}
