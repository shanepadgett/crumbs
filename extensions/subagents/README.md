# Subagents Extension

Runs isolated subagent workflows in-process on top of Pi SDK sessions.

## What it provides

- strict agent discovery from Markdown files with YAML frontmatter
- runtime validation with `/subagents list` and `/subagents doctor`
- `subagent` tool with `single`, `chain`, and `parallel` modes
- starter agent: `scout`

## Architecture

Each subagent run creates fresh in-process session state.

Flow:

1. Discover agents from built-in, user, and nearest project agent directories.
2. Parse frontmatter and prompt body from each Markdown file.
3. Validate duplicate names, tool names, and configured model references.
4. Create isolated Pi SDK session with `createAgentSession()`.
5. Use fresh `DefaultResourceLoader` and `SessionManager.inMemory(cwd)` for run-local state.
6. Apply agent model, thinking level, and tool allowlist before prompt runs.
7. Stream text/tool progress back into single, chain, or parallel workflow output.

No child process or IPC layer is used.

## Agent locations

- built-in: `extensions/subagents/agents`
- user: `~/.pi/crumbs/agents`
- project: nearest `.pi/crumbs/agents`

Precedence:

- built-in < user < project
- later source shadows earlier source
- same-scope duplicate names are errors
- cross-scope shadowing is info in `/subagents doctor`

Override pattern:

- built-in agents are starter defaults
- to change default model, tools, or prompt behavior, copy agent into user or project agent dir with same `name`
- copied agent shadows earlier source with same name

## Agent format

Each agent is one Markdown file with YAML frontmatter and prompt body.

Example:

```md
---
name: scout
description: Fast local recon.
tools:
  - read
  - bash
---
Role-only prompt text here.
```

Supported frontmatter fields:

- `name` - required
- `description` - required
- `model` - optional model id or `provider/id`
- `thinkingLevel` - optional thinking override: `off|minimal|low|medium|high|xhigh`
- `tools` - optional tool allowlist

Tool inheritance rules:

- omitted `tools` inherits caller active tools
- `tools: []` disables all tools for that agent

Model notes:

- omitted `model` inherits current parent session model
- there is no separate `provider` field; use `model: provider/id` for provider-qualified selection

Validation notes:

- frontmatter must parse to object
- prompt body must not be empty
- unknown tools are blocking errors
- unknown models are warnings in current runtime registry

## Commands

- `/subagents list` — show discovered agents
- `/subagents doctor` — show discovery and runtime diagnostics

If startup or reload finds agent issues, extension emits notice telling you to run `/subagents doctor`.

## Tool shapes

Single:

```json
{ "agent": "scout", "task": "Summarize repo layout." }
```

Single with explicit working directory:

```json
{ "agent": "scout", "task": "Inspect src.", "cwd": "/path/to/repo" }
```

Chain:

```json
{
  "chain": [
    { "agent": "scout", "task": "Inspect relevant files." },
    { "agent": "scout", "task": "Inspect tests and config impact." }
  ]
}
```

Chain behavior:

- each step keeps its own task prompt
- each step after first automatically receives prior step output as handoff
- runtime sends chain prompts in this shape:

````text
Task:
<step task>

Received handoff:
```text
<prior step output>
```
````

Parallel:

```json
{
  "tasks": [
    { "agent": "scout", "task": "Inspect frontend." },
    { "agent": "scout", "task": "Inspect backend." }
  ],
  "concurrency": 2
}
```

Parallel limits:

- max tasks: `8`
- max concurrency: `4`

## Built-in scout guidance

Built-in `scout` is for focused repo discovery.

Use it for:

- multi-file discovery
- symbol tracing
- data-flow lookup
- ownership lookup
- constraints and unknowns tied to task

Prefer direct work instead when exact target file is already known or one or two files are enough.

Use parallel `scout` tasks when independent discovery lenses keep findings focused, for example:

- frontend vs backend
- read path vs write path
- implementation vs tests

Keep parallel scout tasks distinct and narrow to avoid overlapping broad summaries.
