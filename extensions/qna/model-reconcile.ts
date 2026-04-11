import { complete, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildQnaQuestionFingerprint } from "./reconcile.js";
import type { QnaReconcileModelResponse, QnaTranscriptMessage } from "./types.js";

const RECONCILIATION_SYSTEM_PROMPT = `You reconcile ordinary QnA ledger state against new chat transcript content.

Return JSON only. No markdown, no code fences, no prose.

Schema:
{
  "updates": [
    {
      "questionId": "string",
      "action": "answered_in_chat"
    },
    {
      "questionId": "string",
      "action": "replace",
      "replacementRef": "string"
    }
  ],
  "newQuestions": [
    {
      "ref": "string",
      "questionText": "string"
    }
  ]
}

Rules:
- updates may only reference the provided unresolved questionIds.
- Omit unchanged unresolved questions from updates.
- Use answered_in_chat when newer transcript content clearly answers an unresolved question.
- Use replace only when newer transcript content meaningfully replaces the old decision and a new question must be tracked.
- Every replace must point to one declared newQuestions ref.
- Put truly net-new questions in newQuestions.
- Keep question text concise and user-facing.
- If nothing changes, return {"updates":[],"newQuestions":[]}.`;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty model response");

  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("No JSON object found in model response");
}

export function normalizeModelResponse(
  value: unknown,
  unresolvedQuestions: Array<{ questionId: string; questionText: string }>,
): QnaReconcileModelResponse | null {
  if (!isObject(value)) return null;
  if (!Array.isArray(value.updates) || !Array.isArray(value.newQuestions)) return null;

  const allowedQuestionIds = new Set(unresolvedQuestions.map((question) => question.questionId));
  const seenUpdateIds = new Set<string>();
  const seenRefs = new Set<string>();
  const seenFingerprints = new Set<string>();

  const newQuestions: QnaReconcileModelResponse["newQuestions"] = [];
  for (const item of value.newQuestions) {
    if (!isObject(item)) return null;
    if (typeof item.ref !== "string" || !item.ref.trim()) return null;
    if (typeof item.questionText !== "string") return null;

    const ref = item.ref.trim();
    const questionText = item.questionText.trim();
    if (!questionText) return null;
    if (seenRefs.has(ref)) return null;

    const fingerprint = buildQnaQuestionFingerprint(questionText);
    if (!fingerprint || seenFingerprints.has(fingerprint)) return null;

    seenRefs.add(ref);
    seenFingerprints.add(fingerprint);
    newQuestions.push({ ref, questionText });
  }

  const updates: QnaReconcileModelResponse["updates"] = [];
  for (const item of value.updates) {
    if (!isObject(item)) return null;
    if (typeof item.questionId !== "string" || !item.questionId.trim()) return null;

    const questionId = item.questionId.trim();
    if (!allowedQuestionIds.has(questionId)) return null;
    if (seenUpdateIds.has(questionId)) return null;
    seenUpdateIds.add(questionId);

    if (item.action === "answered_in_chat") {
      updates.push({ questionId, action: "answered_in_chat" });
      continue;
    }

    if (item.action === "replace") {
      if (typeof item.replacementRef !== "string" || !item.replacementRef.trim()) return null;
      updates.push({
        questionId,
        action: "replace",
        replacementRef: item.replacementRef.trim(),
      });
      continue;
    }

    return null;
  }

  const declaredRefs = new Set(newQuestions.map((question) => question.ref));
  for (const update of updates) {
    if (update.action === "replace" && !declaredRefs.has(update.replacementRef)) return null;
  }

  return { updates, newQuestions };
}

function buildPromptText(input: {
  transcript: QnaTranscriptMessage[];
  unresolvedQuestions: Array<{ questionId: string; questionText: string }>;
}): string {
  return JSON.stringify(
    {
      transcript: input.transcript,
      unresolvedQuestions: input.unresolvedQuestions,
    },
    null,
    2,
  );
}

export async function reconcileQnaTranscript(
  input: {
    transcript: QnaTranscriptMessage[];
    unresolvedQuestions: Array<{ questionId: string; questionText: string }>;
  },
  ctx: ExtensionCommandContext,
  signal?: AbortSignal,
): Promise<QnaReconcileModelResponse | null> {
  if (!ctx.model) return null;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) return null;

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: buildPromptText(input) }],
    timestamp: Date.now(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await complete(
      ctx.model,
      {
        systemPrompt:
          attempt === 0
            ? RECONCILIATION_SYSTEM_PROMPT
            : `${RECONCILIATION_SYSTEM_PROMPT}\n\nPrevious output was invalid. Return valid JSON only, exactly matching schema.`,
        messages: [userMessage],
      },
      { apiKey: auth.apiKey, headers: auth.headers, signal },
    );

    if (response.stopReason === "aborted") return null;

    const text = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");

    try {
      const parsed = parseJsonObject(text);
      const normalized = normalizeModelResponse(parsed, input.unresolvedQuestions);
      if (normalized) return normalized;
    } catch {}
  }

  return null;
}
