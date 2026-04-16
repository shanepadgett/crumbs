# Roast review: `extensions/subagents`

## Verdict
Solid core idea buried under too much scaffolding. Runtime isolation in `src/run.ts` is justified. Rest has strong smell of framework cosplay: many tiny adapters, duplicated state shapes, UI ceremony, and fake flexibility not paying rent.

## What is justified

### Fresh session per subagent is real value
Call path: `src/extension.ts:201-223` → `src/run.ts:439-565` → `runAgent()` at `src/run.ts:200-360`.

This part earns its keep:
- `runAgent()` creates fresh `DefaultResourceLoader` and `SessionManager.inMemory(cwd)` per run (`src/run.ts:227-248`).
- agent prompt is appended via `appendSystemPromptOverride` (`src/run.ts:238-240`).
- model / thinking / tool activation happens against isolated session state (`src/run.ts:251-260`).

That is not fake flexibility. That is actual boundary enforcement.

### Discovery + validation layer is mostly warranted
`src/agents.ts` doing markdown parsing, precedence, shadowing, and runtime validation is reasonable. Subagents are file-backed config, so having one place for parse + diagnostics makes sense.

## Overpriced design

### 1. `create.ts` is absurdly large for “pick options, maybe ask model, write markdown”
File size: `1029` lines.

Call path: `src/extension.ts:265-267` → `runCreateCommand()` at `src/create.ts:993-1029` → `runNewFlow()` / `runCloneFlow()` at `src/create.ts:733-991`.

This command does three small jobs:
1. collect settings
2. optionally generate agent stub
3. write `.md` file

Instead it ships its own little UI framework:
- `renderFramedScreen()` (`src/create.ts:136-153`)
- `pickFromList()` (`src/create.ts:399-449`)
- `pickTools()` (`src/create.ts:451-533`)
- `promptForDescription()` (`src/create.ts:535-604`)
- `confirmClone()` (`src/create.ts:606-670`)
- `showTextScreen()` (`src/create.ts:672-695`)
- `runBusyScreen()` (`src/create.ts:697-731`)
- `confirmNewAgent()` (`src/create.ts:835-899`)

That is ceremony stack, not domain logic.

Worse, clone and new flows duplicate same path:
- gather config
- analyze collision
- confirm
- `mkdir(dirname(targetPath), { recursive: true })`
- `writeFile(...)`
- `clearAgentRegistryCache()`
- `discoverAgents(ctx.cwd, { refresh: true })`
- show success/failure screen

Evidence:
- clone write path: `src/create.ts:817-832`
- new write path: `src/create.ts:964-990`

This is same transaction wrapped in two nearly identical mini-wizards.

### 2. Fake flexibility: separate `CloneState` and `CreateState`
Types:
- `CloneState` at `src/create.ts:30-39`
- `CreateState` at `src/create.ts:53-61`

Shared fields are almost identical:
- `scope`
- `modelMode`
- `model`
- `thinkingMode`
- `thinkingLevel`
- `toolsMode`
- `tools`

Difference is `CloneState` adds `source`. That did not need whole second state type. This is object-model inflation.

Same pattern again with:
- `confirmClone()` vs `confirmNewAgent()` (`src/create.ts:606-670`, `835-899`)
- `renderCloneMarkdown()` vs inline `buildAgentMarkdown(...)` in new flow (`src/create.ts:155-164`, `964-975`)

This is textbook “we abstracted nouns, not behavior”.

### 3. Discovery API pretends to return runnable subset, but returns full registry
`resolveRunnableAgents()` says it resolves runnable agents, but returns:
```ts
return {
  agents: registry.agents,
  diagnostics: [...filterRequestedDiagnostics(...), ...runtimeDiagnostics],
};
```
`src/agents.ts:377-391`

That is fake specificity. Function computes `requestedAgents` (`src/agents.ts:383-386`) only for validation, then throws result away and returns every agent anyway.

Call path: `src/extension.ts:202-206` → `src/agents.ts:377-391` → `src/run.ts:363-368` where `resolveAgent()` linearly searches full list.

If executor only needs requested agents, return requested agents. If it needs full registry, rename function. Right now naming sells precision that implementation does not provide.

### 4. Double validation / double shape logic in `extension.ts`
Tool already has `TypeBox` schema:
- `WORKFLOW_MODE_SCHEMA`, `STEP_SCHEMA`, `TOOL_PARAMS` (`src/extension.ts:29-49`)

Then `resolveWorkflow()` reparses everything manually (`src/extension.ts:51-99`):
- checks exactly one shape again
- checks item object shape again
- checks `cwd` again
- checks `concurrency` again

Some manual validation is fine for cross-field constraints, but this is two overlapping validation systems living back-to-back. Price paid:
- bigger file
- duplicated source of truth
- more ways for schema and parser to drift

`renderCall()` also infers mode from raw args again instead of reusing parsed workflow (`src/extension.ts:160-177`). Same data re-decoded multiple times.

### 5. `render.ts` carries generic-shape machinery because boundaries are muddy
File size: `498` lines.

`WorkflowShape` at `src/render.ts:22-32` accepts:
- actual `Workflow`
- ad hoc object with optional `runs`
- optional `items`
- optional `chain`
- optional `tasks`
- optional `agent`
- optional `task`

Then helpers exist only to tiptoe around that mush:
- `getWorkflowItems()` (`src/render.ts:65-67`)
- `getWorkflowRuns()` (`68-70`)
- `getWorkflowChain()` (`73-75`)
- `getWorkflowTasks()` (`77-79`)

That is not flexibility. That is renderer compensating for caller inconsistency.

Concrete example:
- `extension.ts:165-176` builds one synthetic workflow-ish object for `formatWorkflowLabel()`.
- later `renderWorkflow*` functions consume real `WorkflowResult`.

Instead of one stable view model, code created “accept anything vaguely workflow-shaped” adapter soup.

### 6. Debug mode is tiny feature with three layers and two control planes
Files/symbols:
- `src/debug.ts` stores one module boolean plus env fallback (`1-11`)
- `src/extension.ts:114-116` wraps it in `renderDebugModeStatus()`
- `src/extension.ts:269-283` adds slash command toggles
- `src/run.ts:229-237`, `334-346`, `445-460` branches execution and payload capture on it

For one flag, control is split between env var and mutable module global. Works, but architecture is grander than feature.

### 7. Repeated constants and parsing logic show weak center of gravity
Duplicated `THINKING_LEVELS`:
- `src/agents.ts:25`
- `src/create.ts:68`

Repeated frontmatter handling:
- parse for runtime in `src/agents.ts:128-166`
- parse again for style reference loading in `src/create.ts:321-332`

Not huge alone. Combined with file sizes, it shows module boundaries were drawn by convenience, not by coherent ownership.

### 8. Some “builder” helpers exist only to decorate trivial strings
Examples:
- `buildTaskPrompt()` at `src/run.ts:371-373` returns `"Task:\n<trimmed task>"`
- `buildChainPrompt()` at `src/run.ts:375-378` wraps handoff in fenced block
- `formatRegistryIssueNotice()` at `src/extension.ts:101-112`
- `renderDebugModeStatus()` at `src/extension.ts:114-116`

These are not evil. But in aggregate they make simple control flow look like enterprise middleware.

## Concrete duplicated layers

### Command path duplicates registry refresh work
- startup/reload diagnostics: `src/extension.ts:125-141` → `collectRegistryDiagnostics()` → `discoverAgents(refresh: true)`
- tool execute: `src/extension.ts:201-206` → `resolveRunnableAgents()` → `discoverAgents(refresh: true)`
- `/subagent list`: `src/extension.ts:245-247` → `discoverAgents(refresh: true)`
- `/subagent doctor`: `src/extension.ts:250-262` → `collectRegistryDiagnostics()` → `discoverAgents(refresh: true)`
- `/subagent create`: `src/create.ts:999` → `discoverAgents(refresh: true)`
- post-write clone/new: `src/create.ts:821-822`, `978-979` → clear cache then immediately rediscover

Some refreshes are appropriate. But current design treats registry as expensive enough to cache, then forces refresh almost everywhere anyway. That is half-committed abstraction.

### Renderer duplicates status logic across modes
- `renderSingleCollapsed()` / `renderSingleExpanded()` (`src/render.ts:268-318`)
- `renderChainExpanded()` (`375-400`)
- `renderParallelExpanded()` (`402-...`)
- `pushTranscriptSection()` (`343-373`)

There is some justified branching by mode, but too much repeated “prompt / activities / response / error / waiting” plumbing remains.

## Where complexity is earned

### Concurrency limiter is small and honest
`mapWithConcurrencyLimit()` in `src/run.ts:411-429` is plain, bounded, and directly used by parallel execution. No fake abstraction there.

### Tool activity capture is useful, not ornamental
`run.ts` event subscription (`src/run.ts:263-318`) converts low-level session events into stable `ToolActivity[]` and streaming updates. Rendering needs that. This is real adaptation, not architecture fanfic.

## Bottom line
Core runtime: good.

Surrounding package: too much pageantry for tiny feature set.

Biggest offenders:
1. `src/create.ts` giant wizard file
2. renderer accepting mushy “workflow-like” shapes
3. APIs named like they narrow scope while returning everything
4. duplicated validation and state models

If this module needed simplification later, safest cuts would be:
- split `create.ts` by domain, not by screen widget
- unify create/clone state and confirm/write flow
- make renderer consume one real view model
- make `resolveRunnableAgents()` either return requested agents or get renamed honestly
