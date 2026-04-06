# Codex Permissions Implementation Research

Scope: this document is based only on `external/codex/` implementation.

## Executive summary

Codex is built around a stricter separation of concerns than a typical “approval mode” system.

Its implementation splits permissions into:

1. **approval policy**: when prompts are allowed, required, or forbidden
2. **sandbox policy**: what the runtime can read, write, and access on the network
3. **execpolicy rules**: command-prefix allow/prompt/forbid logic with amendment support
4. **per-command overrides**: `UseDefault`, `RequireEscalated`, or `WithAdditionalPermissions`
5. **sticky grants**: turn-scoped and session-scoped `PermissionProfile` grants
6. **separate approval subsystems** for shell commands, network, apply_patch, request_permissions, and MCP tool calls

The key implementation takeaway is this: Codex does **not** treat permissions as one global mode. It combines sandbox enforcement, command policy, structured additional permissions, and approval orchestration as separate layers.

## Primary source files

### Core types and protocol

- `external/codex/codex-rs/protocol/src/protocol.rs`
- `external/codex/codex-rs/protocol/src/models.rs`
- `external/codex/codex-rs/protocol/src/permissions.rs`
- `external/codex/codex-rs/protocol/src/approvals.rs`
- `external/codex/codex-rs/protocol/src/request_permissions.rs`
- `external/codex/codex-rs/protocol/src/config_types.rs`

### Config and permission compilation

- `external/codex/codex-rs/core/src/config_loader/mod.rs`
- `external/codex/codex-rs/core/src/config/mod.rs`
- `external/codex/codex-rs/core/src/config/permissions.rs`
- `external/codex/codex-rs/core/src/config/network_proxy_spec.rs`

### Exec policy and tool approval orchestration

- `external/codex/codex-rs/core/src/exec_policy.rs`
- `external/codex/codex-rs/core/src/tools/sandboxing.rs`
- `external/codex/codex-rs/core/src/tools/orchestrator.rs`
- `external/codex/codex-rs/core/src/tools/handlers/mod.rs`
- `external/codex/codex-rs/core/src/codex.rs`

### Sandboxing runtime

- `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`
- `external/codex/codex-rs/sandboxing/src/manager.rs`
- `external/codex/codex-rs/sandboxing/src/seatbelt.rs`
- `external/codex/codex-rs/linux-sandbox/src/linux_run_main.rs`
- `external/codex/codex-rs/core/src/exec.rs`

### Tool-specific approval flows

- `external/codex/codex-rs/core/src/tools/handlers/shell.rs`
- `external/codex/codex-rs/core/src/tools/handlers/unified_exec.rs`
- `external/codex/codex-rs/core/src/tools/handlers/apply_patch.rs`
- `external/codex/codex-rs/core/src/tools/handlers/request_permissions.rs`
- `external/codex/codex-rs/core/src/tools/runtimes/shell.rs`
- `external/codex/codex-rs/core/src/tools/runtimes/unified_exec.rs`
- `external/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`
- `external/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs`
- `external/codex/codex-rs/core/src/tools/network_approval.rs`
- `external/codex/codex-rs/core/src/mcp_tool_call.rs`
- `external/codex/codex-rs/core/src/safety.rs`
- `external/codex/codex-rs/config/src/mcp_types.rs`

## 1. Core data model

### Approval policy is separate from sandbox policy

`protocol/src/protocol.rs` defines `AskForApproval`:

- `UnlessTrusted` serialized as `untrusted`
- `OnFailure`
- `OnRequest`
- `Granular(GranularApprovalConfig)`
- `Never`

`protocol/src/protocol.rs` separately defines `SandboxPolicy`:

- `ReadOnly`
- `WorkspaceWrite`
- `DangerFullAccess`
- `ExternalSandbox`

This split is the foundation of the whole implementation. Approval policy decides whether Codex may ask. Sandbox policy decides what the runtime can do.

### Granular approval has separate switches for different prompt classes

`GranularApprovalConfig` contains independent booleans for:

- `sandbox_approval`
- `rules`
- `skill_approval`
- `request_permissions`
- `mcp_elicitations`

Codex uses these separately. For example:

- execpolicy rule prompts consult `rules`
- sandbox escape or additional-permission prompts consult `sandbox_approval`
- `request_permissions` can be disabled independently

### Per-command overrides are modeled explicitly

`protocol/src/models.rs` defines `SandboxPermissions`:

- `UseDefault`
- `RequireEscalated`
- `WithAdditionalPermissions`

This is one of Codex’s most important design choices.

- `RequireEscalated` means “run outside the sandbox”
- `WithAdditionalPermissions` means “stay sandboxed, but widen permissions for this command”

Codex does not collapse those two ideas into the same flag.

### Additional permissions stay structured end to end

`protocol/src/models.rs` defines `PermissionProfile`:

- `network.enabled`
- `file_system.read`
- `file_system.write`

Shell-like calls can carry this directly via:

- `ShellToolCallParams.additional_permissions`
- `ShellCommandToolCallParams.additional_permissions`

So the permission request is not just a text justification. It is a typed payload.

### Approval results are structured, not boolean

`protocol/src/protocol.rs` defines `ReviewDecision`:

- `Approved`
- `ApprovedExecpolicyAmendment`
- `ApprovedForSession`
- `NetworkPolicyAmendment`
- `Denied`
- `Abort`

This matters because different approval surfaces can persist different kinds of state:

- session approval cache
- execpolicy rule amendments
- network policy amendments

## 2. Config and initialization model

### Config layers and requirements are loaded separately

`core/src/config_loader/mod.rs` loads:

- cloud requirements
- managed admin requirements
- system requirements
- system config
- user config
- project `.codex/config.toml` layers
- runtime session overrides

Requirements are not just another config layer. They are accumulated first and then enforced as constraints on the final config.

### Project trust affects both config loading and defaults

Project `.codex/config.toml` layers are loaded but disabled when the directory is not trusted.

`config/mod.rs` also uses trust to choose defaults:

- trusted project default approval policy: `OnRequest`
- untrusted project default approval policy: `UnlessTrusted`
- otherwise: default enum value, which is `OnRequest`

If no sandbox mode is configured but the directory has a trust decision, Codex defaults to `workspace-write`, except on Windows when sandboxing is unavailable, where it falls back to `read-only`.

### Codex supports two permission configuration styles

`config/mod.rs` resolves between:

1. legacy sandbox syntax using `sandbox_mode`
2. profile-based syntax using `[permissions]` plus `default_permissions`

`config/permissions.rs` compiles named permission profiles into:

- `FileSystemSandboxPolicy`
- `NetworkSandboxPolicy`

and `config/mod.rs` also derives a `NetworkProxySpec` from the same profile network config.

So profile-based permissions can express more than just `network.enabled`; they can also carry domain rules, unix socket rules, and local binding settings through the network proxy config path.

### Legacy and split sandbox policies coexist

`config/mod.rs` stores both:

- legacy `SandboxPolicy`
- split `FileSystemSandboxPolicy`
- split `NetworkSandboxPolicy`

This is important because Codex’s newer filesystem model can represent things the legacy sandbox enum cannot fully express.

### Managed requirements can constrain both approval and sandbox choices

`config/mod.rs` loads `Constrained<AskForApproval>` and `Constrained<SandboxPolicy>` from requirements.

If a user or default value is disallowed:

- Codex logs a warning
- falls back to the requirement-compliant value

So requirements are not advisory. They actively narrow the effective runtime configuration.

## 3. Split filesystem and network sandbox model

### Split filesystem policy is richer than the legacy sandbox enum

`protocol/src/permissions.rs` defines:

- `FileSystemSandboxPolicy { kind, entries }`
- `FileSystemAccessMode = read | write | none`
- `FileSystemPath = absolute path | special path`

Special paths include things like:

- root
- current working directory
- project roots
- tmpdir
- slash tmp
- minimal platform defaults

This gives Codex a path-entry model that is more expressive than just “read-only vs workspace-write”.

### Writable roots get protected read-only carveouts by default

When Codex converts legacy `WorkspaceWrite` to split filesystem policy, `protocol/src/permissions.rs` automatically protects top-level metadata under writable roots:

- `.git`
- `.agents`
- `.codex`

Implementation detail:

- `.git` pointer files are followed to the real gitdir and that target is also protected
- workspace-root `.codex` is protected even when it does not exist yet, so first-time creation still goes through approval flow

This is a strong design pattern. Codex does not treat writable workspace roots as unqualified write access.

### Symlink-sensitive carveouts are preserved deliberately

`protocol/src/permissions.rs` keeps raw protected subpaths like `.git` and `.codex` when building writable roots, even if they are symlinks.

That is done so downstream sandboxes can mask the symlink inode itself, not only the resolved target.

### Helper runtime roots are added explicitly

`config/permissions.rs` adds readable roots required for Codex runtime operation, such as:

- configured zsh path
- execve wrapper path
- some Codex helper runtime paths under `codex_home/tmp/arg0`

These are internal runtime carveouts, not user-authored grants.

### Split policy may require direct runtime enforcement

`FileSystemSandboxPolicy::needs_direct_runtime_enforcement(...)` checks whether the split policy can round-trip through a legacy `SandboxPolicy` without semantic loss.

When it cannot:

- Linux sandbox runtime keeps the split policies directly
- Windows overlay logic may reject unsupported combinations rather than silently weakening them

This is a major implementation clue: Codex knows the legacy projection is lossy and has explicit runtime logic to avoid pretending otherwise.

## 4. Exec policy is the main command-decision engine

`core/src/exec_policy.rs` is the command approval heart of Codex.

### Exec policy rules are loaded from config folders

Codex loads `*.rules` files from each config folder’s `rules/` directory in increasing precedence order, then merges any requirements overlay.

Parse errors are treated specially:

- parse failures become warnings and leave Codex with an empty policy
- read failures still error normally

So a malformed policy file degrades to warn-and-empty instead of crashing the whole permissions system.

### The decision output is `Skip`, `NeedsApproval`, or `Forbidden`

`ExecPolicyManager::create_exec_approval_requirement_for_command(...)` returns:

- `Skip { bypass_sandbox, proposed_execpolicy_amendment }`
- `NeedsApproval { reason, proposed_execpolicy_amendment }`
- `Forbidden { reason }`

That result is later fed into the tool orchestrator.

### Known-safe commands and dangerous commands take different paths

For unmatched commands, `render_decision_for_unmatched_command(...)` does this:

1. allow known-safe commands immediately
2. treat dangerous commands specially
3. consider whether the environment effectively lacks sandbox protection
4. then apply approval-policy-specific fallback behavior

Examples from the implementation:

- dangerous commands under `OnRequest` prompt even in `DangerFullAccess`
- on Windows, `ReadOnly` is treated as lacking meaningful sandbox protection for this fallback logic
- `UnlessTrusted` prompts for any unmatched command that is not already known-safe

### `OnRequest` does not mean “prompt for every shell command”

This is a critical implementation detail.

For shell and unified exec, Codex does **not** blindly prompt under `OnRequest`.

If a command is:

- known safe, or
- non-dangerous and running within the restricted sandbox without override,

the execpolicy fallback can return allow.

So `OnRequest` really means the model may ask when needed, not that every command causes a dialog.

### Execpolicy allow rules can bypass sandbox entirely

When an allow result comes from a real policy prefix rule rather than a heuristic allow, `create_exec_approval_requirement_for_command(...)` returns `Skip { bypass_sandbox: true }`.

That means a policy rule can intentionally greenlight running the first attempt unsandboxed.

This is stronger than a mere “don’t prompt” signal.

### Prompt and forbidden reasons are policy-aware

If a prefix rule carries a justification, Codex surfaces that in the approval or rejection reason.

So policy files can explain:

- why a command needs approval
- why it is forbidden
- which safer alternative the user should prefer

### Codex can propose execpolicy amendments

When a command reaches prompt or allow through heuristics instead of policy rules, Codex may attach a `proposed_execpolicy_amendment`.

There are two paths:

1. user-provided `prefix_rule` suggestion from the tool call
2. auto-derived amendment from the first prompt-worthy or allow-worthy heuristic match

Codex rejects dangerous amendment suggestions for prefixes like:

- `python`
- `bash`
- `sh -c`
- `zsh -lc`
- `env`
- `sudo`
- interpreter `-e` / `-c` forms

It also checks that the proposed prefix would approve every parsed command in the command sequence before surfacing it.

When the user chooses `ApprovedExecpolicyAmendment`, `codex.rs` persists the prefix to `${codex_home}/rules/default.rules` and updates in-memory policy immediately.

## 5. Sandboxing and additional permissions

### Additional permissions are normalized and merged before execution

`sandboxing/src/policy_transforms.rs` canonicalizes additional permission paths and provides:

- `normalize_additional_permissions(...)`
- `merge_permission_profiles(...)`
- `intersect_permission_profiles(...)`

This is used to:

- merge requested permissions with already granted turn/session permissions
- test whether a new request is already covered by prior grants

### Additional permissions change the actual sandbox, not just the UI

`sandboxing/src/manager.rs` takes `SandboxCommand.additional_permissions` and computes:

- `effective_sandbox_policy`
- `effective_file_system_sandbox_policy`
- `effective_network_sandbox_policy`

Then it passes those effective policies into the sandbox transform.

So `WithAdditionalPermissions` is runtime-enforced policy widening, not just a prompt annotation.

### Widening behavior is additive

`policy_transforms.rs` adds:

- extra readable roots
- extra writable roots
- network enablement when requested

It does **not** drop existing deny entries or protected carveouts.

### Read-only plus write permissions is currently approximated

There is one notable implementation nuance.

If the base sandbox policy is `ReadOnly` and additional permissions request writes, `policy_transforms.rs` upgrades the effective legacy policy to `WorkspaceWrite` with those write roots.

The code comment explicitly says this currently grants more access than the request and would ideally need a new sandbox policy variant.

So Codex knows this is an approximation, not a perfect representation.

### Managed network requirements can force sandbox usage

`policy_transforms.rs` makes `should_require_platform_sandbox(...)` return true whenever managed network requirements exist.

That means sandbox selection is not only about local filesystem restrictions. Managed network policy can also force a real platform sandbox.

## 6. Sticky permission grants and `request_permissions`

### Codex supports turn-scoped and session-scoped permission grants

`protocol/src/request_permissions.rs` defines:

- `PermissionGrantScope::Turn`
- `PermissionGrantScope::Session`

`codex.rs` stores granted permissions in:

- turn state for turn-scoped grants
- session state for session-scoped grants

### Previously granted permissions are merged into later requests

`tools/handlers/mod.rs` implements `apply_granted_turn_permissions(...)`.

It merges:

- requested permissions
- granted turn permissions
- granted session permissions

If the effective permission profile is fully covered by already granted permissions, `permissions_preapproved` becomes true.

That is how Codex turns one approval into future automatic coverage for a subset of later requests.

### Sticky grants can implicitly switch a command into the additional-permissions path

If a command did not explicitly request `WithAdditionalPermissions` but effective granted permissions exist, `apply_granted_turn_permissions(...)` upgrades the runtime sandbox permission mode to `WithAdditionalPermissions` automatically.

That is a subtle but important implementation detail: permission grants are part of execution state, not just history.

### Fresh inline permission requests are tightly constrained

`normalize_and_validate_additional_permissions(...)` enforces:

- `additional_permissions` requires `sandbox_permissions = WithAdditionalPermissions`
- the profile must be present and non-empty
- fresh requests are rejected unless approval policy is `OnRequest`
- feature gating must allow the additional-permissions flow unless the permissions are already preapproved

So Codex does not let the model opportunistically request new permissions under `Never`, `OnFailure`, or `UnlessTrusted`.

### `request_permissions` is a separate tool surface

`tools/handlers/request_permissions.rs` normalizes the request profile and emits a dedicated `RequestPermissions` event.

`codex.rs` handles it like this:

- under `Never`, it returns an empty permission profile immediately
- under `Granular` with `request_permissions = false`, it also returns an empty permission profile
- otherwise it sends a real request/response event and records granted permissions into turn or session state based on the returned scope

Implementation nuance: the code contains a TODO noting that `request_permissions` still uses the manual request flow and does not yet have the same auto-review path as other approval surfaces.

## 7. Tool approval orchestration

### The orchestrator is shared across tools

`tools/orchestrator.rs` runs the common flow:

1. get approval requirement
2. request approval if needed
3. select initial sandbox
4. run first attempt
5. if sandbox denies and policy allows, optionally ask for retry without sandbox
6. run second attempt unsandboxed

This gives Codex one shared approval and retry model for shell, unified exec, and apply_patch runtimes.

### Approval caching is session-scoped and key-based

`tools/sandboxing.rs` provides `with_cached_approval(...)`.

It only caches `ApprovedForSession`, keyed by serialized approval keys.

Examples:

- shell keys include canonicalized command, cwd, sandbox permission mode, and additional permissions
- unified exec adds `tty`
- apply_patch uses one key per file path so later overlapping file subsets can reuse approvals

### Approval reviewer is separate from approval policy

`config_types.rs` defines `ApprovalsReviewer`:

- `User`
- `GuardianSubagent`

The orchestrator and tool runtimes treat this separately from `AskForApproval`.

So “who reviews an approval” is distinct from “whether prompts are allowed”.

### `OnFailure` and `OnRequest` differ mainly at retry time

The tool trait default says:

- `OnFailure` wants no-sandbox retry approval
- `UnlessTrusted` wants no-sandbox retry approval
- `OnRequest` does not

That means `OnFailure` is implemented as a sandbox-first mode that may later escalate after denial.

There is one exception in `orchestrator.rs`: under `OnRequest`, Codex may still surface a retry prompt when the denial is specifically a managed-network block with a valid network approval context.

## 8. Shell and unified exec implementation

### Shell and unified exec both compute exec approval before orchestration

`tools/handlers/shell.rs` and `tools/handlers/unified_exec.rs` do all of this before calling the orchestrator:

- merge dependency environment
- apply sticky granted permissions
- validate additional permissions
- reject invalid escalation attempts for the current approval mode
- compute `ExecApprovalRequirement` via `ExecPolicyManager`

So the orchestrator receives an already-evaluated command approval requirement.

### First-attempt sandbox override is explicit

`sandbox_override_for_first_attempt(...)` bypasses the sandbox immediately when either:

- the request uses `RequireEscalated`
- execpolicy returned `Skip { bypass_sandbox: true }`

That is how explicit escalation and policy-greenlit bypass both skip the initial sandbox.

### `WithAdditionalPermissions` and preapproved permissions diverge at approval time

When extra permissions are already covered by sticky grants, shell handlers pass `UseDefault` into execpolicy approval evaluation while still keeping the effective widened permissions on the actual runtime request.

That prevents redundant permission prompts without losing the widened sandbox at execution time.

## 9. Unix zsh-fork exec interception

`tools/runtimes/shell/unix_escalation.rs` is one of the most interesting files in Codex.

### Codex can intercept subcommands after shell parsing

The zsh-fork path uses `codex-shell-escalation` and execve interception so it can review the actual executable and argv instead of only the outer shell script string.

This is a stronger approval surface than plain shell-wrapper parsing.

### Rule-driven prompts and sandbox-driven prompts stay separate

The intercepted exec path distinguishes:

- `DecisionSource::PrefixRule`
- `DecisionSource::UnmatchedCommandFallback`

Then `execve_prompt_is_rejected_by_policy(...)` maps granular approval flags differently:

- prefix-rule prompts consult `rules`
- unmatched-command prompts consult `sandbox_approval`

That is a precise and intentional split.

### Escalation execution depends on the sandbox permission mode

For intercepted subcommands:

- `UseDefault` -> `TurnDefault`
- `RequireEscalated` -> `Unsandboxed`
- `WithAdditionalPermissions` -> sandboxed execution using widened split policies

So even at execve-intercept time, Codex preserves the distinction between unsandboxed escalation and sandboxed permission widening.

### Preapproved additional permissions downgrade only the approval shape

`approval_sandbox_permissions(...)` changes `WithAdditionalPermissions` to `UseDefault` only for the approval decision when the permissions are already preapproved.

It does **not** convert `RequireEscalated`, and it does not remove the actual widened permissions from execution.

## 10. Apply patch has a separate safety model

Codex does not treat patches as generic shell text.

### Patch safety is assessed structurally first

`core/src/safety.rs` classifies a patch as:

- `AutoApprove`
- `AskUser`
- `Reject`

based on:

- whether the patch is empty
- whether all touched paths stay inside writable roots
- whether a platform sandbox exists
- current approval policy

### Patch auto-approval is sandbox-aware

If the patch is constrained to writable paths, Codex may auto-approve it **only** when it can actually run in a sandbox, unless the active sandbox mode is already `DangerFullAccess` or `ExternalSandbox`.

If sandbox approval prompts are disallowed and the patch would write outside the project, Codex rejects it outright.

### `.codex` is still protected for patches

The tests show that writing `.codex/config.toml` in a workspace-write sandbox still requires approval because `.codex` is one of the protected carveouts.

### Apply patch approval caching is file-based

`ApplyPatchRuntime` uses absolute target paths as approval keys.

That gives session-scoped “approve for session” semantics at file granularity instead of command-string granularity.

## 11. Network approval model

Codex treats network approval as a distinct subsystem.

### Network approvals are keyed by host, protocol, and port

`tools/network_approval.rs` deduplicates in-flight approvals using:

- lowercase host
- protocol label
- port

Concurrent requests for the same destination collapse onto one pending approval.

### Session allow and deny caches are separate

Codex keeps:

- `session_approved_hosts`
- `session_denied_hosts`

So later requests can be auto-allowed or auto-denied without another prompt.

### Only `Never` disables network approval flow entirely

`allows_network_approval_flow(...)` returns false only for `AskForApproval::Never`.

So network policy misses can still prompt under:

- `OnRequest`
- `OnFailure`
- `UnlessTrusted`
- `Granular(...)`

### Network approvals can be immediate or deferred

Tool runtimes choose a `NetworkApprovalMode`:

- shell uses `Immediate`
- unified exec uses `Deferred`

That lets Codex wait until a PTY-backed session actually succeeds before finalizing certain network approval bookkeeping.

### Network prompts can persist policy amendments

When the user chooses a network amendment decision, Codex persists allow/deny host rules and records a message in the session transcript.

So network approvals are not only ephemeral per-call decisions.

## 12. MCP approval model

Codex treats MCP tool approval as its own policy layer.

### MCP tools have their own approval vocabulary

`config/src/mcp_types.rs` defines per-tool `AppToolApproval`:

- `Auto`
- `Prompt`
- `Approve`

This is separate from shell approval policy.

### Approval requirement depends on tool annotations

`mcp_tool_call.rs` uses MCP tool annotations to decide if approval is required.

The logic is roughly:

- destructive => require approval
- explicitly read-only and otherwise safe => no approval
- missing or open-world annotations => require approval

So Codex does not blindly trust unannotated MCP tools.

### Auto-approved MCP tools can still be safety-monitored

Even when `approval_mode = Approve`, Codex may run ARC/guardian monitoring first.

That monitor can:

- allow silently
- convert the call into a user prompt
- block the call entirely and steer the model instead

So “approve” is not an unconditional bypass.

### MCP approvals support session and persistent remember flows

Codex can remember MCP approvals:

- for the session
- persistently for future calls

depending on server/tool config and feature flags.

### Full access mode skips MCP approval entirely

`mcp_tool_call.rs` defines full access mode as:

- `approval_policy = Never`
- sandbox policy is `DangerFullAccess` or `ExternalSandbox`

In that combination, MCP tool approval is skipped.

## 13. What Codex is optimizing for

From the code, Codex is optimizing for these properties:

1. **Clear separation of controls**
   - approval policy
   - sandbox scope
   - execpolicy rules
   - per-command permission widening

2. **Sandbox-first execution**
   - many commands run directly under sandbox
   - prompts mostly happen on danger, policy, or escape attempts

3. **Structured permission state**
   - `PermissionProfile` is first-class
   - grants persist at turn or session scope

4. **Real runtime enforcement**
   - additional permissions alter actual sandbox policies
   - split filesystem policy is preserved when legacy projection is lossy

5. **Separate subsystems for separate risk types**
   - shell / unified exec
   - apply_patch
   - network
   - request_permissions
   - MCP

6. **Policy evolution through user action**
   - execpolicy amendments
   - network policy amendments
   - session approval caches

## Final conclusions

Codex’s permission system is best understood as four interlocking layers:

### 1. Configuration and constraints

- config layers
- project trust
- managed requirements
- legacy sandbox mode vs permission profiles

### 2. Command policy

- execpolicy rule files
- heuristic safe/dangerous command classification
- amendable allow prefixes

### 3. Runtime sandbox state

- legacy sandbox policy
- split filesystem and network policies
- structured additional permissions
- sticky turn/session grants

### 4. Approval orchestration

- user or guardian reviewer routing
- session approval cache
- no-sandbox retry flow
- separate network and MCP approval systems

The most important implementation insight is that Codex treats permissions as a combination of:

- **what the runtime can do**
- **when the agent may ask to do more**
- **which commands policy already trusts or forbids**
- **which extra permissions have already been granted**

That separation is the architecture.
