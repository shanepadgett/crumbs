# Context management extension plan

Status: idea/design plan only. No implementation yet.

## Why this exists

Token cost is becoming primary constraint. Need reduce prompt tokens without making agent dumber.

Headroom points in useful direction: compress big context, protect cache/live zones, make dropped detail retrievable. But Pi can do better because Pi sees typed session messages and typed tool events before provider payload serialization.

Core bet: **manage context lifecycle at Pi tool/message layer, not after-the-fact provider JSON compression.**

## Core thesis

Build a Pi extension that treats context as memory tiers:

- **Hot**: exact tokens sent to model now.
- **Warm**: compact capsule in prompt with enough signal to reason and a retrieval handle.
- **Cold**: exact artifact stored locally, searchable/retrievable, not sent by default.
- **Stale**: old snapshot invalidated by later file/tool state changes.
- **Tombstoned**: duplicate/superseded context hidden from prompt unless explicitly retrieved.

This is not long-term memory. It is session-local context virtualization.

## Design invariants

- Never silently destroy evidence. If data leaves prompt, it remains retrievable by artifact id.
- Never present stale file/tool data as current.
- Keep exact recent evidence longer than old summaries.
- Prefer deterministic extraction/masking before LLM summarization.
- Preserve user constraints verbatim.
- Preserve exact file paths, symbols, commands, error messages, stack roots, exit codes, and edit decisions.
- Avoid token-pruning code/diffs/errors. It saves tokens but breaks syntax and evidence.
- Tool schemas and extension prompt text also cost tokens; keep added tool surface tiny.

## What Headroom gets right

- Compression should be content-aware, not blind truncation.
- Reversible compression is safer than irreversible summaries.
- Stale/superseded `Read` output is prime context waste.
- Cache/live-zone safety matters when rewriting provider payloads.
- Recent active context must be protected.

## Where Pi can be better

- Pi knows `read`, `grep`, `bash`, `edit`, `write`, `toolResult`, and message roles directly.
- Pi can override built-in tools, so waste can be prevented at source.
- Pi can use session tree/branch data and compaction hooks.
- Pi can keep full exact artifacts locally with branch-aware metadata, not short TTL hashes.
- Pi can update stale state when edits/writes happen, instead of guessing from serialized text.

## Extension shape

Potential name: `context-cache`, `lean-context`, or `context-os`.

Use Pi extension APIs:

- `pi.registerTool()` for retrieval/search tools and built-in tool overrides.
- `pi.on("tool_result")` for artifact capture and output compaction.
- `pi.on("tool_call")` for input tracking and mutation invalidation prep.
- `pi.on("context")` for non-destructive prompt view rewriting.
- `pi.on("session_before_compact")` for custom continuation dossiers.
- `pi.on("session_start")` for ledger reconstruction from session/artifact metadata.
- `pi.getActiveTools()` / `pi.setActiveTools()` only if we need tool-set presets; first design should use same tool names via override to avoid model retraining.

## Main components

### 1. Artifact store

Stores exact cold data locally.

Default location should be outside project tree, probably under Pi user data, keyed by session file hash/id. Project-local `.pi/context-cache` is optional and should require opt-in because tool outputs may contain secrets.

Artifact fields:

- `id`
- `sessionId` or session file hash
- `entryId` if known
- `toolCallId`
- `toolName`
- `input`
- `createdAt`
- `cwd`
- `contentPath`
- `contentSha256`
- `byteLength`
- `lineCount`
- `summary`
- `preview`
- `contentKind`: `file`, `log`, `grep-results`, `json`, `search-results`, `plain-text`, `image`, `diff`, etc.
- `sourceFiles`: paths with hashes/mtimes when applicable
- `baseTag` / `fileHash`: current file snapshot fingerprint for grounded edits
- `lineRangesSeen`: exact line ranges already exposed to model
- `snapshotPath`: optional exact file snapshot for stale comparison/recovery
- `state`: `hot`, `warm`, `cold`, `stale`, `tombstoned`
- `staleReason`
- `retrievalCount`
- `lastRetrievedAt`
- `pinnedUntilTurn`

### 2. Context ledger

In-memory index rebuilt on session start from artifact manifests and session entries.

Tracks lifecycle relationships:

- read snapshots per file/range/hash
- edits/writes per file
- grep results per query/scope and touched files
- bash commands and likely affected files
- retrieved artifacts and promoted excerpts
- compaction summaries and referenced artifacts

Ledger is source of truth for what context is current, stale, duplicate, or relevant.

### 3. Smart tool overrides

Override built-ins where source-level savings justify risk. Preserve original tool names and result shapes as much as possible so UI/session logic still works.

#### Smart `read`

Same public input: `path`, `offset`, `limit`.

Behavior:

- If `offset`/`limit` provided: return exact requested lines.
- If file small: return exact file.
- If file was already read with same hash and range: return compact “unchanged since artifact X” plus known ranges, not whole file again.
- Optionally emit grounded-edit anchors: file snapshot tag + line-numbered lines for ranges exposed to model.
- If file large with no range:
  - return outline/map first: imports, exports, classes/functions, symbols, line ranges, TODO/error markers.
  - include relevant excerpts based on current user prompt, active files, grep hits, error lines.
  - store full exact file snapshot as artifact.
  - instruct model to request exact ranges when needed.
- If file changed since previous read: mark older snapshots stale and say so.

Partial-read supersession rules:

- New full read supersedes old partial reads if same or newer hash.
- New partial read supersedes old partial only when range covers old range and hash matches.
- Edit/write invalidates all older reads of affected file.

Need be careful: user may expect exact full file after `read`. Smart read should maybe have modes:

- default exact up to safe limit
- auto-outline only above threshold
- exact range always available

#### Smart `grep`

Behavior:

- Return top relevant hits and grouped counts by file.
- Store full hit set.
- Preserve exact file:line:text for top hits.
- Mark result stale when matched file changes.
- Re-running same query/scope supersedes old result.

#### Smart `bash`

Behavior for large output:

- Preserve command, cwd, timeout, exit code, duration.
- If success and verbose: collapse aggressively.
- If failure: keep high-signal lines exact:
  - first error
  - final error summary
  - assertions
  - stack roots
  - file:line refs
  - last N lines
- Store full output.
- Provide retrieval/search handle.

Staleness:

- Test/build output becomes stale when files likely involved change.
- If exact dependency set unknown, mark “possibly stale” after any code/test edit.
- Newer run of same command supersedes older run.

#### Smart `ls` / `find`

Behavior:

- Return compact directory summary for huge results.
- Store full listing.
- Mark stale when files under listed roots change.

#### `edit` / `write` wrappers

Primary job is invalidation, not compression.

On success:

- record changed path
- compute new file hash if possible
- mark prior reads of path stale
- mark grep results touching path stale
- mark repo-map chunks dirty
- mark related bash/test results possibly stale

### 4. Grounded edit / hybrid patch layer

`external/oh-my-pi` hashline is a strong candidate for edit grounding, but not as a standalone context manager.

Important discovery: hashline is **not per-line hashes**. It uses:

- file-section header like `¶path#TAG`
- `TAG` = whole-file content fingerprint from latest read/search/write/edit
- edit anchors = line numbers from exposed output
- full-file snapshot store for stale detection and recovery

This layer can make file context purge safer: once model has seen `path + tag + lines`, old read bodies can be collapsed while edits remain grounded by tag and retrievable snapshots.

#### Grounded read output

When edit grounding is enabled, smart `read` / `grep` can return:

```text
¶src/foo.ts#A1B2C3D4
42:const timeout = 30;
43:run(timeout);
```

Use longer tags than oh-my-pi's 4 hex. Candidate: 8-12 hex from normalized full-file SHA/xxhash. Four hex is too collision-prone for long sessions.

#### Hashline-style edit semantics

Candidate edit ops:

```text
replace 42..42:
+const timeout = 60;
delete 80..95
insert after 120:
+export const enabled = true;
```

Benefits:

- no old lines repeated in edit payload
- very cheap deletes (`delete 80..95` instead of 16 `-` lines)
- insert anchors do not require copied context
- stale edits can fail or recover based on snapshot tag
- fresh tag after edit forces re-grounding

Limits:

- line-numbered read/search output adds tokens up front
- small one-line edits may tie current patch format
- new files, moves, and whole-file rewrites are still better served by apply-patch style sections
- `replace block N` needs tree-sitter/native resolver; skip in MVP or make optional

#### Hybrid grounded patch format

Best candidate: keep apply-patch envelope and multi-file batching, but allow hashline-style update bodies.

Example:

```patch
*** Begin Patch
*** Update File: src/foo.ts
*** Base: A1B2C3D4
replace 42..42:
+const timeoutMs = 60_000;
delete 80..95
insert after 120:
+export const enabled = true;
*** Update File: src/bar.ts
*** Base: 91AF20CC
replace 10..12:
+function run() {
+  return start();
+}
*** End Patch
```

Keep from `apply_patch`:

- one coherent multi-file call
- `Add File`, `Replace File`, `Update File`, `Delete File`, `Move to`
- path policy, mutation queue, renderer/summary flow
- model habit of doing coordinated changes once instead of many calls

Borrow from hashline:

- `*** Base: TAG` validates model's file view
- line-range update operations
- final-content-only `+` body rows
- stale mismatch rejection/recovery
- fresh base tag in result

Semantics:

- `Update File` may use classic old/new chunks or grounded line ops, but not both in same section.
- `*** Base:` required for grounded line ops.
- `*** Base:` optional but useful for `Delete File` / `Replace File` to prevent stale destructive actions.
- Multi-file grounded patch should preflight every section before any write. If one section is stale/invalid, no files change.
- On stale mismatch, error should tell model to re-read current ranges, not widen edit.

Token impact:

- biggest win for deletes, insertions, and block replacements because old lines are omitted
- little/no win for new files or full file replacement
- net positive only if read/search anchors can later be collapsed from hot context

Implementation stance:

- do not mutate `extensions/codex-compat` `apply_patch` blindly
- prototype as `apply_grounded_patch` or context-manager-local `grounded_patch`
- if stable, consider accepting grounded sections in existing `apply_patch` for compatible models
- keep Codex compat `apply_patch` unchanged until test evidence says hybrid improves success/cost

### 5. Retrieval tools

Keep small surface. Likely only two tools.

#### `context_retrieve`

Inputs:

- `id`
- optional `range` (`"120-180"`, `"tail:200"`, `"head:80"`)
- optional `query`
- optional `maxBytes` bounded by extension default

Behavior:

- Return exact slice or query hits.
- Include artifact metadata and stale/current status.
- Promote returned excerpt to hot context for a few turns.
- Never dump huge full artifact unless explicitly chunked.

#### `context_search`

Inputs:

- `query`
- optional `scope`: `"artifacts" | "files" | "all"`
- optional `kind`
- optional `path`

Behavior:

- Search artifact store and maybe repo index.
- Return ranked small result list with ids, snippets, stale status.

Do not add many specialized tools unless real usage proves need. Tool schemas cost tokens and confuse model.

### 6. Context compositor

Runs in `context` hook. It rewrites the prompt view only; session history remains intact.

Responsibilities:

- Replace old large tool results with capsules.
- Remove tombstoned duplicates.
- Mark stale snapshots clearly.
- Keep recent raw failures and active file excerpts.
- Inject concise “active context index” when useful.
- Respect budget from `ctx.getContextUsage()` and model context window.

Compositor budget categories:

- latest user prompt: always exact
- current turn tool results: exact unless massive and safely compressible
- active files/current edits: high priority
- unresolved failures: high priority
- user constraints: high priority, verbatim
- recent conversation: medium/high
- old successful logs/listings: low
- stale/superseded reads: omit or capsule only
- old thinking: lowest, remove first if available

Capsule format should be compact and machine-readable enough:

```xml
<context-capsule id="ctx_ab12" tool="bash" state="current" bytes="184203" lines="4210">
Command: npm test
Exit: 1
Signal: 3 failing tests; first failure in src/foo.test.ts:42
Kept: error lines, stack roots, final summary
Retrieve: context_retrieve({"id":"ctx_ab12","query":"..."})
</context-capsule>
```

Stale capsule example:

```text
[stale read omitted] ctx_a13 src/foo.ts lines 1-420. File changed later by edit ctx_b77. Use read for current file; retrieve ctx_a13 only for old snapshot comparison.
```

### 7. Lifecycle manager

State transitions:

- `created -> hot`: new high-signal, current-turn evidence.
- `hot -> warm`: old but referenced/possibly useful.
- `warm -> cold`: not recently referenced, recoverable.
- `hot/warm/cold -> stale`: source changed or newer run supersedes truth.
- `any -> tombstoned`: duplicate/superseded with no current value.
- `cold/warm -> hot`: model retrieves or user references artifact/path/symbol.

Promotion signals:

- user mentions path/symbol/error/command
- assistant retrieves artifact
- recent edit touches file
- grep hit points to file
- failure stack points to file
- active plan/summary references artifact

Demotion signals:

- age in turns
- newer read/run/search supersedes it
- success log with no unresolved issue
- low lexical overlap with current prompt
- stale due to edit/write
- duplicate content hash

### 8. Relevance scorer

Start deterministic. Avoid embeddings in MVP.

Potential score:

```text
score = recency
      + user_mention
      + active_file
      + unresolved_failure
      + edit_proximity
      + retrieval_pin
      + summary_reference
      - stale_penalty
      - duplicate_penalty
      - token_cost_penalty
```

Score does not decide truth. It only decides hot/warm/cold presentation.

Later optional:

- semantic search over artifacts/repo chunks
- reranker for query-to-artifact relevance
- repo graph centrality/PageRank-like symbol importance

### 9. Repo map / file map

This is likely biggest intelligence-preserving token saver after tool-output offload.

For large files and large repos, give model orientation without full text.

File map:

- path
- language
- imports/exports
- top-level symbols
- function/class names with line ranges
- comments/doc headings maybe
- changed line ranges since base git rev

Repo map:

- selected relevant files
- symbol graph edges where cheap
- git modified files
- recent read/edited files
- search hits

MVP can use regex/tree-sitter optional later. Start with lightweight language heuristics and ripgrep-style symbol scans.

### 10. Custom compaction

Replace default summary with “continuation dossier.”

Must preserve:

- user goal
- user constraints verbatim
- active files with current hashes
- changes made
- unresolved failures
- failed attempts
- key decisions and rationale
- exact commands that matter
- cold artifact index
- stale warnings

Template:

```md
## Goal

## User Constraints (verbatim)

## Current Workset

- path @ hash: why active

## Changes Made

## Unresolved Failures

- exact error / command / artifact id

## Failed Attempts

## Key Decisions

## Cold Artifacts

- ctx_ab12: bash npm test, current/stale, retrieve hint

## Stale Context Warnings
```

Summaries should cite artifact ids instead of pretending to contain full evidence.

## Purging strategy

“Purge” means remove from active prompt, not delete from disk/session.

What to purge first:

1. Old assistant thinking blocks.
2. Superseded full file reads with same hash/range.
3. Stale reads after edit/write.
4. Old successful bash output.
5. Old grep/find/ls output superseded by newer query or file changes.
6. Verbose logs where failure has been fixed by newer successful run.
7. Large raw outputs after capsule stored.

What not to purge without capsule:

- latest user request
- active constraints/preferences
- unresolved error details
- current diff/edit result
- tool call arguments needed to understand following tool result
- current file slices being edited

## Evaluation plan

Need prove token savings do not destroy solve rate.

Test scenarios:

- Long test log: model must fix failing test after output collapsed.
- Stale read: file read, edited, then ask about current code; model must not use old content.
- Superseded read: same file read multiple times; only newest/current should remain hot.
- Grep flood: huge search results; model must still find relevant hit via retrieval.
- Large file read: model gets map, then requests exact lines and edits correctly.
- Grounded delete: remove large line range without sending old deleted lines.
- Grounded insert/replace: edit by base tag + line anchors after old read was collapsed.
- Stale grounded patch: file changes after read; patch must reject/recover safely, not corrupt duplicate text.
- Hybrid patch batch: multi-file grounded update preflights all sections and avoids partial writes.
- Multi-turn task after compaction: summary + capsules preserve decisions and next steps.
- Needle recovery: hidden artifact contains exact string needed; retrieval should find it.
- Cost regression: measure tokens before/after per turn.

Metrics:

- input tokens saved
- output/tool-call overhead added
- retrieval call count
- grounded patch success/failure/re-read rate
- successful task completion rate
- stale-context mistakes caught
- missed-context incidents
- compaction quality defects

## Implementation phases

### Phase 0: API spike, no behavior change

- Confirm built-in override result shapes for `read`, `grep`, `bash`, `edit`, `write`.
- Confirm `context` hook can safely rewrite old tool result messages.
- Confirm session branch reconstruction and stable session id/access paths.
- Decide artifact store location and retention policy.

### Phase 1: Passive ledger/audit

- Track tool results and file operations.
- Show `/context-status` style report with biggest token hogs and stale candidates.
- No prompt mutation yet.

### Phase 2: Artifact store + retrieval

- Store large tool results exactly.
- Add `context_retrieve` and maybe `context_search`.
- Do not compress active context yet, but prove recovery path.

### Phase 3: Context hook masking

- Replace old large tool results with capsules in prompt view.
- Start with conservative thresholds and only old results.
- Keep current turn exact.

### Phase 4: Smart `bash` and `grep`

- Condense giant outputs at source.
- Keep exact important failures.
- Store full artifacts.

### Phase 5: Smart `read`

- Add same-hash dedupe and stale invalidation first.
- Add large-file outline mode after retrieval is solid.
- Exact range reads stay exact.
- Add optional line-number/base-tag output for ranges that may feed grounded edits.

### Phase 6: Grounded patch prototype

- Prototype `apply_grounded_patch` or `grounded_patch` rather than changing codex-compat `apply_patch` first.
- Keep apply-patch envelope and multi-file sections.
- Add `*** Base: TAG` plus hashline-style `replace` / `delete` / `insert` ops for `Update File`.
- Require all-section preflight before writes.
- Return fresh base tags and compact diffs.
- Compare token cost and edit success against current `apply_patch`.

### Phase 7: Invalidation wrappers

- Wrap `edit`/`write` to mark stale reads/grep/results.
- Add bash mutation heuristics only if safe enough.
- Mark base tags/snapshots stale after mutation.

### Phase 8: Custom compaction

- Generate continuation dossier with artifact index.
- Keep default compaction available as fallback.

### Phase 9: Repo map and semantic/rerank experiments

- Add file/repo map.
- Add optional embeddings or reranker only if deterministic approach is insufficient.
- Consider LLMLingua-style compression only for prose/doc blobs, never code/log/error/diff.

## Major risks

- Tool override breaks UI/session expectations if result details shape drifts.
- Capsule hides detail model needed, causing extra retrieval turns or wrong edits.
- Stale detection incomplete for bash side effects.
- Artifact store leaks sensitive outputs if persisted too long or in project tree.
- More tools/schema text eats savings.
- LLM summaries over-smooth failed attempts and lose useful negative evidence.
- Aggressive large-file outline can make model miss local implementation detail.
- Weak base tags can collide; do not copy oh-my-pi's 4-hex tag length.
- Line-numbered output can increase read/search token cost if not paired with later purge or grounded edits.
- Grounded patch instructions may confuse models trained on unified/apply_patch diffs.
- Stale-recovery logic can corrupt files if too permissive; prefer reject/re-read over fuzzy recovery.

## Guardrails

- Conservative defaults.
- Exact retrieval always available.
- Stale warnings explicit.
- No compression of latest turn until proven safe.
- No hidden deletion.
- Easy command to disable extension or show original context decisions.
- Token savings visible to user.
- Every capsule carries reason and retrieval path.
- Grounded destructive edits require current base tag unless explicitly using full-file replace/create.
- Hybrid patch prototype must fail closed on stale base or ambiguous anchors.

## Open questions

- Should artifact store be per-session in user Pi dir or project-local opt-in?
- How much can `context` hook rewrite without confusing session tree display?
- Can tool result `details` carry enough artifact metadata for branch-aware rebuild?
- Should smart read default to exact until over threshold, or should model be trained to request outlines first?
- Is one retrieval tool enough, or does file-range retrieval deserve separate tool?
- Should context compositor ever remove assistant text, or only tool results/thinking?
- Can we estimate tokens accurately enough without provider tokenizer?
- How do we expose “why context was hidden” without adding too much UI noise?
- Should grounded patch be separate tool forever, or become accepted syntax inside `apply_patch` after proof?
- What base tag length/hash gives good collision safety without too much prompt overhead?
- Should smart read emit line-number/base-tag anchors always, only above pressure, or only after model asks for editable context?
- Can we reuse current codex-compat renderer/parser safely, or should grounded patch live in context-manager code first?

## Current recommendation

Build this as a Pi-native extension, but do it in stages.

First solid win: **artifact store + retrieval + context masking of old large tool results**. This gives large token savings with low intelligence risk.

Second win: **stale/superseded read lifecycle**. This directly attacks one of biggest coding-agent wastes.

Third win: **smart tool overrides**, starting with `bash` and `grep`, then `read` after exact retrieval/ranges are reliable.

Fourth win: **grounded hybrid patch**, after smart read can mint base tags. Keep current `apply_patch` unchanged initially; prototype separate tool, then merge only if token/save-rate evidence is good.

Do not start with embeddings, token-pruning, or provider-payload surgery. Those are optional later layers, not foundation.
