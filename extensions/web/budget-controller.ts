/**
 * Web Research Budget Controller Extension
 *
 * What it does:
 * - Runs only inside the isolated `webresearch` child process.
 * - Tracks search-class (websearch + codesearch) and webfetch budgets, then steers the child from discovery to fetching before final synthesis.
 *
 * How to use it:
 * - Loaded automatically by `webresearch`; not intended for direct invocation.
 * - When search budget is spent, it blocks more searches and tells the child to fetch the best pages.
 * - When both search and fetch budgets are spent, it blocks more web calls and requests a final synthesis.
 *
 * Example:
 * - A balanced run can spend several searches to find candidates, then use the remaining fetch budget on the strongest pages before summarizing.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readResearchBudgetEnv } from "./shared/research-budget.js";

const BLOCK_REASON =
  "Web research budget exhausted. Do not call websearch, codesearch, or webfetch again. Produce the final answer from gathered evidence only.";
const SEARCH_BLOCK_REASON =
  "Search budget exhausted. Do not call websearch or codesearch again. Use the remaining budget on webfetch or finalize from gathered evidence.";
const FETCH_BLOCK_REASON =
  "Fetch budget exhausted. Do not call webfetch again. Finalize from gathered evidence or use any remaining search budget only if absolutely necessary.";
const FINALIZE_MESSAGE = [
  "Stop searching and fetching now.",
  "Using only the information already gathered, produce the best possible final answer in the required response shape.",
  "Do not call websearch, codesearch, or webfetch again.",
  "Clearly note uncertainty or missing evidence where needed.",
].join(" ");
const SWITCH_TO_FETCH_MESSAGE = [
  "Stop searching now.",
  "Use the remaining budget on webfetch for the strongest candidate pages.",
  "Do not call websearch or codesearch again unless explicitly re-directed.",
].join(" ");
const SWITCH_TO_FINALIZE_MESSAGE = [
  "Stop fetching now.",
  "If you have enough evidence, produce the final answer from gathered material.",
  "Do not call webfetch again.",
].join(" ");

export default function webResearchBudgetControllerExtension(pi: ExtensionAPI) {
  if (process.env.CRUMBS_WEBRESEARCH_CHILD !== "1") return;

  const budget = readResearchBudgetEnv();
  const budgetEnabled = Object.values(budget).some((value) => value !== undefined);
  if (!budgetEnabled) return;

  let searches = 0;
  let fetches = 0;
  let finalizeQueued = false;
  let searchRedirectQueued = false;
  let fetchRedirectQueued = false;

  const actionsUsed = () => searches + fetches;
  const searchBudgetSpent = () =>
    budget.maxSearches !== undefined && searches >= budget.maxSearches;
  const fetchBudgetSpent = () => budget.maxFetches !== undefined && fetches >= budget.maxFetches;
  const totalBudgetSpent = () =>
    budget.maxActions !== undefined && actionsUsed() >= budget.maxActions;
  const allBudgetsSpent = () => searchBudgetSpent() && fetchBudgetSpent();

  const queueFinalize = (reason: string) => {
    if (finalizeQueued) return;
    finalizeQueued = true;

    pi.sendUserMessage(`${FINALIZE_MESSAGE}\n\nReason: ${reason}`, {
      deliverAs: "steer",
    });
  };

  const queueSearchRedirect = (reason: string) => {
    if (searchRedirectQueued || finalizeQueued) return;
    searchRedirectQueued = true;

    pi.sendUserMessage(`${SWITCH_TO_FETCH_MESSAGE}\n\nReason: ${reason}`, {
      deliverAs: "steer",
    });
  };

  const queueFetchRedirect = (reason: string) => {
    if (fetchRedirectQueued || finalizeQueued) return;
    fetchRedirectQueued = true;

    pi.sendUserMessage(`${SWITCH_TO_FINALIZE_MESSAGE}\n\nReason: ${reason}`, {
      deliverAs: "steer",
    });
  };

  pi.on("tool_call", async (event) => {
    const isSearchTool = event.toolName === "websearch" || event.toolName === "codesearch";
    const isFetchTool = event.toolName === "webfetch";
    if (!isSearchTool && !isFetchTool) {
      return undefined;
    }

    if (finalizeQueued || totalBudgetSpent() || allBudgetsSpent()) {
      queueFinalize("web research budget fully used");
      return { block: true, reason: BLOCK_REASON };
    }

    if (isSearchTool && searchBudgetSpent()) {
      queueSearchRedirect(`max search calls reached (${budget.maxSearches})`);
      return { block: true, reason: SEARCH_BLOCK_REASON };
    }

    if (isFetchTool && fetchBudgetSpent()) {
      if (allBudgetsSpent() || totalBudgetSpent()) {
        queueFinalize("web research budget fully used");
        return { block: true, reason: BLOCK_REASON };
      }
      queueFetchRedirect(`max fetch calls reached (${budget.maxFetches})`);
      return { block: true, reason: FETCH_BLOCK_REASON };
    }

    if (isSearchTool) searches += 1;
    else fetches += 1;

    if (totalBudgetSpent()) {
      queueFinalize(`max web actions reached (${budget.maxActions})`);
      return undefined;
    }

    if (allBudgetsSpent()) {
      queueFinalize("search and fetch budgets fully used");
      return undefined;
    }

    if (isSearchTool && searchBudgetSpent()) {
      queueSearchRedirect("search budget fully used; switch to fetching best pages");
    }

    if (isFetchTool && fetchBudgetSpent()) {
      queueFetchRedirect("fetch budget fully used; finalize from gathered evidence");
    }

    return undefined;
  });
}
