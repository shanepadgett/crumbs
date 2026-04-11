import { describe, expect, test } from "bun:test";
import { normalizeModelResponse, parseJsonObject } from "./model-reconcile.js";

const unresolvedQuestions = [{ questionId: "qna_0001", questionText: "Ship it?" }];

describe("reconcileQnaTranscript normalization", () => {
  test("rejects unknown update ids", () => {
    expect(
      normalizeModelResponse(
        {
          updates: [{ questionId: "qna_9999", action: "answered_in_chat" }],
          newQuestions: [],
        },
        unresolvedQuestions,
      ),
    ).toBeNull();
  });

  test("rejects duplicate update ids and duplicate refs", () => {
    expect(
      normalizeModelResponse(
        {
          updates: [
            { questionId: "qna_0001", action: "answered_in_chat" },
            { questionId: "qna_0001", action: "answered_in_chat" },
          ],
          newQuestions: [],
        },
        unresolvedQuestions,
      ),
    ).toBeNull();

    expect(
      normalizeModelResponse(
        {
          updates: [],
          newQuestions: [
            { ref: "n1", questionText: "One?" },
            { ref: "n1", questionText: "Two?" },
          ],
        },
        unresolvedQuestions,
      ),
    ).toBeNull();
  });

  test("rejects replace without valid replacementRef", () => {
    expect(
      normalizeModelResponse(
        {
          updates: [{ questionId: "qna_0001", action: "replace", replacementRef: "n1" }],
          newQuestions: [],
        },
        unresolvedQuestions,
      ),
    ).toBeNull();
  });

  test("allows unchanged questions to be omitted", () => {
    expect(normalizeModelResponse({ updates: [], newQuestions: [] }, unresolvedQuestions)).toEqual({
      updates: [],
      newQuestions: [],
    });
  });

  test("parses direct json and fenced-object fallback", () => {
    expect(parseJsonObject('{"updates":[],"newQuestions":[]}')).toEqual({
      updates: [],
      newQuestions: [],
    });
    expect(parseJsonObject('```json\n{"updates":[],"newQuestions":[]}\n```')).toEqual({
      updates: [],
      newQuestions: [],
    });
  });
});
