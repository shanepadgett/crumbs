/**
 * Shared Research Budget State
 *
 * What it does:
 * - Reads per-run webresearch budget limits from child-process environment variables.
 * - Tracks search-class (websearch/codesearch) and webfetch budgets, plus an optional total action cap.
 * - Provides optional per-page character cap for fetched content.
 *
 * How to use it:
 * - webresearch sets env vars when spawning the web research child agent.
 * - websearch/codesearch/webfetch call claimSearch/claimFetch before executing network work.
 * - webfetch reads maxCharsPerPage() to trim oversized page content.
 *
 * Example:
 * - claimSearch(8) may return 4 when the active budget caps per-search results at 4.
 */

const ENV_MAX_SEARCHES = "CRUMBS_RESEARCH_MAX_SEARCHES";
const ENV_MAX_FETCHES = "CRUMBS_RESEARCH_MAX_FETCHES";
const ENV_MAX_ACTIONS = "CRUMBS_RESEARCH_MAX_ACTIONS";
const ENV_MAX_RESULTS = "CRUMBS_RESEARCH_MAX_RESULTS";
const ENV_MAX_CHARS_PER_PAGE = "CRUMBS_RESEARCH_MAX_CHARS_PER_PAGE";

export interface ResearchBudget {
  maxSearches?: number;
  maxFetches?: number;
  maxActions?: number;
  maxResultsPerSearch?: number;
  maxCharsPerPage?: number;
}

interface ResearchBudgetState {
  enabled: boolean;
  budget: ResearchBudget;
  searches: number;
  fetches: number;
}

let state: ResearchBudgetState | undefined;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

export function readResearchBudgetEnv(): ResearchBudget {
  return {
    maxSearches: parsePositiveInt(process.env[ENV_MAX_SEARCHES]),
    maxFetches: parsePositiveInt(process.env[ENV_MAX_FETCHES]),
    maxActions: parsePositiveInt(process.env[ENV_MAX_ACTIONS]),
    maxResultsPerSearch: parsePositiveInt(process.env[ENV_MAX_RESULTS]),
    maxCharsPerPage: parsePositiveInt(process.env[ENV_MAX_CHARS_PER_PAGE]),
  };
}

function getState(): ResearchBudgetState {
  if (state) return state;

  const budget = readResearchBudgetEnv();
  const enabled = Object.values(budget).some((v) => v !== undefined);
  state = { enabled, budget, searches: 0, fetches: 0 };
  return state;
}

function usedActions(state: ResearchBudgetState): number {
  return state.searches + state.fetches;
}

function ensureActionBudget(state: ResearchBudgetState): void {
  const maxActions = state.budget.maxActions;
  if (maxActions !== undefined && usedActions(state) >= maxActions) {
    throw new Error(`Research budget exceeded: max web actions reached (${maxActions})`);
  }
}

function ensureSearchBudget(state: ResearchBudgetState): void {
  const maxSearches = state.budget.maxSearches;
  if (maxSearches !== undefined && state.searches >= maxSearches) {
    throw new Error(`Research budget exceeded: max search calls reached (${maxSearches})`);
  }
}

function ensureFetchBudget(state: ResearchBudgetState): void {
  const maxFetches = state.budget.maxFetches;
  if (maxFetches !== undefined && state.fetches >= maxFetches) {
    throw new Error(`Research budget exceeded: max fetch calls reached (${maxFetches})`);
  }
}

export function claimSearch(requestedResults: number): number {
  const s = getState();
  if (!s.enabled) return requestedResults;

  ensureSearchBudget(s);
  ensureActionBudget(s);
  s.searches += 1;

  const maxResults = s.budget.maxResultsPerSearch;
  if (maxResults === undefined) return requestedResults;
  return Math.max(1, Math.min(requestedResults, maxResults));
}

export function claimFetch(): void {
  const s = getState();
  if (!s.enabled) return;

  ensureFetchBudget(s);
  ensureActionBudget(s);
  s.fetches += 1;
}

export function maxCharsPerPage(): number | undefined {
  const s = getState();
  return s.budget.maxCharsPerPage;
}
