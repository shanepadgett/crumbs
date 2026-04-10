# Codex Apply Patch Parity Plan

## Scope

This document is the implementation plan to bring `extensions/codex-compat/src/apply-patch.ts` to parity with upstream Codex `apply_patch` behavior.

It covers three layers:

1. the patch parser and patch applier in `extensions/codex-compat/src/apply-patch.ts`
2. adjacent local glue needed for true tool-surface parity, especially `extensions/codex-compat/index.ts` and `extensions/codex-compat/src/path-policy.ts`
3. approval/runtime behaviors that live outside the file today, but are part of the upstream `apply_patch` implementation contract

This is a plan only. No code changes are implied by this document.

## Goal

Match upstream Codex code behavior, not just the published markdown instructions, because the upstream code and docs diverge in a few important places.

The authoritative upstream references are:

- `codex-rs/apply-patch/src/parser.rs`
- `codex-rs/apply-patch/src/lib.rs`
- `codex-rs/apply-patch/src/seek_sequence.rs`
- `codex-rs/apply-patch/src/invocation.rs`
- `codex-rs/core/src/tools/runtimes/apply_patch.rs`

The markdown instructions in `codex-rs/apply-patch/apply_patch_tool_instructions.md` are useful, but they are secondary when they disagree with current code.

## Definition of parity

For this work, parity means all of the following:

- the same patch grammar is accepted or rejected for the same reasons
- hunks are matched the same way, in the same order, with the same leniency
- file writes, deletes, renames, and newline handling behave the same way
- the same invocation forms are recognized
- the same verification shape exists before execution when upstream does verification before execution
- any deliberate Pi-only safety or UX differences are called out explicitly as non-parity

If a behavior is intentionally kept stricter or safer in Pi, that should be documented as a conscious deviation. It should not be described as parity.

## Current state summary

The local implementation is good on the happy path, but it is not at parity.

Confirmed strengths today:

- supports `*** Begin Patch` / `*** End Patch`
- supports `Add File`, `Delete File`, `Update File`, and optional `Move to`
- supports multi-file patches
- supports multi-hunk file updates
- protects mutations to the current working tree via canonical path checks
- uses a mutation queue and full rollback on failure

Confirmed parity gaps today:

- no support for `*** End of File`
- no support for pure-addition update chunks on existing files
- no support for upstream lenient matching passes
- no support for upstream forward-only cursor behavior
- stricter and different top-level parsing behavior
- `Add File` parsing accepts invalid non-`+` body lines as content
- update hunk parsing does not model upstream chunk semantics closely enough
- add/update newline behavior differs from upstream
- move semantics differ from upstream
- existing-target behavior differs from upstream
- invocation parsing and pre-verification layers are missing entirely

## Upstream behaviors that must be treated as source of truth

Before implementation starts, the project should lock these behaviors in as the reference contract:

### Parser semantics

Upstream currently:

- trims outer whitespace before parsing
- accepts an empty patch body at parse time, then rejects it later at apply time with `No files were modified.`
- allows the first update chunk to omit the initial `@@`
- supports `*** End of File`
- treats blank lines inside update chunks as empty context lines
- treats `Move to` as valid only for `Update File`
- rejects pure rename hunks with no update chunks
- accepts absolute paths in the parser, even though the docs say paths are relative only

### Matching semantics

Upstream currently:

- applies chunks in order
- tracks a forward-only search cursor across chunks
- uses an optional single-line `change_context` to advance the search cursor
- finds `old_lines` using progressively more lenient matching:
  - exact match
  - ignore trailing whitespace
  - ignore leading and trailing whitespace
  - normalize common Unicode punctuation and spacing
- treats pure-addition chunks as insertion at EOF
- supports end-of-file-sensitive matching via `*** End of File`

### File mutation semantics

Upstream currently:

- writes added files directly
- deletes files non-recursively and rejects directories
- implements move as write-destination then delete-source
- normalizes updated output to end with a trailing newline
- does not do transactional rollback across previously applied file operations

### Invocation and verification semantics

Upstream currently:

- accepts direct `apply_patch <patch>`
- accepts the alias `applypatch <patch>`
- accepts shell-wrapped heredoc forms for bash/zsh/sh, PowerShell/pwsh, and cmd
- accepts optional `cd <path> && apply_patch <<...`
- rejects a raw patch body when it is not wrapped in an explicit `apply_patch` invocation
- precomputes structured file changes, unified diffs, and effective cwd before runtime execution

## Recommended scope split

Do not try to land everything as one patch. Split the work into four milestones.

### Milestone 1: parser and matcher parity inside the current cwd guard

Goal:

- make the local parser and patch engine match upstream behavior for patch-body input
- keep the current `path-policy.ts` cwd confinement temporarily so the work stays isolated

Outcome:

- near-parity for direct tool calls to Pi `apply_patch`
- still not full upstream parity because invocation and approval/runtime layers remain different

### Milestone 2: file mutation parity and output parity

Goal:

- align write/delete/move/newline/result semantics with upstream

Outcome:

- direct patch application behaves like Codex for adds, updates, deletes, renames, and summary output

### Milestone 3: invocation and verification parity

Goal:

- recreate the upstream layer that recognizes shell heredoc forms and precomputes file changes before execution

Outcome:

- the extension understands the same invocation surface as Codex
- approvals and review flows can consume structured diffs instead of raw patch text

### Milestone 4: approval/runtime and path-policy parity

Goal:

- close the remaining gaps caused by current Pi safety boundaries and missing approval/runtime machinery

Outcome:

- true end-to-end parity, or an explicit list of final intentional deviations

## Workstream A: freeze the parity contract with tests first

### Why this comes first

The current local implementation and the upstream implementation differ in ways that are easy to regress while fixing one another. A test-first parity harness prevents cargo-cult rewrites.

### Tasks

1. Add a dedicated parity test suite for `apply_patch` behavior.
2. Build fixture coverage from upstream parser, applier, invocation, and runtime tests.
3. Treat upstream code behavior as expected output when the upstream docs disagree.
4. Organize fixtures by layer:
   - parser acceptance/rejection
   - hunk matching
   - file mutation results
   - invocation parsing
   - verification output
5. Record which cases are intentionally not supported yet by milestone.

### Minimum fixture list

Parser fixtures:

- empty patch
- leading and trailing blank lines around patch markers
- add file with normal `+` lines
- add file with invalid bare lines
- update file with first chunk missing `@@`
- update file with `@@` followed by diff lines
- update file with blank lines inside a chunk
- update file with `*** End of File`
- update file with `Move to`
- update file with `Move to` and no hunks
- absolute paths
- relative paths

Matcher fixtures:

- exact match
- trailing-whitespace-only mismatch
- leading-and-trailing-whitespace mismatch
- Unicode dash and quote normalization
- repeated blocks later in the file
- repeated blocks earlier in the file after prior chunk moved the cursor forward
- pure addition at EOF
- `*** End of File` replacement and insertion
- multi-chunk file updates with separated edits

Mutation fixtures:

- add file new path
- add file existing path
- delete file
- delete directory rejection
- update file preserving intended content
- move file to new path
- move file to existing destination
- multi-file patch where a later file op fails

Invocation fixtures:

- direct `apply_patch`
- direct `applypatch`
- `bash -lc` heredoc
- `bash -c` heredoc
- `powershell -Command` heredoc
- `pwsh -NoProfile -Command` heredoc
- `cmd /c` heredoc
- `cd foo && apply_patch <<...`
- rejected `cd foo; apply_patch`
- rejected `cd foo || apply_patch`
- rejected extra commands before or after the apply_patch call
- rejected raw patch body without explicit invocation

### Fixture-suite acceptance criteria

- every known upstream behavior is represented by a local test or explicitly marked as deferred
- every local bug fixed in later milestones adds a permanent regression case here

## Workstream B: parser parity

### Parser current local gaps

The current parser in `extensions/codex-compat/src/apply-patch.ts` is not shaped like the upstream parser.

Confirmed differences:

- requires the first line to be exactly `*** Begin Patch` with no outer whitespace trimming
- does not support `*** End of File`
- does not model blank lines in update chunks the way upstream does
- treats update hunk bodies as generic line-prefix hunks instead of upstream chunk objects
- allows `Add File` body lines without a leading `+`
- does not model the upstream missing-first-`@@` rule cleanly

### Parser plan

1. Replace the current patch AST with one that mirrors upstream concepts:
   - `AddFile { path, contents }`
   - `DeleteFile { path }`
   - `UpdateFile { path, movePath, chunks }`
   - `UpdateFileChunk { changeContext, oldLines, newLines, isEndOfFile }`
2. Make top-level parsing trim outer whitespace before reading markers.
3. Allow empty patches at parse time.
4. Parse `Add File` content exactly like upstream:
   - only `+` lines contribute content
   - stop when a non-`+` line is reached
   - let the outer parser decide whether the next line is a valid new hunk or an error
5. Parse `Update File` chunks exactly like upstream:
   - optional `Move to`
   - optional first-chunk missing `@@`
   - later chunks require `@@`
   - blank line inside chunk becomes empty context line
   - `*** End of File` toggles end-of-file matching on the chunk
6. Match upstream error shape and line-number reporting closely enough for tests to be stable.
7. Treat upstream parser behavior as authoritative for absolute paths even if local policy later rejects them.

### Parser acceptance criteria

- parser fixtures match upstream acceptance and rejection behavior
- local parser output has enough structure to drive an upstream-shaped matcher without translation hacks

## Workstream C: matching-engine parity

### Matching-engine current local gaps

The current `applyHunks()` logic differs materially from upstream:

- exact contiguous matching only
- no whitespace leniency
- no Unicode normalization leniency
- no `change_context` cursor advancement model
- no end-of-file handling
- pure-addition chunks fail on existing files unless the file is empty
- search can fall back to the whole file, allowing a later chunk to match earlier content
- multiple matches cause hard failure instead of taking the first valid forward match

### Matching-engine plan

1. Replace `PatchHunk` application with an upstream-shaped replacement planner.
2. Split file contents into upstream-like logical lines:
   - remove the trailing empty line sentinel produced by final newline splitting
   - re-add one trailing newline after updates
3. Implement an internal `seekSequence()` equivalent with the same passes:
   - exact
   - `trimEnd()`
   - `trim()`
   - normalized Unicode punctuation and odd-space handling
4. Track a forward-only `lineIndex` across chunks.
5. If `changeContext` exists, search for that single line at or after `lineIndex`, then advance the cursor to the line after the match.
6. Search `oldLines` from the current cursor only.
7. If `isEndOfFile` is set, try matching from EOF first, then fall back to searching from the current cursor.
8. For pure-addition chunks where `oldLines` is empty, insert at EOF exactly like upstream.
9. Build replacements first, then apply them in descending index order.

### Matching-engine acceptance criteria

- all matcher fixtures pass
- repeated-block cases behave like upstream
- anchorless insertion at EOF works like upstream
- whitespace and Unicode-normalized matching work like upstream

## Workstream D: file mutation parity

### File-mutation current local gaps

Current local mutation behavior differs from upstream in several ways:

- add-file content does not necessarily end with a trailing newline
- updates preserve the original file’s final-newline state instead of normalizing to a trailing newline
- move uses `rename()` after writing the updated source file, while upstream writes destination then deletes source
- add rejects existing files up front
- move rejects existing targets up front
- rollback restores previous state on failure, unlike upstream

### File-mutation plan

1. Align file content output with upstream:
   - `Add File` contents end with trailing newline when authored as `+` lines
   - updated files always end with a trailing newline
2. Change move implementation to upstream order:
   - compute new contents
   - write destination
   - delete source
3. Re-check add and move overwrite behavior against upstream executor semantics and lock it down in tests.
4. Decide whether rollback stays.

### File-mutation decision: rollback

There are two valid paths:

- **Exact parity path:** remove transactional rollback and stop on first failure just like upstream.
- **Pi-safe path:** keep rollback, but document it as an intentional non-parity safety feature.

Recommendation:

- if the goal is literal parity, remove rollback
- if the goal is safer local UX, keep rollback and mark the tool as intentionally stricter than Codex

### File-mutation decision: result surface

Current Pi result details expose:

- `added[]`
- `updated[]`
- `deleted[]`
- `moved[{ from, to }]`

Upstream user-facing output is closer to:

- `Success. Updated the following files:`
- `A path`
- `M path`
- `D path`

Recommendation:

- keep structured Pi details if they are useful
- optionally add an upstream-compatible text summary
- do not call the result surface parity unless both text and semantics match the upstream contract you choose to emulate

### File-mutation acceptance criteria

- mutation fixtures pass
- final file contents match upstream behavior
- move behavior matches the chosen parity path
- the doc clearly states whether rollback remains an intentional deviation

## Workstream E: invocation and verification parity

### Why this is needed

`extensions/codex-compat/src/apply-patch.ts` only handles patch bodies. Upstream Codex has a separate layer that:

- recognizes shell invocation forms
- extracts heredoc patch text
- supports optional `cd &&`
- rejects implicit raw patches
- computes structured change previews before execution

Without this layer, the extension cannot claim full parity with upstream `apply_patch`.

### Invocation plan

1. Add a new local module dedicated to invocation parsing and verification.
2. Support these invocation forms:
   - `apply_patch <patch>`
   - `applypatch <patch>`
   - shell heredoc forms for bash/zsh/sh, PowerShell/pwsh, and cmd
   - optional `cd <path> &&`
3. Reject these forms like upstream:
   - raw patch body without explicit `apply_patch`
   - `cd foo; apply_patch ...`
   - `cd foo || apply_patch ...`
   - extra top-level commands before or after the apply_patch invocation
4. Precompute a verified action object before execution:
   - effective cwd
   - affected files
   - per-file change type
   - unified diff for updates
   - new content for updates
5. Decide where this layer lives in Pi:
   - inside the `apply_patch` tool only
   - inside bash/shell approval plumbing as a cross-tool recognizer

### Invocation recommendation

Implement this as a reusable local module, not inline inside `index.ts`, because it will be needed by both the `apply_patch` tool and any future approval/runtime layer that wants to inspect shell invocations.

### Invocation acceptance criteria

- invocation fixtures pass
- verified change previews exist before execution
- raw patch strings are rejected when they arrive through shell-like surfaces without explicit invocation

## Workstream F: approval and runtime parity

### Why this is outside the current file

In upstream Codex, apply-patch behavior is not only parser logic. It is also:

- a distinct approval surface
- per-file approval caching
- structured patch approval payloads
- sandbox-aware execution
- reuse of pre-approved patch decisions

### Approval-and-runtime plan

1. Define a local `ApplyPatchAction` / verified-change shape similar to upstream.
2. Feed structured file changes into approvals instead of only raw patch text.
3. Key approval caching by affected file path, not by the raw patch string.
4. Distinguish patch approval from shell approval.
5. If Pi gets sandbox attempts later, execute the verified patch under the active sandbox rather than bypassing it.

### Likely dependency

This work likely depends on the broader permissions and sandboxing design already explored in `docs/codex-permissions-sandboxing-cleanroom-report.md`.

### Approval-and-runtime acceptance criteria

- patch approvals are structured and path-scoped
- already approved patch actions can execute without re-prompting
- approval logic is separate from shell-command approval logic

## Workstream G: path-policy parity versus Pi safety

### Current local behavior

`extensions/codex-compat/src/path-policy.ts` currently:

- normalizes `@path` prefixes away
- resolves paths relative to `cwd`
- canonicalizes existing paths
- resolves missing paths through their nearest existing ancestor
- rejects any mutation path that escapes the canonicalized `cwd`

This is a good safety boundary, but it is stricter than upstream `apply_patch` parser and verifier behavior.

### Upstream behavior

Upstream accepts both relative and absolute paths, then relies on later policy and sandbox layers to decide whether the patch can actually run.

### Path-policy decision

There are three realistic options:

1. **Exact parity:** allow absolute paths and move safety decisions into sandbox/approval layers.
2. **Scoped parity:** keep cwd confinement for now and claim parity only inside the allowed root.
3. **Permanent safety deviation:** keep cwd confinement forever and document it as an intentional Pi-only restriction.

### Path-policy recommendation

Use option 2 first, then revisit after the broader permissions model exists.

That gives:

- fast progress on parser and matcher parity
- no immediate widening of file mutation authority
- a clear path to fuller parity later

### Path-policy acceptance criteria

- the chosen scope is documented in the tool docs and tests
- any remaining path differences are labeled as intentional non-parity

## Milestone breakdown

### Milestone 1 deliverables

- parity fixture suite added
- parser rewritten to upstream-shaped AST
- matcher rewritten to upstream semantics
- known path-policy differences documented

Exit criteria:

- direct patch-body application behaves like upstream for parser and matcher cases within the current cwd guard

### Milestone 2 deliverables

- newline behavior aligned
- add/delete/move semantics aligned
- result surface decision implemented
- rollback decision implemented and documented

Exit criteria:

- file mutation behavior matches the selected parity contract for direct tool calls

### Milestone 3 deliverables

- invocation parser added
- verified action and unified diff generation added
- shell heredoc forms covered by tests

Exit criteria:

- the extension can parse and verify the same invocation shapes as upstream

### Milestone 4 deliverables

- structured patch approval flow added
- path-scoped approval caching added
- sandbox/runtime integration plan completed or implemented
- path-policy final decision made

Exit criteria:

- remaining differences are either eliminated or documented as intentional product choices

## Risks

### 1. Mistaking upstream docs for upstream behavior

Known upstream doc/code drift exists already:

- docs say paths are relative only, code accepts absolute paths
- docs imply stricter `@@` behavior than code actually enforces
- docs describe multiple `@@` context jumps more loosely than current parser implementation supports

Mitigation:

- always verify against upstream code and tests, not docs alone

### 2. Accidentally widening file mutation authority

Parser parity and path-policy parity are different problems.

Mitigation:

- keep cwd confinement until the broader permissions model is ready, unless the project explicitly approves wider mutation scope

### 3. Losing local safety features silently

Rollback and path confinement are current local strengths.

Mitigation:

- treat any removal as an explicit product decision, not a side effect of refactoring

### 4. Matching regressions in edge cases

Whitespace, Unicode punctuation, repeated contexts, and end-of-file behavior are subtle.

Mitigation:

- parity fixture suite must land before the matcher rewrite

## Open decisions

These need answers before Milestone 2 finishes:

1. Is the goal exact parity, or parity within the current cwd sandbox?
2. Should rollback stay as a Pi-only safety feature?
3. Should absolute paths remain blocked until the permissions/sandboxing work exists?
4. Does the extension need only direct tool-call parity, or full invocation/approval/runtime parity?
5. Should user-facing text output mimic upstream exactly, or is structured Pi-native output preferred?

## Recommended order of execution

1. add parity fixtures
2. rewrite parser AST to match upstream concepts
3. rewrite matcher to upstream semantics
4. align newline and move semantics
5. make explicit decisions on rollback and path scope
6. add invocation parsing and verification
7. wire structured approvals and path-scoped caching
8. revisit full path-policy parity once sandboxing work exists

## Minimum success bar

The work can be called a success when all of these are true:

- a large upstream-derived fixture suite passes locally
- direct patch-body application matches upstream parser and matcher behavior
- file content and move semantics match the selected parity contract
- invocation support matches the chosen scope
- any remaining differences are documented as intentional, not accidental

## Final recommendation

Aim first for **behavioral parity inside the current cwd guard**.

That gets the biggest real compatibility win with the lowest risk. After that, decide deliberately whether full upstream path and approval/runtime parity is worth relaxing the current Pi safety model.
