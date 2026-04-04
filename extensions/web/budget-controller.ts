/**
 * Web Research Budget Controller Extension
 *
 * What it does:
 * - Runs only inside the isolated `webresearch` child process.
 * - Tracks websearch/webfetch call budgets and steers the child to finalize once the web budget is spent.
 *
 * How to use it:
 * - Loaded automatically by `webresearch`; not intended for direct invocation.
 * - When the child reaches or exceeds its web tool budget, it blocks more web calls and requests a final synthesis.
 *
 * Example:
 * - A quick run can search once and fetch twice; after that, this extension tells the child to summarize from gathered evidence.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readResearchBudgetEnv } from "./shared/research-budget.js";

const ENV_HAS_QUERY = "CRUMBS_RESEARCH_HAS_QUERY";
const BLOCK_REASON =
  "Web research budget exhausted. Do not call websearch or webfetch again. Produce the final answer from gathered evidence only.";
const FINALIZE_MESSAGE = [
  "Stop searching and fetching now.",
  "Using only the information already gathered, produce the best possible final answer in the required response shape.",
  "Do not call websearch or webfetch again.",
  "Clearly note uncertainty or missing evidence where needed.",
].join(" ");

function envFlag(name: string): boolean {
  return process.env[name] === "1";
}

function remaining(limit: number | undefined, used: number): number {
  if (limit === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - used);
}

export default function webResearchBudgetControllerExtension(pi: ExtensionAPI) {
  if (process.env.CRUMBS_PATHFINDER_CHILD !== "1") return;

  const budget = readResearchBudgetEnv();
  const budgetEnabled = Object.values(budget).some((value) => value !== undefined);
  if (!budgetEnabled) return;

  const hasQuery = envFlag(ENV_HAS_QUERY);
  let searches = 0;
  let fetches = 0;
  let finalizeQueued = false;

  const shouldFinalizeAfterCurrentCall = () => {
    const searchRemaining = remaining(budget.maxSearchCalls, searches);
    const fetchRemaining = remaining(budget.maxFetchCalls, fetches);

    if (!hasQuery) {
      return fetchRemaining <= 0;
    }

    return searchRemaining <= 0 && fetchRemaining <= 0;
  };

  const queueFinalize = (reason: string) => {
    if (finalizeQueued) return;
    finalizeQueued = true;

    pi.sendUserMessage(`${FINALIZE_MESSAGE}\n\nReason: ${reason}`, {
      deliverAs: "steer",
    });
  };

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "websearch" && event.toolName !== "webfetch") {
      return undefined;
    }

    if (finalizeQueued) {
      return { block: true, reason: BLOCK_REASON };
    }

    if (event.toolName === "websearch") {
      if (budget.maxSearchCalls !== undefined && searches >= budget.maxSearchCalls) {
        queueFinalize(`max websearch calls reached (${budget.maxSearchCalls})`);
        return { block: true, reason: BLOCK_REASON };
      }
      searches += 1;
    } else {
      if (budget.maxFetchCalls !== undefined && fetches >= budget.maxFetchCalls) {
        queueFinalize(`max fetched pages reached (${budget.maxFetchCalls})`);
        return { block: true, reason: BLOCK_REASON };
      }
      fetches += 1;
    }

    if (shouldFinalizeAfterCurrentCall()) {
      queueFinalize("web research budget fully used");
    }

    return undefined;
  });
}
