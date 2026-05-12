# Subagents Extension

Spin up small specialized agents inside Pi.

Use subagents when one model run is not enough, but full orchestration would be overkill. Good fit for repo recon, staged analysis, split investigation, and reusable specialist prompts.

## Why use it

- make repeatable specialists from simple Markdown files
- keep side work isolated from main conversation
- break bigger tasks into focused steps
- fan out independent investigations in parallel
- reuse built-in and custom agents across repos

Starter agents included:

- `scout` for fast repo discovery
- `web-research` for multi-step web/code research with source-backed synthesis

## What you can do

### Run one focused helper

Ask one agent to do one job.

```json
{ "agent": "scout", "task": "Summarize repo layout." }
```

Good for:

- finding relevant files
- tracing symbols or data flow
- checking tests, config, or ownership

### Run web/code research

Use `web-research` when direct search or one fetch is not enough.

```json
{ "agent": "web-research", "task": "Compare current Vite SSR deployment options. Return bullets with source URLs." }
```

Good for:

- comparing tools, APIs, or external recommendations
- checking docs, examples, and issue context across sources
- producing source-backed synthesis without filling main context with raw pages

### Run staged workflows

Use chain mode when step 2 should build on step 1.

```json
{
  "chain": [
    { "agent": "scout", "task": "Find files involved in auth." },
    { "agent": "scout", "task": "Inspect tests and likely edge cases." }
  ]
}
```

Each step receives prior step output automatically.

Good for:

- discover then verify
- inspect code then inspect tests
- gather context then produce targeted follow-up

### Split work in parallel

Use parallel mode when tasks do not depend on each other.

```json
{
  "tasks": [
    { "agent": "scout", "task": "Inspect frontend auth flow." },
    { "agent": "scout", "task": "Inspect backend auth flow." }
  ],
  "concurrency": 2
}
```

Good for:

- frontend vs backend
- read path vs write path
- implementation vs tests

Limits:

- max tasks: `8`
- max concurrency: `4`

## Quick start

### 1. See available agents

```text
/subagents list
```

### 2. Check setup when something looks wrong

```text
/subagents doctor
```

### 3. Run built-in agents

Example prompts:

- `Find entrypoints for billing logic.`
- `Trace where this API response gets transformed.`
- `List files most likely involved in this failing test.`
- `Use web-research to investigate React Server Components cache invalidation. Return concise notes with sources.`

## Make your own agent

Create one Markdown file in either:

- `~/.pi/crumbs/agents`
- nearest `.pi/crumbs/agents`

Example:

```md
---
name: reviewer
description: Focused code review helper.
tools:
  - read
  - bash
---
You review code changes for correctness, risk, and missing tests.
Prefer concrete file paths, exact findings, and small safe recommendations.
```

Then call it through `subagent`.

## Agent file basics

Each agent is one Markdown file with YAML frontmatter plus prompt body.

Supported fields:

- `name` — required
- `description` — required
- `model` — optional model id or `provider/id`
- `thinkingLevel` — optional: `off|minimal|low|medium|high|xhigh`
- `tools` — optional tool allowlist

Useful defaults:

- omit `tools` to inherit caller tools
- set `tools: []` to disable all tools
- omit `model` to inherit current model

## Where agents come from

Subagents load from:

- built-in agents
- user agents in `~/.pi/crumbs/agents`
- project agents in nearest `.pi/crumbs/agents`

Precedence:

- project overrides user
- user overrides built-in

Easy customization path:

1. copy built-in agent
2. keep same `name`
3. change prompt, tools, or model

Your copy shadows earlier source.

## Built-in agents

### `scout`

`scout` is for focused discovery across more than one or two files.

Best uses:

- repo layout summaries
- symbol tracing
- dependency or data-flow lookup
- config and test impact checks
- narrowing unknown scope before editing

Bad use:

- exact target already known
- one file read answers question

Then direct work is faster.

### `web-research`

`web-research` is for focused external research across search results, docs, source examples, and fetched pages.

Best uses:

- compare tools or approaches
- verify behavior across docs, issues, and release notes
- gather source-backed recommendations
- inspect current external information without bloating main context

Bad use:

- one direct URL fetch is enough
- one simple search answers the question
- task only needs local repo inspection

## Practical patterns

### Pattern: recon before edit

1. `scout` finds relevant files
2. main agent edits with context

### Pattern: parallel compare

1. one subagent inspects current implementation
2. one subagent inspects tests or adjacent system
3. main agent merges findings

### Pattern: reusable specialists

Create agents like:

- `reviewer`
- `test-finder`
- `docs-writer`
- `migration-scout`

Keep prompts narrow. Better output. Lower drift.

## Troubleshooting

Run `/subagents doctor` if:

- agent does not appear in list
- duplicate names exist
- tool names are wrong
- model setting looks invalid

Common fix: check frontmatter, file location, and agent name.
