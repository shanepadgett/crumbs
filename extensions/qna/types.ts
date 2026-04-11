import type {
  QuestionRuntimeStructuredSubmitResult,
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

export interface QnaOpenQuestionReference {
  questionId: string;
  questionText: string;
}

export type QnaToolInput =
  | { action: "question_batch"; questionIds: string[] }
  | { action: "complete"; reason?: string };

export type QnaLoopFinishReason =
  | "agent_complete"
  | "no_user_response"
  | "all_questions_resolved"
  | "session_reset";

export type QnaToolResultDetails =
  | {
      kind: "question_batch_submitted";
      submitResult: QuestionRuntimeStructuredSubmitResult;
      remainingOpenQuestionIds: string[];
      loopSettled: boolean;
    }
  | {
      kind: "question_batch_cancelled";
      remainingOpenQuestionIds: string[];
      loopSettled: false;
    }
  | {
      kind: "no_user_response_settled";
      remainingOpenQuestionIds: string[];
      loopSettled: true;
    }
  | {
      kind: "loop_completed";
      remainingOpenQuestionIds: string[];
      loopSettled: true;
    };
