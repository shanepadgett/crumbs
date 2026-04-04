/**
 * Shared Research Budget State
 *
 * What it does:
 * - Reads per-run webresearch budget limits from child-process environment variables.
 * - Tracks search/fetch tool call counts and enforces hard caps.
 * - Provides optional per-page character cap for fetched content.
 *
 * How to use it:
 * - webresearch sets env vars when spawning Pathfinder.
 * - websearch/webfetch call claimSearch/claimFetch before executing network work.
 * - webfetch reads maxCharsPerPage() to trim oversized page content.
 *
 * Example:
 * - claimSearch(8) may return 4 when the active budget caps per-search results at 4.
 */

const ENV_MAX_SEARCH_CALLS = "CRUMBS_RESEARCH_MAX_SEARCH_CALLS";
const ENV_MAX_FETCH_CALLS = "CRUMBS_RESEARCH_MAX_FETCH_CALLS";
const ENV_MAX_RESULTS = "CRUMBS_RESEARCH_MAX_RESULTS";
const ENV_MAX_CHARS_PER_PAGE = "CRUMBS_RESEARCH_MAX_CHARS_PER_PAGE";

interface ResearchBudget {
  maxSearchCalls?: number;
  maxFetchCalls?: number;
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

function getState(): ResearchBudgetState {
  if (state) return state;

  const budget: ResearchBudget = {
    maxSearchCalls: parsePositiveInt(process.env[ENV_MAX_SEARCH_CALLS]),
    maxFetchCalls: parsePositiveInt(process.env[ENV_MAX_FETCH_CALLS]),
    maxResultsPerSearch: parsePositiveInt(process.env[ENV_MAX_RESULTS]),
    maxCharsPerPage: parsePositiveInt(process.env[ENV_MAX_CHARS_PER_PAGE]),
  };

  const enabled = Object.values(budget).some((v) => v !== undefined);
  state = { enabled, budget, searches: 0, fetches: 0 };
  return state;
}

export function claimSearch(requestedResults: number): number {
  const s = getState();
  if (!s.enabled) return requestedResults;

  const maxCalls = s.budget.maxSearchCalls;
  if (maxCalls !== undefined && s.searches >= maxCalls) {
    throw new Error(`Research budget exceeded: max search calls reached (${maxCalls})`);
  }

  s.searches += 1;

  const maxResults = s.budget.maxResultsPerSearch;
  if (maxResults === undefined) return requestedResults;
  return Math.max(1, Math.min(requestedResults, maxResults));
}

export function claimFetch(): void {
  const s = getState();
  if (!s.enabled) return;

  const maxCalls = s.budget.maxFetchCalls;
  if (maxCalls !== undefined && s.fetches >= maxCalls) {
    throw new Error(`Research budget exceeded: max fetched pages reached (${maxCalls})`);
  }

  s.fetches += 1;
}

export function maxCharsPerPage(): number | undefined {
  const s = getState();
  return s.budget.maxCharsPerPage;
}
