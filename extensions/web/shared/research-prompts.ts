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
  maxSearchCalls: number;
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
  citationStyle: "numeric" | "inline";
  responseShape: string;
}): string {
  const citationRule =
    params.citationStyle === "inline"
      ? "Include direct URL citations inline at the end of each claim."
      : "Use numeric citations like [1], [2] and provide a Sources section mapping numbers to URLs.";

  return `You are ${params.agentName}, a focused web research specialist.

Available tools:
- websearch: discover relevant URLs
- webfetch: retrieve readable page content

Operating rules:
- Keep costs low and stay on-task.
- Never call any tool other than websearch/webfetch.
- Respect limits strictly:
  - max websearch calls: ${params.maxSearchCalls}
  - max search results considered per search: ${params.maxResults}
  - max pages fetched: ${params.maxPages}
  - preferred max chars consumed per page: ${params.maxCharsPerPage}
- Prioritize official docs, changelogs, specs, and primary sources.
- If a source looks low quality or irrelevant, skip it.

Workflow:
${params.hasQuery ? "1) Run websearch with the provided query and identify best candidates." : "1) Skip search (no query provided)."}
${params.hasUrls ? "2) Include provided URLs in evaluation and fetch queue." : "2) No explicit URLs provided."}
3) Fetch and read only the most relevant pages.
4) If the web tool budget is exhausted or a web tool call is blocked, stop using tools and produce the final synthesis from gathered evidence.
5) Do exactly one final synthesis after all tool calls are complete.

Output contract:
- Follow this required response shape exactly:
${params.responseShape}
- Include caveats and uncertainty when evidence is weak.
- ${citationRule}`;
}

export function buildResearchTask(params: {
  task: string;
  query?: string;
  urls: string[];
  maxSearchCalls: number;
  maxResults: number;
  maxPages: number;
  maxCharsPerPage: number;
  responseShape: string;
}): string {
  let text = `Research task:\n${params.task}`;
  if (params.query) text += `\n\nSearch query:\n${params.query}`;
  if (params.urls.length > 0) {
    text += `\n\nSeed URLs:\n${params.urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
  }

  text += `\n\nExecution limits:\n- maxSearchCalls: ${params.maxSearchCalls}\n- maxResults: ${params.maxResults}\n- maxPages: ${params.maxPages}\n- maxCharsPerPage: ${params.maxCharsPerPage}`;
  text += `\n\nRequired response shape:\n${params.responseShape}`;
  return text;
}
