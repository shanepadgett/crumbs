import type { ExtensionAPI, SessionEntry } from "@mariozechner/pi-coding-agent";
import { QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE } from "../question-runtime/repair-messages.js";
import type {
  QuestionRuntimeQuestionDraft,
  SubmittedQuestionRuntimeQuestionOutcome,
} from "../question-runtime/types.js";
import {
  QNA_STATE_ENTRY,
  type QnaBranchStateSnapshot,
  type QnaLedgerQuestionRecord,
  type QnaLedgerSendState,
} from "./types.js";

type AnsweredOutcome = Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "answered" }>;
type SkippedOutcome = Extract<SubmittedQuestionRuntimeQuestionOutcome, { state: "skipped" }>;
type NeedsClarificationOutcome = Extract<
  SubmittedQuestionRuntimeQuestionOutcome,
  { state: "needs_clarification" }
>;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneSendState(sendState: QnaLedgerSendState): QnaLedgerSendState {
  return {
    localRevision: sendState.localRevision,
    lastSentRevision: sendState.lastSentRevision,
    lastSentAt: sendState.lastSentAt,
  };
}

function cloneRecord(record: QnaLedgerQuestionRecord): QnaLedgerQuestionRecord {
  const base = {
    questionId: record.questionId,
    questionText: record.questionText,
    questionFingerprint: record.questionFingerprint,
    sendState: cloneSendState(record.sendState),
  };

  switch (record.state) {
    case "open":
    case "answered_in_chat":
      return { ...base, state: record.state };
    case "superseded":
      return {
        ...base,
        state: "superseded",
        supersededByQuestionId: record.supersededByQuestionId,
      };
    case "answered":
      return {
        ...base,
        state: "answered",
        submittedOutcome: cloneValue(record.submittedOutcome),
      };
    case "skipped":
      return {
        ...base,
        state: "skipped",
        submittedOutcome: cloneValue(record.submittedOutcome),
      };
    case "needs_clarification":
      return {
        ...base,
        state: "needs_clarification",
        submittedOutcome: cloneValue(record.submittedOutcome),
      };
  }
}

function cloneSnapshot(snapshot: QnaBranchStateSnapshot): QnaBranchStateSnapshot {
  return {
    schemaVersion: 1,
    durableBoundaryEntryId: snapshot.durableBoundaryEntryId,
    nextQuestionSequence: snapshot.nextQuestionSequence,
    questions: snapshot.questions.map(cloneRecord),
    runtimeDraftsByQuestionId: cloneValue(snapshot.runtimeDraftsByQuestionId),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

function parseSendState(value: unknown): QnaLedgerSendState | null {
  if (!isObject(value)) return null;
  const localRevision = parseNonNegativeInteger(value.localRevision);
  const lastSentRevision = parseNonNegativeInteger(value.lastSentRevision);
  if (localRevision === null || lastSentRevision === null) return null;

  const lastSentAt = isNonEmptyString(value.lastSentAt) ? value.lastSentAt : undefined;
  return { localRevision, lastSentRevision, lastSentAt };
}

function parseSubmittedOutcome(
  value: unknown,
  expectedState: "answered" | "skipped" | "needs_clarification",
  expectedQuestionId: string,
): SubmittedQuestionRuntimeQuestionOutcome | null {
  if (!isObject(value)) return null;
  if (value.state !== expectedState) return null;
  if (value.questionId !== expectedQuestionId) return null;

  if (expectedState === "answered") {
    if (!isObject(value.answer) || !isNonEmptyString(value.answer.kind)) return null;
  }

  if (expectedState === "needs_clarification" && !isNonEmptyString(value.note)) return null;
  if (expectedState === "skipped" && value.note !== undefined && typeof value.note !== "string") {
    return null;
  }

  return cloneValue(value as SubmittedQuestionRuntimeQuestionOutcome);
}

function parseRecord(value: unknown): QnaLedgerQuestionRecord | null {
  if (!isObject(value)) return null;
  if (!isNonEmptyString(value.questionId)) return null;
  if (!isNonEmptyString(value.questionText)) return null;
  if (!isNonEmptyString(value.questionFingerprint)) return null;

  const sendState = parseSendState(value.sendState);
  if (!sendState) return null;

  const base = {
    questionId: value.questionId,
    questionText: value.questionText,
    questionFingerprint: value.questionFingerprint,
    sendState,
  };

  if (value.state === "open" || value.state === "answered_in_chat") {
    return { ...base, state: value.state };
  }

  if (value.state === "superseded") {
    if (!isNonEmptyString(value.supersededByQuestionId)) return null;
    return {
      ...base,
      state: "superseded",
      supersededByQuestionId: value.supersededByQuestionId,
    };
  }

  if (
    value.state === "answered" ||
    value.state === "skipped" ||
    value.state === "needs_clarification"
  ) {
    const submittedOutcome = parseSubmittedOutcome(
      value.submittedOutcome,
      value.state,
      value.questionId,
    );
    if (!submittedOutcome) return null;
    if (value.state === "answered") {
      return {
        ...base,
        state: "answered",
        submittedOutcome: submittedOutcome as AnsweredOutcome,
      };
    }
    if (value.state === "skipped") {
      return {
        ...base,
        state: "skipped",
        submittedOutcome: submittedOutcome as SkippedOutcome,
      };
    }
    return {
      ...base,
      state: "needs_clarification",
      submittedOutcome: submittedOutcome as NeedsClarificationOutcome,
    };
  }

  return null;
}

function parseDraft(value: unknown, questionId: string): QuestionRuntimeQuestionDraft | null {
  if (!isObject(value)) return null;
  if (value.questionId !== questionId) return null;
  if (
    value.closureState !== "open" &&
    value.closureState !== "skipped" &&
    value.closureState !== "needs_clarification"
  ) {
    return null;
  }
  if (!isObject(value.answerDraft) || typeof value.questionNote !== "string") return null;
  if (!isNonEmptyString((value.answerDraft as { kind?: unknown }).kind)) return null;
  return cloneValue(value as unknown as QuestionRuntimeQuestionDraft);
}

function parseRuntimeDrafts(value: unknown): Record<string, QuestionRuntimeQuestionDraft> | null {
  if (!isObject(value)) return null;
  const drafts: Record<string, QuestionRuntimeQuestionDraft> = {};
  for (const [questionId, draft] of Object.entries(value)) {
    if (!isNonEmptyString(questionId)) continue;
    const parsed = parseDraft(draft, questionId);
    if (parsed) drafts[questionId] = parsed;
  }
  return drafts;
}

function parseRuntimeDraftSnapshot(
  value: unknown,
): Record<string, QuestionRuntimeQuestionDraft> | null {
  if (!Array.isArray(value)) return null;

  const drafts: Record<string, QuestionRuntimeQuestionDraft> = {};
  for (const item of value) {
    if (!isObject(item) || !isNonEmptyString(item.questionId)) continue;
    const parsed = parseDraft(item, item.questionId);
    if (parsed) drafts[item.questionId] = parsed;
  }

  return drafts;
}

function parseRuntimeDraftUpdateEntry(
  entry: SessionEntry,
): Record<string, QuestionRuntimeQuestionDraft> | null {
  if (entry.type !== "custom_message") return null;
  if (entry.customType !== QUESTION_RUNTIME_CONTROL_CUSTOM_TYPE) return null;
  if (!isObject(entry.details)) return null;
  if (entry.details.type !== "form_submitted" && entry.details.type !== "form_cancelled") {
    return null;
  }

  return parseRuntimeDraftSnapshot(entry.details.draftSnapshot);
}

function sameDraft(
  left: QuestionRuntimeQuestionDraft | undefined,
  right: QuestionRuntimeQuestionDraft,
): boolean {
  if (!left) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyRuntimeDraftUpdates(
  snapshot: QnaBranchStateSnapshot,
  entries: SessionEntry[],
  startIndex: number,
): boolean {
  let changed = false;

  for (let index = Math.max(0, startIndex); index < entries.length; index += 1) {
    const drafts = parseRuntimeDraftUpdateEntry(entries[index]!);
    if (!drafts) continue;

    for (const [questionId, draft] of Object.entries(drafts)) {
      if (sameDraft(snapshot.runtimeDraftsByQuestionId[questionId], draft)) continue;
      snapshot.runtimeDraftsByQuestionId[questionId] = cloneValue(draft);
      changed = true;
    }
  }

  return changed;
}

function parseSnapshot(value: unknown): QnaBranchStateSnapshot | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== 1) return null;
  const nextQuestionSequence = parseNonNegativeInteger(value.nextQuestionSequence);
  if (nextQuestionSequence === null) return null;
  if (!Array.isArray(value.questions)) return null;

  const questions: QnaLedgerQuestionRecord[] = [];
  for (const item of value.questions) {
    const record = parseRecord(item);
    if (!record) return null;
    questions.push(record);
  }

  const runtimeDraftsByQuestionId = parseRuntimeDrafts(value.runtimeDraftsByQuestionId);
  if (!runtimeDraftsByQuestionId) return null;

  const durableBoundaryEntryId = isNonEmptyString(value.durableBoundaryEntryId)
    ? value.durableBoundaryEntryId
    : undefined;

  return {
    schemaVersion: 1,
    durableBoundaryEntryId,
    nextQuestionSequence,
    questions,
    runtimeDraftsByQuestionId,
  };
}

export function createEmptyQnaBranchState(): QnaBranchStateSnapshot {
  return {
    schemaVersion: 1,
    durableBoundaryEntryId: undefined,
    nextQuestionSequence: 1,
    questions: [],
    runtimeDraftsByQuestionId: {},
  };
}

export class QnaBranchStateStore {
  private snapshot = createEmptyQnaBranchState();
  private hasHydratedDraftChanges = false;

  constructor(private readonly pi: ExtensionAPI) {}

  hydrateFromBranch(entries: SessionEntry[]): void {
    let latest: QnaBranchStateSnapshot | null = null;
    let latestIndex = -1;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]!;
      if (entry.type !== "custom" || entry.customType !== QNA_STATE_ENTRY) continue;
      const parsed = parseSnapshot(entry.data);
      if (!parsed) continue;
      latest = parsed;
      latestIndex = index;
    }

    this.snapshot = latest ? cloneSnapshot(latest) : createEmptyQnaBranchState();
    this.hasHydratedDraftChanges = applyRuntimeDraftUpdates(
      this.snapshot,
      entries,
      latestIndex + 1,
    );
  }

  getSnapshot(): QnaBranchStateSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  needsPersistedHydration(): boolean {
    return this.hasHydratedDraftChanges;
  }

  replaceSnapshot(snapshot: QnaBranchStateSnapshot): void {
    const parsed = parseSnapshot(snapshot);
    this.snapshot = parsed ? cloneSnapshot(parsed) : createEmptyQnaBranchState();
    this.hasHydratedDraftChanges = false;
    this.pi.appendEntry(QNA_STATE_ENTRY, this.getSnapshot());
  }
}
