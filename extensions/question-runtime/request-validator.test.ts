import { describe, expect, test } from "bun:test";
import { validateAuthorizedQuestionRequest } from "./request-validator.js";

describe("validateAuthorizedQuestionRequest", () => {
  test("rejects activation arrays on roots", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "root",
            kind: "yes_no",
            prompt: "Root?",
            justification: "Need root.",
            recommendedOptionId: "yes",
            anyOfSelectedOptionIds: ["yes"],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "invalid_activation")).toBe(true);
  });

  test("rejects followUps under freeform", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "free",
            kind: "freeform",
            prompt: "Explain",
            justification: "Need details.",
            suggestedAnswer: "Details",
            followUps: [
              {
                questionId: "child",
                kind: "yes_no",
                prompt: "Child?",
                justification: "Need child.",
                recommendedOptionId: "yes",
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith(".followUps"))).toBe(true);
  });

  test("accepts matching repeated question ids", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "root-a",
            kind: "yes_no",
            prompt: "A?",
            justification: "Need A.",
            recommendedOptionId: "yes",
            followUps: [
              {
                questionId: "shared",
                kind: "freeform",
                prompt: "Shared",
                justification: "Need shared.",
                suggestedAnswer: "Text",
              },
            ],
          },
          {
            questionId: "root-b",
            kind: "yes_no",
            prompt: "B?",
            justification: "Need B.",
            recommendedOptionId: "yes",
            followUps: [
              {
                questionId: "shared",
                kind: "freeform",
                prompt: "Shared",
                justification: "Need shared.",
                suggestedAnswer: "Text",
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });

  test("rejects conflicting repeated question ids", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "root-a",
            kind: "yes_no",
            prompt: "A?",
            justification: "Need A.",
            recommendedOptionId: "yes",
            followUps: [
              {
                questionId: "shared",
                kind: "freeform",
                prompt: "Shared",
                justification: "Need shared.",
                suggestedAnswer: "Text",
              },
            ],
          },
          {
            questionId: "root-b",
            kind: "yes_no",
            prompt: "B?",
            justification: "Need B.",
            recommendedOptionId: "yes",
            followUps: [
              {
                questionId: "shared",
                kind: "freeform",
                prompt: "Shared changed",
                justification: "Need shared.",
                suggestedAnswer: "Text",
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "conflicting_question_definition")).toBe(
      true,
    );
  });

  test("rejects invalid dependencies and draft mismatch", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "q1",
            kind: "yes_no",
            prompt: "Q1?",
            justification: "Need q1.",
            recommendedOptionId: "yes",
            dependsOnQuestionIds: ["missing", "q1"],
          },
        ],
        draftSnapshot: [
          {
            questionId: "q1",
            closureState: "open",
            questionNote: "",
            answerDraft: { kind: "freeform", text: "x", note: "" },
          },
          {
            questionId: "q1",
            closureState: "open",
            questionNote: "",
            answerDraft: { kind: "yes_no", selectedOptionId: "yes", note: "" },
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.includes("dependsOnQuestionIds"))).toBe(true);
    expect(
      result.issues.some(
        (issue) => issue.path.includes("draftSnapshot") && issue.path.endsWith("questionId"),
      ),
    ).toBe(true);
    expect(result.issues.some((issue) => issue.path.includes("answerDraft.kind"))).toBe(true);
  });

  test("rejects invalid activation option ids but allows stale draft selections", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "parent",
            kind: "multiple_choice",
            prompt: "Pick",
            justification: "Need pick.",
            selectionMode: "multi",
            options: [{ optionId: "a", label: "A" }],
            recommendedOptionIds: ["a"],
            followUps: [
              {
                questionId: "child",
                kind: "freeform",
                prompt: "Why",
                justification: "Need why.",
                suggestedAnswer: "Because",
                anyOfSelectedOptionIds: ["missing"],
              },
            ],
          },
        ],
        draftSnapshot: [
          {
            questionId: "parent",
            closureState: "open",
            questionNote: "",
            answerDraft: {
              kind: "multiple_choice",
              selectedOptionIds: ["missing"],
              otherText: "",
              optionNoteDrafts: { missing: "old" },
            },
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path.endsWith("anyOfSelectedOptionIds[0]"))).toBe(
      true,
    );
    expect(
      result.issues.some(
        (issue) => issue.path.includes("draftSnapshot") && issue.path.includes("selectedOptionIds"),
      ),
    ).toBe(false);
  });

  test("accepts draft snapshots with empty question notes", () => {
    const result = validateAuthorizedQuestionRequest(
      JSON.stringify({
        questions: [
          {
            questionId: "q1",
            kind: "freeform",
            prompt: "Q1",
            justification: "Need q1.",
            suggestedAnswer: "Text",
          },
        ],
        draftSnapshot: [
          {
            questionId: "q1",
            closureState: "open",
            questionNote: "",
            answerDraft: { kind: "freeform", text: "", note: "" },
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
  });
});
