import { describe, expect, test } from "bun:test";
import {
  buildQuestionRuntimeFormResult,
  buildStructuredSubmitResult,
  createQuestionRuntimeFormState,
  getQuestionDraft,
  getQuestionResponseState,
  setFreeformText,
  setMultipleChoiceOtherText,
  setQuestionNote,
  setYesNoSelection,
  toggleMultipleChoiceOption,
} from "./form-state.js";
import { buildActiveQuestionView, normalizeQuestionGraph } from "./question-graph.js";
import { validateAuthorizedQuestionRequest } from "./request-validator.js";
import type { AuthorizedQuestionRequest } from "./types.js";

function getActive(request: AuthorizedQuestionRequest, draftSnapshot = request.draftSnapshot) {
  const graph = normalizeQuestionGraph(request);
  const state = createQuestionRuntimeFormState(graph, draftSnapshot);
  const activeView = buildActiveQuestionView(graph, (questionId) => {
    const question = graph.questionsById[questionId]!.question;
    const draft = getQuestionDraft(state, questionId);
    return { draft, responseState: getQuestionResponseState(question, draft) };
  });
  return { graph, state, activeView };
}

describe("question runtime engine", () => {
  test("orders dependencies before dependents even when authored later", () => {
    const request: AuthorizedQuestionRequest = {
      questions: [
        {
          questionId: "dependent",
          kind: "freeform",
          prompt: "Dependent",
          justification: "Need dependent.",
          suggestedAnswer: "Explain",
          dependsOnQuestionIds: ["root"],
        },
        {
          questionId: "root",
          kind: "freeform",
          prompt: "Root",
          justification: "Need root.",
          suggestedAnswer: "Explain",
        },
      ],
    };

    const { graph, state } = getActive(request);

    let active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["root"]);

    setFreeformText(state, "root", "done");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["root", "dependent"]);
  });

  test("dedupes shared follow-ups, applies activation and dependency ordering", () => {
    const request: AuthorizedQuestionRequest = {
      questions: [
        {
          questionId: "rootA",
          kind: "yes_no",
          prompt: "Root A?",
          justification: "Need A.",
          recommendedOptionId: "yes",
          followUps: [
            {
              questionId: "shared",
              kind: "multiple_choice",
              prompt: "Shared",
              justification: "Need shared.",
              selectionMode: "multi",
              options: [{ optionId: "x", label: "X" }],
              recommendedOptionIds: ["x"],
            },
          ],
        },
        {
          questionId: "rootB",
          kind: "multiple_choice",
          prompt: "Root B",
          justification: "Need B.",
          selectionMode: "multi",
          options: [{ optionId: "go", label: "Go" }],
          recommendedOptionIds: ["go"],
          followUps: [
            {
              questionId: "shared",
              kind: "multiple_choice",
              prompt: "Shared",
              justification: "Need shared.",
              selectionMode: "multi",
              options: [{ optionId: "x", label: "X" }],
              recommendedOptionIds: ["x"],
              anyOfSelectedOptionIds: ["go"],
            },
          ],
        },
        {
          questionId: "dependent",
          kind: "freeform",
          prompt: "Dependent",
          justification: "Need dependent.",
          suggestedAnswer: "Explain",
          dependsOnQuestionIds: ["shared"],
        },
      ],
    };

    const { graph, state } = getActive(request);
    let active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["rootA", "rootB"]);

    setYesNoSelection(state, "rootA", "yes");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["rootA", "shared", "rootB"]);
    expect(
      active.entries.find((entry) => entry.questionId === "shared")?.visibilityReasons,
    ).toHaveLength(1);

    toggleMultipleChoiceOption(state, "rootB", "go", "multi");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(
      active.entries.find((entry) => entry.questionId === "shared")?.visibilityReasons,
    ).toHaveLength(2);
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["rootA", "shared", "rootB"]);

    toggleMultipleChoiceOption(state, "shared", "x", "multi");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual([
      "rootA",
      "shared",
      "rootB",
      "dependent",
    ]);
  });

  test("restores filtered drafts, preserves hidden branch drafts, and omits open items from submit", () => {
    const request: AuthorizedQuestionRequest = {
      questions: [
        {
          questionId: "toggle",
          kind: "yes_no",
          prompt: "Toggle?",
          justification: "Need toggle.",
          recommendedOptionId: "yes",
          followUps: [
            {
              questionId: "branch",
              kind: "multiple_choice",
              prompt: "Branch",
              justification: "Need branch.",
              selectionMode: "multi",
              options: [{ optionId: "kept", label: "Kept" }],
              recommendedOptionIds: ["kept"],
            },
          ],
        },
        {
          questionId: "openQuestion",
          kind: "freeform",
          prompt: "Open",
          justification: "Need open.",
          suggestedAnswer: "Text",
        },
      ],
      draftSnapshot: [
        {
          questionId: "branch",
          closureState: "open",
          questionNote: "",
          answerDraft: {
            kind: "multiple_choice",
            selectedOptionIds: ["kept", "removed", "other"],
            otherText: "old other",
            optionNoteDrafts: { kept: "keep", removed: "drop" },
          },
        },
      ],
    };

    const { graph, state } = getActive(request);
    const branchDraft = getQuestionDraft(state, "branch");
    expect(branchDraft.answerDraft.kind).toBe("multiple_choice");
    if (branchDraft.answerDraft.kind !== "multiple_choice")
      throw new Error("expected multiple choice");
    expect(branchDraft.answerDraft.selectedOptionIds).toEqual(["kept", "other"]);
    expect(branchDraft.answerDraft.optionNoteDrafts).toEqual({ kept: "keep" });
    expect(branchDraft.answerDraft.otherText).toBe("old other");

    setYesNoSelection(state, "toggle", "yes");
    let active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual([
      "toggle",
      "branch",
      "openQuestion",
    ]);

    setMultipleChoiceOtherText(state, "branch", "branch other");
    setYesNoSelection(state, "toggle", "yes");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual(["toggle", "openQuestion"]);
    expect(getQuestionDraft(state, "branch").answerDraft.kind).toBe("multiple_choice");

    setYesNoSelection(state, "toggle", "yes");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(active.entries.map((entry) => entry.questionId)).toEqual([
      "toggle",
      "branch",
      "openQuestion",
    ]);

    setQuestionNote(state, "toggle", "skip reason");
    active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    const submitResult = buildStructuredSubmitResult(active, state);
    expect(submitResult.kind).toBe("question_outcomes");
    if (submitResult.kind !== "question_outcomes") throw new Error("expected outcomes");
    expect(submitResult.outcomes.some((outcome) => outcome.questionId === "openQuestion")).toBe(
      false,
    );

    const cancelResult = buildQuestionRuntimeFormResult({ action: "cancel", state });
    expect(cancelResult.action).toBe("cancel");
    expect(cancelResult.draftSnapshot.some((draft) => draft.questionId === "branch")).toBe(true);
    expect(
      validateAuthorizedQuestionRequest(
        JSON.stringify({
          ...request,
          draftSnapshot: cancelResult.draftSnapshot,
        }),
      ).ok,
    ).toBe(true);
  });

  test("returns no_user_response when all active questions stay open", () => {
    const request: AuthorizedQuestionRequest = {
      questions: [
        {
          questionId: "q1",
          kind: "freeform",
          prompt: "Q1",
          justification: "Need q1.",
          suggestedAnswer: "Text",
        },
      ],
    };

    const { state, graph } = getActive(request);
    const active = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });

    expect(buildStructuredSubmitResult(active, state)).toEqual({
      kind: "no_user_response",
      requiresClarification: false,
      outcomes: [],
    });

    setFreeformText(state, "q1", "hello");
    const answered = buildActiveQuestionView(graph, (questionId) => {
      const question = graph.questionsById[questionId]!.question;
      const draft = getQuestionDraft(state, questionId);
      return { draft, responseState: getQuestionResponseState(question, draft) };
    });
    expect(buildStructuredSubmitResult(answered, state).kind).toBe("question_outcomes");
  });
});
