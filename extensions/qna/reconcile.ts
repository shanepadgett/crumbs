import type {
  QnaBranchStateSnapshot,
  QnaLedgerQuestionRecord,
  QnaReconcileModelResponse,
} from "./types.js";

function cloneState(state: QnaBranchStateSnapshot): QnaBranchStateSnapshot {
  return structuredClone(state);
}

function bumpRevision(record: QnaLedgerQuestionRecord): QnaLedgerQuestionRecord["sendState"] {
  return {
    ...record.sendState,
    localRevision: record.sendState.localRevision + 1,
  };
}

function allocateQuestionId(sequence: number): string {
  return `qna_${String(sequence).padStart(4, "0")}`;
}

export function buildQnaQuestionFingerprint(questionText: string): string {
  return questionText
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function getUnresolvedQnaQuestions(
  state: QnaBranchStateSnapshot,
): Array<{ questionId: string; questionText: string }> {
  return state.questions
    .filter((question) => question.state === "open")
    .map((question) => ({ questionId: question.questionId, questionText: question.questionText }));
}

export interface ApplyQnaReconciliationResult {
  nextState: QnaBranchStateSnapshot;
  stats: {
    newQuestions: number;
    recoveryDedupedQuestions: number;
    closedAnsweredInChat: number;
    replacedQuestions: number;
  };
}

export function applyQnaReconciliation(input: {
  state: QnaBranchStateSnapshot;
  model: QnaReconcileModelResponse;
  dedupeNewQuestionsAgainstExisting: boolean;
}): ApplyQnaReconciliationResult {
  const nextState = cloneState(input.state);
  const openById = new Map(
    nextState.questions
      .filter((question) => question.state === "open")
      .map((question) => [question.questionId, question]),
  );
  const replacementRefs = new Set(
    input.model.updates
      .filter((update) => update.action === "replace")
      .map((update) => update.replacementRef),
  );
  const existingFingerprints = new Set(
    nextState.questions.map((question) => question.questionFingerprint),
  );
  const newQuestionIdsByRef = new Map<string, string>();

  let nextSequence = nextState.nextQuestionSequence;
  let createdQuestions = 0;
  let recoveryDedupedQuestions = 0;
  let closedAnsweredInChat = 0;
  let replacedQuestions = 0;

  for (const newQuestion of input.model.newQuestions) {
    const questionFingerprint = buildQnaQuestionFingerprint(newQuestion.questionText);
    const shouldDedupe =
      input.dedupeNewQuestionsAgainstExisting &&
      !replacementRefs.has(newQuestion.ref) &&
      existingFingerprints.has(questionFingerprint);

    if (shouldDedupe) {
      recoveryDedupedQuestions += 1;
      continue;
    }

    const questionId = allocateQuestionId(nextSequence);
    nextSequence += 1;
    createdQuestions += 1;
    existingFingerprints.add(questionFingerprint);
    newQuestionIdsByRef.set(newQuestion.ref, questionId);
    nextState.questions.push({
      questionId,
      questionText: newQuestion.questionText,
      questionFingerprint,
      state: "open",
      sendState: {
        localRevision: 1,
        lastSentRevision: 0,
      },
    });
  }

  for (const update of input.model.updates) {
    const existing = openById.get(update.questionId);
    if (!existing) continue;

    const index = nextState.questions.findIndex(
      (question) => question.questionId === update.questionId,
    );
    if (index < 0) continue;

    if (update.action === "answered_in_chat") {
      nextState.questions[index] = {
        ...existing,
        state: "answered_in_chat",
        sendState: bumpRevision(existing),
      };
      closedAnsweredInChat += 1;
      continue;
    }

    const supersededByQuestionId = newQuestionIdsByRef.get(update.replacementRef);
    if (!supersededByQuestionId) {
      throw new Error(`Missing replacement question for ref ${update.replacementRef}`);
    }

    nextState.questions[index] = {
      ...existing,
      state: "superseded",
      supersededByQuestionId,
      sendState: bumpRevision(existing),
    };
    replacedQuestions += 1;
  }

  nextState.nextQuestionSequence = nextSequence;

  return {
    nextState,
    stats: {
      newQuestions: createdQuestions,
      recoveryDedupedQuestions,
      closedAnsweredInChat,
      replacedQuestions,
    },
  };
}
