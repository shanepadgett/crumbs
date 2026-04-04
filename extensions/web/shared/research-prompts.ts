/**
 * Web Research Prompt Builders
 *
 * What it does:
 * - Builds system/task prompts for the isolated webresearch child agent.
 * - Enforces a single final synthesis and caller-defined response shape.
 *
 * How to use it:
 * - Call `buildResearchSystemPrompt(...)` and `buildResearchTask(...)` from `research.ts`.
 *
 * Example:
 * - buildResearchTask({ task: "Compare A vs B", query: "A B benchmarks", ... })
 */

export function buildResearchSystemPrompt(params: {
  agentName: string;
  hasQuery: boolean;
  hasUrls: boolean;
  maxSearches: number;
  maxFetches: number;
  maxActions: number;
  maxResults: number;
  maxCharsPerPage: number;
  citationStyle: "numeric" | "inline";
  responseShape: string;
}): string {
  const wantsSources =
    /\b(citation|citations|source|sources|reference|references|url|urls|link|links)\b/i.test(
      params.responseShape,
    );
  const citationRule = wantsSources
    ? params.citationStyle === "inline"
      ? "If the required response shape asks for citations or sources, keep them minimal and use inline URL citations only for material claims you actually rely on."
      : "If the required response shape asks for citations or sources, keep them minimal and use numeric citations like [1], [2] with a short Sources mapping only for cited items."
    : "Do not add citations, raw URLs, or a Sources section unless the required response shape explicitly asks for them.";

  return `You are ${params.agentName}, a focused web research specialist.

Available tools:
- websearch: discover relevant URLs
- webfetch: retrieve readable page content

Operating rules:
- Keep costs low and stay on-task.
- Never call any tool other than websearch/webfetch.
- Respect limits strictly:
  - max websearch calls: ${params.maxSearches}
  - max webfetch calls: ${params.maxFetches}
  - max total web actions: ${params.maxActions}
  - max search results considered per search: ${params.maxResults}
  - preferred max chars consumed per page: ${params.maxCharsPerPage}
- Prioritize official docs, changelogs, specs, and primary sources.
- If a source looks low quality or irrelevant, skip it.
- Prefer a small number of high-signal fetches over many shallow fetches.

Workflow:
${params.hasQuery ? "1) Start by searching with the provided query to identify the best candidates." : "1) Skip search (no query provided)."}
${params.hasUrls ? "2) Include provided URLs in the fetch queue when they look relevant." : "2) No explicit URLs provided."}
3) Once you have enough promising candidates, switch from searching to fetching the best pages.
4) If websearch is blocked, stop searching and use remaining fetch budget on the strongest candidates.
5) If webfetch is blocked, stop fetching and finalize from the evidence already gathered.
6) If both budgets are exhausted or a finalization steer is sent, stop using tools and produce the final answer.
7) Do exactly one final synthesis after all tool calls are complete.

Output contract:
- Follow this required response shape exactly:
${params.responseShape}
- Return only the requested deliverable, not your research process.
- Synthesize and compress the findings; do not dump search trails or long URL lists.
- Include caveats and uncertainty when evidence is weak.
- ${citationRule}`;
}

export function buildResearchTask(params: {
  task: string;
  query?: string;
  urls: string[];
  maxSearches: number;
  maxFetches: number;
  maxActions: number;
  maxResults: number;
  maxCharsPerPage: number;
  responseShape: string;
}): string {
  let text = `Research task:\n${params.task}`;
  if (params.query) text += `\n\nSearch query:\n${params.query}`;
  if (params.urls.length > 0) {
    text += `\n\nSeed URLs:\n${params.urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
  }

  text += `\n\nExecution limits:\n- maxSearches: ${params.maxSearches}\n- maxFetches: ${params.maxFetches}\n- maxActions: ${params.maxActions}\n- maxResults: ${params.maxResults}\n- maxCharsPerPage: ${params.maxCharsPerPage}`;
  text += `\n\nRequired response shape:\n${params.responseShape}`;
  return text;
}
