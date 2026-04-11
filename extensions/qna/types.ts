import type {
  QuestionRuntimeQuestionDraft,
  SubmittedQuestionRuntimeQuestionOutcome,
} from "../question-runtime/types.js";

export const QNA_STATE_ENTRY = "qna.state";

export interface QnaLedgerSendState {
  localRevision: number;
  lastSentRevision: number;
  lastSentAt?: string;
}

interface QnaLedgerQuestionRecordBase {
  questionId: string;
  questionText: string;
  questionFingerprint: string;
  sendState: QnaLedgerSendState;
}

export type QnaLedgerQuestionRecord =
  | (QnaLedgerQuestionRecordBase & { state: "open" })
  | (QnaLedgerQuestionRecordBase & {
      state: "answered";
      submittedOutcome: Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "answered" }>;
    })
  | (QnaLedgerQuestionRecordBase & {
      state: "skipped";
      submittedOutcome: Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "skipped" }>;
    })
  | (QnaLedgerQuestionRecordBase & {
      state: "needs_clarification";
      submittedOutcome: Extract<
        SubmittedQuestionRuntimeQuestionOutcome,
        { state: "needs_clarification" }
      >;
    })
  | (QnaLedgerQuestionRecordBase & { state: "answered_in_chat" })
  | (QnaLedgerQuestionRecordBase & {
      state: "superseded";
      supersededByQuestionId: string;
    });

export interface QnaBranchStateSnapshot {
  schemaVersion: 1;
  durableBoundaryEntryId?: string;
  nextQuestionSequence: number;
  questions: QnaLedgerQuestionRecord[];
  runtimeDraftsByQuestionId: Record<string, QuestionRuntimeQuestionDraft>;
}

export interface QnaTranscriptMessage {
  entryId: string;
  role: "user" | "assistant";
  text: string;
}

export interface QnaTranscriptScanResult {
  messages: QnaTranscriptMessage[];
  latestBranchEntryId?: string;
  boundaryMatched: boolean;
}

export type QnaReconcileUpdate =
  | {
      questionId: string;
      action: "answered_in_chat";
    }
  | {
      questionId: string;
      action: "replace";
      replacementRef: string;
    };

export interface QnaReconcileNewQuestion {
  ref: string;
  questionText: string;
}

export interface QnaReconcileModelResponse {
  updates: QnaReconcileUpdate[];
  newQuestions: QnaReconcileNewQuestion[];
}
