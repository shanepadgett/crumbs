import { stripOccurrenceFields } from "./question-definition.js";
import type {
  AuthorizedQuestionNode,
  AuthorizedQuestionRequest,
  QuestionResponseState,
  QuestionRuntimeQuestionDraft,
} from "./types.js";

export interface NormalizedQuestionGraph {
  questionOrder: string[];
  rootQuestionIds: string[];
  questionsById: Record<string, NormalizedQuestionNode>;
  outgoingEdgesByParentId: Record<string, QuestionActivationEdge[]>;
}

export interface NormalizedQuestionNode {
  questionId: string;
  question: AuthorizedQuestionNode;
  dependsOnQuestionIds: string[];
}

export interface QuestionActivationEdge {
  parentQuestionId: string;
  childQuestionId: string;
  occurrencePath: string;
  anyOfSelectedOptionIds: string[];
  allOfSelectedOptionIds: string[];
}

export interface QuestionVisibilityReason {
  kind: "root" | "follow_up";
  parentQuestionId?: string;
  matchedOptionIds?: string[];
}

export interface ActiveQuestionEntry {
  questionId: string;
  question: AuthorizedQuestionNode;
  activationDepth: number;
  visibilityReasons: QuestionVisibilityReason[];
}

export interface ActiveQuestionView {
  entries: ActiveQuestionEntry[];
}

export function normalizeQuestionGraph(
  request: AuthorizedQuestionRequest,
): NormalizedQuestionGraph {
  const questionOrder: string[] = [];
  const rootQuestionIds: string[] = [];
  const questionsById: Record<string, NormalizedQuestionNode> = {};
  const outgoingEdgesByParentId = new Map<string, Map<string, QuestionActivationEdge>>();

  function visit(
    nodes: AuthorizedQuestionNode[],
    pathBase: string,
    parent?: AuthorizedQuestionNode,
  ): void {
    for (let index = 0; index < nodes.length; index++) {
      const occurrence = nodes[index]!;
      const occurrencePath = `${pathBase}[${index}]`;

      if (!questionsById[occurrence.questionId]) {
        questionOrder.push(occurrence.questionId);
        questionsById[occurrence.questionId] = {
          questionId: occurrence.questionId,
          question: stripOccurrenceFields(occurrence),
          dependsOnQuestionIds: [...(occurrence.dependsOnQuestionIds ?? [])],
        };
      }

      if (!parent) {
        if (!rootQuestionIds.includes(occurrence.questionId)) {
          rootQuestionIds.push(occurrence.questionId);
        }
      } else {
        let edgesByKey = outgoingEdgesByParentId.get(parent.questionId);
        if (!edgesByKey) {
          edgesByKey = new Map<string, QuestionActivationEdge>();
          outgoingEdgesByParentId.set(parent.questionId, edgesByKey);
        }

        const edge: QuestionActivationEdge = {
          parentQuestionId: parent.questionId,
          childQuestionId: occurrence.questionId,
          occurrencePath,
          anyOfSelectedOptionIds: [...(occurrence.anyOfSelectedOptionIds ?? [])],
          allOfSelectedOptionIds: [...(occurrence.allOfSelectedOptionIds ?? [])],
        };
        const key = `${edge.childQuestionId}|${edge.anyOfSelectedOptionIds.join(",")}|${edge.allOfSelectedOptionIds.join(",")}`;
        if (!edgesByKey.has(key)) edgesByKey.set(key, edge);
      }

      if (Array.isArray(occurrence.followUps) && occurrence.followUps.length > 0) {
        visit(occurrence.followUps, `${occurrencePath}.followUps`, occurrence);
      }
    }
  }

  visit(request.questions, "$.questions");

  return {
    questionOrder,
    rootQuestionIds,
    questionsById,
    outgoingEdgesByParentId: Object.fromEntries(
      [...outgoingEdgesByParentId.entries()].map(([parentQuestionId, edges]) => [
        parentQuestionId,
        [...edges.values()],
      ]),
    ),
  };
}

export function buildActiveQuestionView(
  graph: NormalizedQuestionGraph,
  getQuestionState: (questionId: string) => {
    draft: QuestionRuntimeQuestionDraft;
    responseState: QuestionResponseState;
  },
): ActiveQuestionView {
  const candidates = new Map<string, ActiveQuestionEntry>();
  const questionOrderIndex = new Map(
    graph.questionOrder.map((questionId, index) => [questionId, index]),
  );

  function addCandidate(
    questionId: string,
    activationDepth: number,
    reason: QuestionVisibilityReason,
  ): void {
    const node = graph.questionsById[questionId];
    if (!node) return;

    const existing = candidates.get(questionId);
    if (!existing) {
      candidates.set(questionId, {
        questionId,
        question: node.question,
        activationDepth,
        visibilityReasons: [reason],
      });
      return;
    }

    existing.activationDepth = Math.min(existing.activationDepth, activationDepth);
    if (!hasVisibilityReason(existing.visibilityReasons, reason)) {
      existing.visibilityReasons.push(reason);
    }
  }

  function visit(questionId: string, depth: number, ancestry: Set<string>): void {
    const { draft, responseState } = getQuestionState(questionId);
    void draft;
    if (responseState !== "answered") return;

    for (const edge of graph.outgoingEdgesByParentId[questionId] ?? []) {
      const childDepth = depth + 1;
      if (childDepth > 3) continue;
      if (ancestry.has(edge.childQuestionId)) continue;
      if (
        !edgePasses(graph.questionsById[questionId]?.question, getQuestionState(questionId), edge)
      ) {
        continue;
      }

      addCandidate(edge.childQuestionId, childDepth, {
        kind: "follow_up",
        parentQuestionId: questionId,
        matchedOptionIds: getMatchedOptionIds(
          getSelectedOptionIds(getQuestionState(questionId)),
          edge,
        ),
      });

      const nextAncestry = new Set(ancestry);
      nextAncestry.add(edge.childQuestionId);
      visit(edge.childQuestionId, childDepth, nextAncestry);
    }
  }

  for (const questionId of graph.rootQuestionIds) {
    addCandidate(questionId, 0, { kind: "root" });
    visit(questionId, 0, new Set([questionId]));
  }

  const orderedCandidates = [...candidates.values()].sort(
    (left, right) =>
      (questionOrderIndex.get(left.questionId) ?? Number.MAX_SAFE_INTEGER) -
      (questionOrderIndex.get(right.questionId) ?? Number.MAX_SAFE_INTEGER),
  );
  const candidateById = new Map(orderedCandidates.map((entry) => [entry.questionId, entry]));
  const resolved = new Map<string, ActiveQuestionEntry>();
  const remaining = new Set(orderedCandidates.map((entry) => entry.questionId));

  while (remaining.size > 0) {
    let progressed = false;

    for (const entry of orderedCandidates) {
      if (!remaining.has(entry.questionId)) continue;
      const dependsOn = graph.questionsById[entry.questionId]?.dependsOnQuestionIds ?? [];
      let blocked = false;

      for (const dependencyId of dependsOn) {
        const dependencyCandidate = candidateById.get(dependencyId);
        if (!dependencyCandidate) {
          blocked = true;
          break;
        }

        const dependencyState = getQuestionState(dependencyId).responseState;
        if (dependencyState !== "answered") {
          blocked = true;
          break;
        }

        if (!resolved.has(dependencyId)) {
          blocked = true;
          break;
        }
      }

      if (blocked) continue;

      resolved.set(entry.questionId, entry);
      remaining.delete(entry.questionId);
      progressed = true;
    }

    if (!progressed) break;
  }

  return {
    entries: [...resolved.values()],
  };
}

function edgePasses(
  parentQuestion: AuthorizedQuestionNode | undefined,
  parentState: { draft: QuestionRuntimeQuestionDraft; responseState: QuestionResponseState },
  edge: QuestionActivationEdge,
): boolean {
  if (!parentQuestion || parentState.responseState !== "answered") return false;

  const selectedOptionIds = getSelectedOptionIds(parentState);
  if (edge.anyOfSelectedOptionIds.length === 0 && edge.allOfSelectedOptionIds.length === 0) {
    return true;
  }

  const anyPasses =
    edge.anyOfSelectedOptionIds.length === 0 ||
    edge.anyOfSelectedOptionIds.some((optionId) => selectedOptionIds.has(optionId));
  const allPasses = edge.allOfSelectedOptionIds.every((optionId) =>
    selectedOptionIds.has(optionId),
  );
  return anyPasses && allPasses;
}

function getSelectedOptionIds(parentState: {
  draft: QuestionRuntimeQuestionDraft;
  responseState: QuestionResponseState;
}): Set<string> {
  if (parentState.responseState !== "answered") return new Set();

  const { answerDraft } = parentState.draft;
  if (answerDraft.kind === "yes_no") {
    return answerDraft.selectedOptionId ? new Set([answerDraft.selectedOptionId]) : new Set();
  }

  if (answerDraft.kind === "multiple_choice") {
    return new Set(answerDraft.selectedOptionIds);
  }

  return new Set();
}

function getMatchedOptionIds(
  selectedOptionIds: Set<string>,
  edge: QuestionActivationEdge,
): string[] {
  if (edge.anyOfSelectedOptionIds.length === 0 && edge.allOfSelectedOptionIds.length === 0) {
    return [];
  }

  const combined = new Set<string>();
  for (const optionId of edge.allOfSelectedOptionIds) {
    if (selectedOptionIds.has(optionId)) combined.add(optionId);
  }
  for (const optionId of edge.anyOfSelectedOptionIds) {
    if (selectedOptionIds.has(optionId)) combined.add(optionId);
  }
  return [...combined];
}

function hasVisibilityReason(
  existing: QuestionVisibilityReason[],
  next: QuestionVisibilityReason,
): boolean {
  return existing.some(
    (reason) =>
      reason.kind === next.kind &&
      reason.parentQuestionId === next.parentQuestionId &&
      stableArray(reason.matchedOptionIds) === stableArray(next.matchedOptionIds),
  );
}

function stableArray(value?: string[]): string {
  return JSON.stringify([...(value ?? [])].sort());
}
