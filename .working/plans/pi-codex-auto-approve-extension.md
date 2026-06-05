# Auto-guardian permission-gate extension plan

## Goal

Build a Pi extension `extensions/auto-guardian/` that gates tool execution with a layered permission model:

1. **Deterministic classifier** (core product): allow / block / prompt based on tool kind, command patterns, and path policy.
2. **User prompt** fallback for risky-but-not-banned actions, via `ctx.ui.select`.
3. **Optional LLM guardian** (off by default): a locked-down model call that approves or denies, falling back to a user prompt on deny/error.

The extension is a Pi-native pre-execution gate. It is inspired by Codex auto-review conceptually but does not integrate with Codex internals, approval caches, sandbox-retry, or `PermissionRequest` hooks. Pi has no built-in permission system (`docs/usage.md:286`), so this fills a real gap.

## Non-goals

- No Codex compatibility, no sandbox-retry semantics, no approval-cache amendment flow.
- No "strict auto-review" mode that reviews already-safe actions (pure ceremony; cut).
- No session approval cache in v1 (add later only if prompts prove noisy).
- Do not gate web tools (`web_search`, `web_fetch`, `code_search`); those are owned by `extensions/web` permissions (`extensions/web/shared/permissions.ts`).
- Do not modify or depend on `extensions/codex-compat` internals.

## Verified ground truth (Pi 0.78.1)

Installed package root: `/Users/spadgett/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`.

### `tool_call` hook (the gate)

- Fires before tool executes, **can block**, handler is async. `docs/extensions.md:674-705`; type defs `dist/core/extensions/types.d.ts`.
- Return type `ToolCallEventResult { block?: boolean; reason?: string }` (`types.d.ts`). Returning `undefined` lets the tool run. There is no "approve" return; allowing == returning undefined.
- `event.input` is mutable; mutations affect execution and are not re-validated. We do **not** mutate input — classify only.
- Handlers can call `ctx.ui.*` and `await` arbitrary async work before returning. Sibling tool calls in one assistant message are preflighted sequentially, so prompts do not interleave.

### Tool input shapes (`types.d.ts` + `dist/core/tools/*`)

- `bash`: `{ command: string; timeout?: number }`
- `write`: `{ path: string; content: string }`
- `edit`: `{ path: string; edits: Array<{ oldText: string; newText: string }> }`
- `read`: `{ path: string; offset?: number; limit?: number }`
- `grep`/`find`/`ls`: read-only.
- Custom tool event: `CustomToolCallEvent { toolName: string; input: Record<string, unknown> }`.
- `apply_patch` (custom, from codex-compat): `{ input: string }` patch body. Path is **not** a direct field; must be parsed from the patch headers.

Use `isToolCallEventType("bash", event)` etc. to narrow built-ins. For custom tools, read `event.input` as `Record<string, unknown>`.

### Extension context (`types.d.ts`)

- `ctx.cwd: string`, `ctx.hasUI: boolean`, `ctx.signal: AbortSignal | undefined`.
- `ctx.ui.select(title, options, opts?): Promise<string | undefined>`, `ctx.ui.confirm`, `ctx.ui.notify(message, "info"|"warning"|"error")`.
- `ctx.modelRegistry` (find models, resolve auth), `ctx.model` (active model).
- `session_start` event carries `event.cwd` (`docs/extensions.md:346`).

### In-process LLM guardian is feasible (proven in this repo)

Pattern in `extensions/subagents/src/create/generate.ts:177-205`:

```ts
import { completeSimple } from "@earendil-works/pi-ai";
const model = ctx.model ?? ctx.modelRegistry.find(provider, id);
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model); // { ok, apiKey?, headers? }
if (!auth.ok) throw new Error(auth.error);
const response = await completeSimple(
  model,
  {
    systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
  },
  {
    apiKey: auth.apiKey,
    headers: auth.headers,
    signal: ctx.signal,
    maxTokens,
    ...(model.reasoning ? { reasoning: "low" } : {}),
  },
);
// response.stopReason: "error" | "aborted" | ...; extract text from response.content
```

The same file shows the malformed-output retry loop to copy for guardian JSON parsing.

### Packaging / discovery

- Extension manifest shape (see `extensions/codex-compat/package.json`):
  ```json
  {
    "name": "@crumbs-pi/auto-guardian",
    "private": true,
    "type": "module",
    "pi": { "extensions": ["./index.ts"] }
  }
  ```
- Root `package.json` `workspaces` lists each extension; **add `"extensions/auto-guardian"`** there. Root `pi.extensions` is `["./extensions"]`, so the folder is discovered once it has a valid manifest.
- Tests run via `bun test` (root `package.json` `scripts.test`; precedent `extensions/codex-compat/src/*.test.ts`).
- Changes under `extensions/` require `/reload` before testing.

### Code conventions (mandatory; cold-start footguns)

- TypeScript config is `.config/tsconfig.json`: `module`/`moduleResolution: NodeNext`, `strict`, `verbatimModuleSyntax`, `isolatedModules`, `noEmit`. Extensions are `.ts` run directly by Pi's loader (jiti); there is no build step.
- **Local imports use the `.js` extension even though files are `.ts`** (e.g. `import { classify } from "./classify.js"`, `import { loadEffectiveExtensionConfig } from "../../shared/config/crumbs-loader.js"`). This is required under NodeNext. Precedent: `extensions/subagents/src/create/generate.ts`.
- Use `import type { ... }` for type-only imports (`verbatimModuleSyntax`).
- `Model` and `completeSimple` import from `@earendil-works/pi-ai`. `ExtensionAPI`, event types, and `isToolCallEventType` import from `@earendil-works/pi-coding-agent`.
- `ResolvedRequestAuth` is **not** exported publicly. Type the auth result structurally as `{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }`, or `Awaited<ReturnType<ModelRegistry["getApiKeyAndHeaders"]>>`.
- `extractTextContent(response.content)` is a private helper in `generate.ts`; reimplement a small local version (concatenate `item.text` for `item.type === "text"`).

## Architecture

### Decision types

```ts
type ToolKind = "read_only" | "bash" | "file_mutation" | "unknown";
type DecisionAction = "allow" | "block" | "prompt" | "guardian";

interface ClassifierResult {
  action: DecisionAction;
  reason: string; // shown in prompt + block reason + notify
  overridable: boolean; // false => hard deny, user cannot allow
}
```

Hard deny (`overridable: false`) cases: command denylist hits, writes to protected paths, writes outside workspace when disallowed. These always `block` and are never sent to guardian or user prompt. Everything the guardian or user can still allow is `overridable: true`.

### Request model

```ts
interface ResolvedTargetPath {
  raw: string;
  absolute: string;
  canonical: string; // realpath of nearest existing ancestor + tail
  insideWorkspace: boolean;
  isProtected: boolean;
  operation?: "add" | "update" | "delete" | "replace" | "move";
  byteSize?: number; // write content / patch added bytes, when known
}

interface GateRequest {
  toolName: string;
  toolCallId: string;
  kind: ToolKind;
  cwd: string;
  command?: string; // bash
  paths?: ResolvedTargetPath[]; // file_mutation
  inputSummary: string; // one-line human summary for prompt/guardian
}
```

### Config (crumbs convention)

Config lives in the shared crumbs file under `extensions.autoGuardian`, **not** a standalone file. Read via the repo's shared loader (`extensions/shared/config/crumbs-loader.ts`):

```ts
import { loadEffectiveExtensionConfig } from "../../shared/config/crumbs-loader.js";
const raw = await loadEffectiveExtensionConfig(ctx.cwd, "autoGuardian"); // JsonObject ({} when unset)
```

This merges global (`~/.pi/agent/crumbs.json`) and project (`.pi/crumbs.json`) and is cached per project root (config changes need `/reload`). Load at `session_start` (uses `event.cwd`); lazy-load fallback in the hook if not yet loaded. Parse defensively into `AutoGuardianConfig`, applying built-in defaults for any missing field (follow the `asObject`/defaulting style in `extensions/codex-compat/src/fast.ts`; do not introduce a separate typebox validator — JSON Schema below is the source of truth for shape). Pattern strings compile via `new RegExp(src, "i")`; an invalid regex is skipped with a `ctx.ui.notify(warning)`, not fatal.

**Array fields replace, not merge.** When a user sets `bash.denyPatterns`, `bash.promptPatterns`, `bash.allowPatterns`, `mutation.protectedPaths`, or `ignoreTools`, the provided array fully replaces the built-in default for that field (the shared crumbs merge does not deep-merge these). Document this in the README so users re-include defaults they want to keep. Built-in defaults apply only when the field is absent.

```ts
interface AutoGuardianConfig {
  mode: "off" | "gate"; // default "gate"
  ignoreTools: string[]; // always allow; default read-only + web tools (below)
  bash: {
    defaultAction: "allow" | "prompt"; // default "allow" (Pi default is no gating; add guardrails, not friction)
    denyPatterns: string[]; // regex sources -> hard block
    promptPatterns: string[]; // regex sources -> user prompt
    allowPatterns: string[]; // regex sources -> allow even when defaultAction "prompt"
  };
  mutation: {
    defaultAction: "allow" | "prompt"; // default "allow"
    protectedPaths: string[]; // globs (**, *) -> hard block; default [".git/**"]
    allowOutsideWorkspace: boolean; // default false
    maxBytes?: number; // optional; write/patch bigger than this -> prompt
  };
  unknownToolAction: "allow" | "prompt" | "block"; // default "prompt"
  guardian: {
    enabled: boolean; // default false
    model?: string; // "provider/id"; default = active model
    reviewBash: boolean; // default true
    reviewMutations: boolean; // default false
    timeoutMs: number; // default 15000
    maxTokens: number; // default 256
  };
}
```

Default `ignoreTools`: `["read", "grep", "find", "ls", "web_search", "web_fetch", "code_search"]` (read-only built-ins + web tools owned elsewhere). `view_image` (codex-compat) is read-only; add it too.

`guardian.model` resolution: when set as `"provider/id"`, resolve via `ctx.modelRegistry.find(provider, id)`; when unset, use `ctx.model` (active session model). If a configured model is not found or has no auth (`getApiKeyAndHeaders().ok === false`), treat as guardian unavailable → fall back to user prompt (block when no UI), and `notify` once.

### Schema registration (`schemas/crumbs.schema.json`)

Add in phase 1 so editors get validation/autocomplete and `crumbs-doctor` can check the config:

1. Under `properties.extensions.properties`, add `"autoGuardian": { "$ref": "#/$defs/autoGuardianConfig" }`.
2. Add a `$defs.autoGuardianConfig` object mirroring `AutoGuardianConfig` (`additionalProperties: false`, per-field `default` + `description`). Nested `bash`, `mutation`, `guardian` as sub-objects. `guardian.model` is `{ "type": "string", "description": "Guardian model as provider/id. Defaults to the active session model." }`.

Match the existing `$def` style (see `codexCompatConfig`, `commitConfig`, `cavemanConfig`). Defaults declared in the schema must match the code defaults.

Default `bash.denyPatterns` (starter set, tunable; sources, case-insensitive):

- `:\s*\(\s*\)\s*\{.*\|\s*:` (fork bomb)
- `\bmkfs[\.\s]`
- `\bdd\b[^\n]*\bof=/dev/`
- `>\s*/dev/(sd|nvme|disk)`
- `\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+/(\s|$)` (rm -rf /)

Default `bash.promptPatterns`:

- `\bsudo\b`
- `\b(chmod|chown)\b[^\n]*\b777\b`
- `\bgit\s+push\b[^\n]*--force`
- `\b(curl|wget)\b[^\n]*\|\s*(sh|bash)`
- `>\s*/etc/`
- `\brm\s+-[A-Za-z]*r` (any recursive rm)

### Classifier rules (deterministic, `classify.ts`)

Input: `GateRequest` + `AutoGuardianConfig`. Output: `ClassifierResult`.

**read_only / ignoreTools** → never reaches classifier (filtered earlier) → allow.

**bash:**

1. denyPattern match → `{ block, overridable: false, reason: "matched deny rule <src>" }`.
2. promptPattern match → `{ prompt, overridable: true, reason: "matched prompt rule <src>" }`.
3. `guardian.enabled && guardian.reviewBash` → `{ guardian, overridable: true }`.
4. `defaultAction === "prompt"`: allowPattern match → allow; else `{ prompt }`.
5. else → allow.

**file_mutation (write / edit / apply_patch):**

1. Any path `!insideWorkspace && !allowOutsideWorkspace` → `{ block, overridable: false, reason: "writes outside workspace: <path>" }`.
2. Any path `isProtected` → `{ block, overridable: false, reason: "protected path: <path>" }`.
3. apply_patch with no parseable file headers → `{ prompt, reason: "unparseable patch; cannot verify targets" }`.
4. `maxBytes` set and any `byteSize > maxBytes` → `{ prompt, reason: "large mutation (<n> bytes)" }`.
5. `guardian.enabled && guardian.reviewMutations` → `{ guardian }`.
6. `defaultAction === "prompt"` → `{ prompt }`.
7. else → allow.

**unknown** → map `unknownToolAction`: `"allow"` → `{ allow }`; `"prompt"` → `{ prompt, overridable: true, reason: "unknown tool: <name>" }`; `"block"` → `{ block, overridable: false, reason: "unknown tool blocked: <name>" }`.

**Tool kind mapping (`request.ts`):** `read`/`grep`/`find`/`ls`/`view_image` → `read_only`; `bash` → `bash`; tools in `MUTATION_TOOLS = new Set(["write", "edit", "apply_patch"])` → `file_mutation`; everything else → `unknown`. Path source per tool: `write`/`edit` use `input.path`; `apply_patch` parses `input.input` via `patch.ts`. `byteSize` for `write` = `Buffer.byteLength(input.content, "utf8")`.

### Gate orchestration (`gate.ts`, the `tool_call` handler)

```
if config.mode === "off": return undefined
build GateRequest (request.ts)
if toolName in config.ignoreTools OR kind === "read_only": return undefined
result = classify(request, config)
switch result.action:
  allow:    return undefined
  block:    return { block: true, reason: result.reason }
  prompt:   return promptUser(ctx, request, result.reason)
  guardian: g = runGuardian(...)
            g.outcome === "allow" -> return undefined
            g.outcome === "deny"  -> return promptUser(ctx, request, `guardian denied: ${g.reason}`)
            g.error/timeout       -> return promptUser(ctx, request, `guardian unavailable: ${g.reason}`)
```

`promptUser`:

```
if (!ctx.hasUI) return { block: true, reason: `${reason} (no UI to confirm)` }   // fail closed
const choice = await ctx.ui.select(
  `⚠️ ${title(request)}\n\n${reason}\nAllow?`,
  ["Allow once", "Deny"],
  { signal: ctx.signal },                 // aborted turn dismisses dialog
)
// dismiss (Esc/abort) returns undefined -> treated as block
return choice === "Allow once" ? undefined : { block: true, reason: "Denied by user" }
```

`title(request)` is a compact one-liner: e.g. `bash: rm -rf build/` (truncate command to ~80 chars) or `write: src/app.ts` / `apply_patch: 3 files (2 update, 1 add)`.

### UI surface (built-ins only)

- Approval prompt uses `ctx.ui.select(title, ["Allow once", "Deny"], { signal })`; config warnings use `ctx.ui.notify(msg, "warning")`. No custom TUI components.
- `select` options are flat strings (no per-option descriptions, no in-dialog diff/preview). The command/path/patch preview lives in the multi-line `title`, mirroring `examples/extensions/permission-gate.ts`.
- `select` returns `undefined` on dismiss/abort; the gate treats anything other than `"Allow once"` as a block (fail closed).
- Do not use the dialog `timeout` option for approval prompts (auto-dismiss on a security gate is surprising).
- Out of scope for v1: a richer permission card (scrollable highlighted patch, "always allow" row) via `ctx.ui.custom(...)`. Revisit only if plain `select` proves inadequate.

### Path policy (`paths.ts`)

- Canonicalize via `realpath` of the nearest existing ancestor plus the relative tail (same approach as `extensions/codex-compat/src/path-policy.ts`). Implement a small local copy; do **not** import from codex-compat (tiny single-owner helper). Note for future: extract to `extensions/shared/io` only if a third consumer appears.
- `insideWorkspace`: canonical path is `ctx.cwd` or a descendant (compare via `path.relative(cwd, canonical)` not starting with `..` and not absolute).
- `isProtected`: canonical path (relative to cwd) matches any `protectedPaths` glob. Implement a minimal glob matcher supporting `*` (single segment) and `**` (any segments), compiled to RegExp. Cover with tests.

### apply_patch header parsing (`patch.ts`)

Minimal line scan of the patch body for headers (codex grammar, mirrored from codex-compat patch semantics):

- `*** Add File: <path>` → operation `add`
- `*** Update File: <path>` → `update`
- `*** Replace File: <path>` → `replace`
- `*** Delete File: <path>` → `delete`
- `*** Move to: <path>` (within an Update section) → adds a `move` target path
  Collect all referenced paths. If none found, signal "unparseable" so the classifier prompts. Approximate `byteSize` for add/replace as the sum of `+`-prefixed line lengths. Do not fully validate the patch; that is the tool's job.

### Guardian (`guardian.ts`, optional)

Signature designed for testability (inject the completion fn + auth resolver):

```ts
interface GuardianDeps {
  resolveModel: () => Promise<Model>; // ctx.model or registry.find(config.guardian.model)
  resolveAuth: (m: Model) => Promise<ResolvedRequestAuth>;
  complete: typeof completeSimple; // injectable for tests
  signal: AbortSignal | undefined;
}
type GuardianOutcome =
  | { outcome: "allow"; reason: string }
  | { outcome: "deny"; reason: string }
  | { outcome: "error"; reason: string };

async function runGuardian(req: GateRequest, cfg, deps: GuardianDeps): Promise<GuardianOutcome>;
```

- systemPrompt: locked-down policy. Guardian only inspects the provided request JSON, cannot run tools, must output strict JSON `{ "outcome": "allow" | "deny", "reason": string }`. Explicitly: do not allow destructive/irreversible actions; deny when uncertain.
- user message: JSON of `{ tool, kind, cwd, command?, paths?, inputSummary, matchedRule }`.
- Resolve model + auth first. If `resolveModel` returns nothing or `resolveAuth().ok === false` → `{ outcome: "error", reason }` (caller routes to prompt).
- Call `complete(model, { systemPrompt, messages:[...] }, { apiKey, headers, signal: combinedSignal, maxTokens: cfg.guardian.maxTokens })`.
- Timeout: `AbortController` aborted after `cfg.guardian.timeoutMs`, linked with `ctx.signal`. On abort/`stopReason==="aborted"`/`"error"` → `{ outcome: "error" }`.
- Read text via a local `extractTextContent(response.content)` (text items only). Parse JSON; on malformed, retry once with a correction prompt (mirror `generate.ts`). Second failure → `{ outcome: "error" }`.
- Guardian never sees or overrides hard-deny requests (they short-circuit before guardian).
- `error` outcome routes to `promptUser` (fail-closed-to-prompt; blocks when no UI).

## Module layout

```
extensions/auto-guardian/
  package.json
  index.ts              # short header (what/how/example) + register session_start + tool_call
  README.md             # add near completion
  src/
    types.ts            # GateRequest, ClassifierResult, config types, outcomes
    config.ts           # read extensions.autoGuardian via shared crumbs loader; apply defaults; compile regex
    request.ts          # ToolCallEvent -> GateRequest (kind detection, path resolution, summaries)
    classify.ts         # deterministic rules -> ClassifierResult
    paths.ts            # canonicalize, insideWorkspace, protected glob match
    patch.ts            # apply_patch header parse -> paths + byteSize
    guardian.ts         # optional LLM guardian (injectable deps)
    prompt.ts           # promptUser helper (title + ui.select + fail-closed)
    gate.ts             # orchestration: builds request, classifies, routes
    classify.test.ts
    paths.test.ts
    patch.test.ts
    config.test.ts
    guardian.test.ts
```

`index.ts` only wires: load config on `session_start`, register the `tool_call` handler that calls `gate.ts`. Keep header in `index.ts` only.

## Phases

1. **Scaffold + config + types.** Create package, manifest, add to root `workspaces`. Add the `autoGuardianConfig` `$def` + `extensions.autoGuardian` property to `schemas/crumbs.schema.json`. Implement `types.ts`, `config.ts` (reads `extensions.autoGuardian` via `loadEffectiveExtensionConfig`, applies defaults, compiles regex; + tests). `index.ts` loads config on `session_start` and registers a `tool_call` that allows everything (`mode` honored). Verify extension loads after `/reload`.
2. **Deterministic gate (core deliverable).** `request.ts`, `paths.ts`, `classify.ts`, `prompt.ts`, `gate.ts`. Covers bash deny/prompt, write/edit protected-path + outside-workspace blocks, unknown-tool action, user prompt, fail-closed when `!ctx.hasUI`. This phase is independently shippable and is the product. Tests: `classify.test.ts`, `paths.test.ts`.
3. **apply_patch + size policy.** `patch.ts` header parsing; wire into `request.ts`/`classify.ts`; `maxBytes`. Test: `patch.test.ts`.
4. **Optional guardian (off by default).** `guardian.ts` with injectable deps; wire `guardian` branch in `gate.ts`. Test: `guardian.test.ts` with a fake `complete`.
5. **Docs.** Add `index.ts` header and `extensions/auto-guardian/README.md` (purpose, config surface, behavior). Only at this point so README churn stays low.

## Testing

Unit (`bun test extensions/auto-guardian`):

- `classify.test.ts`: deny vs prompt vs allow for representative bash commands; mutation inside vs outside workspace; protected path; apply_patch unparseable → prompt; guardian branch returned only when enabled.
- `paths.test.ts`: canonicalization of existing + non-existing paths; `insideWorkspace` true/false; glob match for `.git/**`, `*.env`, nested `**`.
- `patch.test.ts`: extract paths from add/update/replace/delete/move headers; unparseable patch → empty + flag.
- `config.test.ts`: defaults when `extensions.autoGuardian` absent; values read from a crumbs-shaped object; invalid regex skipped; `mode: "off"`; `guardian.model` parsed to `{ provider, id }`.
- `guardian.test.ts`: valid JSON allow/deny; malformed → retry → success; double-malformed → error; injected `complete` returning `stopReason: "error"` → error outcome.

Manual (run `/reload` first):

- `read` / `grep` run with no prompt in `gate` mode.
- harmless `bash` (`ls`, `git status`) runs without prompt (default allow).
- `rm -rf /` is blocked, not promptable.
- `sudo ...` or `git push --force` prompts; choosing Deny blocks.
- `write`/`edit` to `.git/...` blocked; to a normal workspace file runs.
- write to an absolute path outside cwd blocked (with `allowOutsideWorkspace: false`).
- `apply_patch` (codex-compat active) parses targets and applies same policy; malformed patch prompts.
- With `guardian.enabled: true`: harmless command auto-approved; risky command denied → prompt; kill network / bad model → prompt; no UI → blocked.
- `mode: "off"` disables all gating.

## Decisions (resolved)

- **Hard deny is final.** Denylist hits, protected paths, and outside-workspace writes always block and are never overridable by guardian or user. Guardian deny and classifier "prompt" are user-overridable via the prompt.
- **Guardian is optional and off by default.** The deterministic gate is the product. Guardian adds per-call latency + cost + a prompt-injection surface (it judges attacker-influenced command/patch text), so it is opt-in only.
- **Default action is allow for unmatched actions.** Pi ships no gating; this extension adds guardrails (block dangerous, prompt risky) without prompting on every benign command. `defaultAction: "prompt"` is available for a stricter posture.
- **Per-process scope.** Each spawned `pi` (e.g. `extensions/subagents`) loads its own gate instance; the gate is per-process, not global. Acceptable.
- **Web tools excluded** to avoid duplicating `extensions/web` permission logic.
- **No mutation of `event.input`.** Classify only; never silently rewrite a tool call.

## Remaining decision (non-blocking)

- Whether to add a session-scoped "allow for matching command/path" cache if prompts prove noisy. Deferred until phase 2 is used; revisit only with evidence of friction.

## Risks

- Guardian call inside the hook blocks tool execution for its duration; mitigated by opt-in default, `timeoutMs`, and `ctx.signal` wiring so Esc cancels.
- Regex denylist is heuristic; document patterns as tunable and keep hard-deny conservative to avoid false blocks on legitimate work.
- apply_patch parsing is approximate; on any parse failure the action prompts rather than silently allowing.
