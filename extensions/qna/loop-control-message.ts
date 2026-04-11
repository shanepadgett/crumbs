export const QNA_LOOP_CONTROL_CUSTOM_TYPE = "qna.loop.control";

export interface QnaLoopKickoffDetails {
  type: "kickoff";
  loopId: string;
  openQuestionIds: string[];
  discoverySummary?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseQnaLoopKickoffDetails(value: unknown): QnaLoopKickoffDetails | null {
  if (!isObject(value)) return null;
  if (value.type !== "kickoff") return null;
  if (!isNonEmptyString(value.loopId)) return null;
  if (!Array.isArray(value.openQuestionIds)) return null;

  const openQuestionIds = value.openQuestionIds.filter(isNonEmptyString);
  if (openQuestionIds.length !== value.openQuestionIds.length) return null;

  if (value.discoverySummary !== undefined && !isNonEmptyString(value.discoverySummary)) {
    return null;
  }

  return {
    type: "kickoff",
    loopId: value.loopId,
    openQuestionIds,
    discoverySummary: value.discoverySummary,
  };
}

export function buildQnaLoopKickoffMessage(details: QnaLoopKickoffDetails) {
  return {
    customType: QNA_LOOP_CONTROL_CUSTOM_TYPE,
    content: "qna loop kickoff",
    display: false as const,
    details,
  };
}

export function isQnaLoopKickoffMessage(message: {
  role?: unknown;
  customType?: unknown;
  details?: unknown;
}): boolean {
  if (message.role !== "custom") return false;
  if (message.customType !== QNA_LOOP_CONTROL_CUSTOM_TYPE) return false;
  return parseQnaLoopKickoffDetails(message.details) !== null;
}
