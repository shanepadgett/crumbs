# Codex Permissioning and Sandboxing Cleanroom Report

## Scope

This report covers the upstream Codex implementation vendored in `external/codex` and describes what would be required to recreate its permissioning and sandboxing model as a Pi extension without relying on the existing in-repo permissions extension.

The authoritative sources in the vendored repo are the Rust protocol/config/runtime code and the tests around them. The checked-in markdown for sandboxing and execpolicy is mostly a pointer to hosted docs rather than a full local spec.

## Upstream shape

Codex does not implement "permissions" as one switch. It is a composition of separate policy layers:

- Approval policy: when the user must be asked, when prompts are auto-rejected, and which approval categories are allowed at all. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`, `external/codex/codex-rs/protocol/src/models.rs`, `external/codex/codex-rs/core/src/tools/sandboxing.rs`.
- Legacy sandbox policy: the user-facing coarse modes `danger-full-access`, `read-only`, `workspace-write`, and `external-sandbox`. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`.
- Split filesystem policy: the richer runtime policy with explicit `read`, `write`, and `none` entries, special paths, carveouts, and policy transforms. Evidence: `external/codex/codex-rs/protocol/src/permissions.rs`, `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`.
- Network policy: separate from filesystem policy and richer than a boolean. It includes restricted/enabled mode plus managed proxy configuration, domain rules, unix-socket rules, and local bind controls. Evidence: `external/codex/codex-rs/core/src/config/permissions.rs`, `external/codex/codex-rs/network-proxy/src/network_policy.rs`.
- Additional permission grants: turn-scoped or session-scoped overlays that add filesystem and/or network permissions on top of the base sandbox. Evidence: `external/codex/codex-rs/protocol/src/request_permissions.rs`, `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`.

That split matters. A faithful Pi extension cannot model this as a single "approval mode" or a single "sandbox mode" without losing real behavior.

## Confirmed core features

### 1. Config and default posture

Codex resolves approval policy, sandbox policy, permission profiles, and project trust together.

- `AskForApproval` has five distinct modes: `unless-trusted`, `on-failure`, `on-request`, `granular`, and `never`. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`.
- `granular` is not cosmetic. It independently gates sandbox approvals, execpolicy rule prompts, skill approvals, `request_permissions`, and MCP elicitations. If a category is disabled, Codex auto-rejects instead of prompting. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`, `external/codex/codex-rs/protocol/src/models.rs`, `external/codex/codex-rs/core/src/exec_policy.rs`.
- Project trust changes defaults. Trusted projects default to `OnRequest`; untrusted projects default to `UnlessTrusted`. Evidence: `external/codex/codex-rs/core/src/config/mod.rs`.
- Permission profiles compile from TOML into split filesystem and network policies. Filesystem entries can target absolute paths or special tokens such as `:root`, `:minimal`, `:project_roots`, and `:tmpdir`. Evidence: `external/codex/codex-rs/core/src/config/permissions.rs`.

Implication for Pi: the extension needs a policy compiler, not just runtime checks.

### 2. Sandbox policy model

The user-facing sandbox model is still the coarse legacy one, but runtime logic projects that into a richer filesystem policy.

- `read-only` separates read access from network access.
- `workspace-write` adds writable roots and optional exclusions for `TMPDIR` and `/tmp`.
- `external-sandbox` means Codex assumes the process is already sandboxed externally while still honoring the network setting.
- `danger-full-access` is fully unrestricted.

Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`.

The split filesystem policy adds behavior that the coarse model cannot express directly:

- explicit `none` entries
- nested path precedence
- protected read-only subpaths under writable roots
- round-tripping checks to determine whether legacy policies are semantically equivalent

Evidence: `external/codex/codex-rs/protocol/src/permissions.rs`.

Implication for Pi: if the extension exposes only coarse modes, it still needs an internal richer policy representation.

### 3. Command approval engine

Codex command approval is driven by three inputs together:

- current approval mode
- current sandbox/filesystem/network policy
- execpolicy evaluation plus command-safety heuristics

Evidence: `external/codex/codex-rs/core/src/exec_policy.rs`, `external/codex/codex-rs/core/src/tools/sandboxing.rs`, `external/codex/codex-rs/shell-command/src/command_safety/is_safe_command.rs`, `external/codex/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs`.

Confirmed behaviors:

- Codex distinguishes `Skip`, `NeedsApproval`, and `Forbidden` as first-class outcomes before execution. Evidence: `external/codex/codex-rs/core/src/tools/sandboxing.rs`.
- `OnRequest` and `Granular` ask for approval when filesystem access is still restricted. `Never` and `OnFailure` do not prompt up front. `UnlessTrusted` always prompts. Evidence: `external/codex/codex-rs/core/src/tools/sandboxing.rs`.
- Execpolicy rules can allow, prompt, or forbid commands, and those results are merged with approval policy constraints. Evidence: `external/codex/codex-rs/core/src/exec_policy.rs`, `external/codex/codex-rs/execpolicy/src/policy.rs`, `external/codex/codex-rs/execpolicy/src/decision.rs`.
- Codex can propose a persistent allow-prefix amendment so future commands with the same prefix bypass approval. Evidence: `external/codex/codex-rs/protocol/src/approvals.rs`, `external/codex/codex-rs/core/src/exec_policy.rs`.
- Prefix suggestions are constrained. Broad shells, interpreters, and other high-leverage prefixes are explicitly banned from suggestion. Evidence: `external/codex/codex-rs/core/src/exec_policy.rs`.
- Approval decisions are richer than allow/deny: `approved`, `approved_for_session`, `approved_execpolicy_amendment`, `network_policy_amendment`, `denied`, `abort`. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`.

Implication for Pi: cloning the approval UX without cloning the rule engine and decision types will not reproduce Codex behavior.

### 4. Retry and escalation semantics

Codex does not treat approval as a single preflight gate. It has retry logic around sandbox failures.

- Tools can run sandboxed first and then escalate to an approval flow if the sandboxed attempt fails in a way that looks like sandbox denial. Evidence: `external/codex/codex-rs/core/src/tools/sandboxing.rs`, `external/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs`.
- Some requests can intentionally bypass the sandbox on the first attempt when escalated permissions were already granted or implied by policy. Evidence: `external/codex/codex-rs/core/src/tools/sandboxing.rs`.
- The zsh fork / execve interception path adds another layer: subcommand approvals can be requested during execution rather than only before the top-level shell command. Evidence: `external/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs`, `external/codex/codex-rs/protocol/src/approvals.rs`.

Implication for Pi: if the extension only approves the top-level command string, it will miss one of the upstream system's important protections.

### 5. Apply-patch approval is separate from shell approval

Codex treats patch application as its own approval surface.

- Patch approvals are keyed per file path for session-scoped caching. Evidence: `external/codex/codex-rs/core/src/tools/sandboxing.rs`, `external/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`.
- `ApplyPatchApprovalRequestEvent` sends structured file changes plus optional reason and optional `grant_root`. Evidence: `external/codex/codex-rs/protocol/src/approvals.rs`.
- The apply-patch runtime reuses upstream approval decisions and then executes the verified patch under the current sandbox attempt via self-invocation. Evidence: `external/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`.

Implication for Pi: patch approval should not be implemented as a stringified shell approval. It needs structured diffs and file-target caching.

### 6. Additional permissions and `request_permissions`

Codex supports asking for more permissions before a later shell-like action needs them.

- `request_permissions` is a dedicated tool with typed arguments and typed responses. Evidence: `external/codex/codex-rs/protocol/src/request_permissions.rs`, `external/codex/codex-rs/core/src/tools/handlers/request_permissions.rs`.
- Grants are explicitly scoped to `turn` or `session`. Evidence: `external/codex/codex-rs/protocol/src/request_permissions.rs`.
- Requested permissions are normalized before use: empty payloads are rejected, filesystem paths are canonicalized and deduped, and empty nested structures are removed. Evidence: `external/codex/codex-rs/core/src/tools/handlers/request_permissions.rs`, `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`.
- Granted permissions are intersected with requested permissions rather than blindly trusted. Evidence: `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`.
- The app-server and TUI convert these requests into separate protocol/UI payloads instead of treating them as generic text. Evidence: `external/codex/codex-rs/app-server/tests/suite/v2/request_permissions.rs`, `external/codex/codex-rs/tui/src/app_server_approval_conversions.rs`.

Implication for Pi: a real clone needs both inline extra-permission requests on shell tools and a standalone permission-request mechanism.

### 7. Filesystem policy transforms and protected roots

This is one of the most implementation-heavy parts of the upstream design.

- Additional read/write grants merge into restricted filesystem policy but do not matter for unrestricted or external-sandbox kinds. Evidence: `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`.
- Writable roots are not simply writable directories. They also carry read-only carveouts for protected subpaths. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`, `external/codex/codex-rs/protocol/src/permissions.rs`.
- Upstream code explicitly protects `.codex`, `.git`, resolved gitdirs, and similar subpaths under writable roots. Evidence: `external/codex/codex-rs/protocol/src/protocol.rs`, `external/codex/codex-rs/linux-sandbox/README.md`.
- Path specificity matters. Narrower child rules can reopen broader denied or read-only parents, while narrower denied subpaths still win where intended. Evidence: `external/codex/codex-rs/protocol/src/permissions.rs`, `external/codex/codex-rs/linux-sandbox/README.md`.
- Symlinked and missing-path cases are handled explicitly so a writable root cannot be used to bypass a protected carveout. Evidence: `external/codex/codex-rs/protocol/src/permissions.rs`, `external/codex/codex-rs/linux-sandbox/README.md`.

Implication for Pi: path policy needs canonicalization, precedence rules, and carveout logic, not just "allowed roots".

### 8. Managed network mediation and approvals

Network is not implemented only as "sandbox blocks sockets".

- Upstream has a managed network proxy/policy layer that can decide `allow`, `deny`, or `ask`. Evidence: `external/codex/codex-rs/network-proxy/src/network_policy.rs`.
- Network approval context is structured by host and protocol, and proposed persistent network policy amendments are part of the approval event. Evidence: `external/codex/codex-rs/protocol/src/approvals.rs`.
- Session-scoped allow/deny caches exist for hosts, keyed by host, protocol, and port. Evidence: `external/codex/codex-rs/core/src/tools/network_approval.rs`.
- When Codex runs in managed proxy mode on Linux, the sandbox uses a TCP -> UDS -> TCP bridge so tool traffic reaches only configured proxy endpoints. Evidence: `external/codex/codex-rs/linux-sandbox/README.md`.

Implication for Pi: if the extension cannot mediate outbound requests at the process/network boundary, it can only approximate this part of Codex.

### 9. Platform-specific enforcement

The same policy model is enforced differently per OS.

- macOS uses Seatbelt. Evidence: `external/codex/codex-rs/sandboxing/src/seatbelt.rs`, `external/codex/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`.
- Linux defaults to bubblewrap plus seccomp, with a legacy Landlock fallback behind a feature/config path. Evidence: `external/codex/codex-rs/linux-sandbox/README.md`, `external/codex/codex-rs/sandboxing/src/manager.rs`.
- Windows uses a restricted-token / sandbox setup pipeline with separate orchestration. Evidence: `external/codex/codex-rs/windows-sandbox-rs/src/policy.rs`, `external/codex/codex-rs/windows-sandbox-rs/src/setup_orchestrator.rs`.
- Linux only uses the legacy fallback when the split filesystem policy is sandbox-equivalent to the legacy model after `cwd` resolution. Evidence: `external/codex/codex-rs/linux-sandbox/README.md`, `external/codex/codex-rs/protocol/src/permissions.rs`.

Implication for Pi: full parity is expensive unless the extension can call into OS-specific helpers or reuse existing sandbox binaries.

### 10. Approval transport is part of the design

Approval requests are exposed as structured protocol events and RPC requests, not just UI affordances.

- App-server/MCP exposes typed approval requests for exec, patch, and permissions flows. Evidence: `external/codex/codex-rs/docs/codex_mcp_interface.md`, `external/codex/codex-rs/app-server/tests/suite/v2/request_permissions.rs`.
- TUI code has explicit conversion layers for network approval context and granted permission profiles. Evidence: `external/codex/codex-rs/tui/src/app_server_approval_conversions.rs`.

Implication for Pi: if the extension wants future parity with multiple frontends, approval transport should be a typed internal protocol, not a UI-only callback.

## Optional later-phase parity

These are real upstream features, but they do not need to be in phase 1 if the initial goal is shell/patch parity.

- Guardian auto-review: approval requests can be routed to a reviewer subagent that scores risk and can fail closed. Evidence: `external/codex/codex-rs/core/src/guardian/policy.md`, `external/codex/codex-rs/core/src/guardian/approval_request.rs`.
- MCP/app-tool approvals: separate approval handling exists for Codex apps and MCP tools, with approval modes, remembers, and elicitation support. Evidence: `external/codex/codex-rs/core/src/mcp_tool_call.rs`.

These are better treated as later phases unless the Pi extension needs full upstream surface compatibility from day one.

## What it would take to build

### Minimum credible parity

To claim Codex-like permissioning and sandboxing in a meaningful way, the Pi extension would need at least these subsystems:

1. Policy compiler
   Converts user config into approval policy, coarse sandbox mode, split filesystem policy, network policy, and trust-aware defaults.

2. Command approval engine
   Combines approval mode, sandbox state, safe/dangerous command heuristics, and execpolicy rule evaluation into `skip`, `prompt`, or `forbid`.

3. Structured approval protocol
   Carries exec approvals, patch approvals, request-permissions requests, reasons, available decisions, proposed amendments, and per-session decisions.

4. Patch approval subsystem
   Evaluates and presents file-targeted changes separately from shell commands and caches approvals per file target.

5. Additional-permissions overlay
   Supports turn/session grants, normalization, intersection, and merging into the base sandbox.

6. Runtime execution layer
   Runs shell commands and apply-patch under the currently effective sandbox permissions and understands sandbox-denied retry paths.

7. Path policy engine
   Handles protected subpaths, carveouts, path canonicalization, rule precedence, and writable-root semantics.

8. Persistence layer
   Stores session approval cache, persisted execpolicy prefix rules, and persisted network policy amendments.

### Full upstream parity

Full parity would add:

- managed network proxy mediation
- macOS/Linux/Windows sandbox adapters
- app-server/MCP approval transport
- Guardian auto-review
- MCP/app approval modes and remembers

## Hard implementation traps

- Do not collapse everything into a single approval enum. Upstream behavior depends on separate approval, sandbox, filesystem, network, and additional-permission layers.
- Do not model writable roots as simple allowlists. Upstream writable roots carry read-only carveouts and protected subpaths.
- Do not grant requested permissions blindly. Upstream normalizes, dedupes, canonicalizes, and intersects grants.
- Do not assume one approval per shell tool call. Upstream has subcommand approval on the zsh/execve path.
- Do not assume network policy is equivalent to sandbox network enable/disable. Upstream also has interactive network approval and persistent network policy amendments.
- Do not assume Linux, macOS, and Windows can share one enforcement backend. Upstream does not.
- Do not treat the local markdown docs as sufficient. The code and tests are the real spec.

## Recommended build phases

### Phase 1

- trust-aware config resolution
- coarse sandbox modes
- split filesystem policy and protected writable roots
- exec approval engine
- apply-patch approval
- typed approval decisions
- turn/session additional permissions
- persisted exec prefix rules

This is enough to start behaving like Codex in the core local coding loop.

### Phase 2

- network approval prompts
- persisted network policy amendments
- managed network mediation where the host runtime allows it
- typed client/app protocol for approvals

### Phase 3

- platform-specific hard sandboxing
- Guardian
- MCP/app-tool approval parity

## Best evidence map

- Policy types and review decisions: `external/codex/codex-rs/protocol/src/protocol.rs`
- Split filesystem/network policy model: `external/codex/codex-rs/protocol/src/permissions.rs`
- Developer instructions generated from approval/sandbox policy: `external/codex/codex-rs/protocol/src/models.rs`
- Config compilation and trust defaults: `external/codex/codex-rs/core/src/config/mod.rs`, `external/codex/codex-rs/core/src/config/permissions.rs`
- Exec approval logic: `external/codex/codex-rs/core/src/exec_policy.rs`
- Tool approval orchestration: `external/codex/codex-rs/core/src/tools/sandboxing.rs`
- Shell escalation path: `external/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs`
- Apply-patch runtime: `external/codex/codex-rs/core/src/tools/runtimes/apply_patch.rs`
- Additional permission request protocol: `external/codex/codex-rs/protocol/src/request_permissions.rs`
- Additional permission transforms: `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`
- Network approval service: `external/codex/codex-rs/core/src/tools/network_approval.rs`
- Network policy engine: `external/codex/codex-rs/network-proxy/src/network_policy.rs`
- Linux sandbox behavior: `external/codex/codex-rs/linux-sandbox/README.md`
- App-server approval protocol examples: `external/codex/codex-rs/docs/codex_mcp_interface.md`, `external/codex/codex-rs/app-server/tests/suite/v2/request_permissions.rs`
- Optional later-phase approval surfaces: `external/codex/codex-rs/core/src/mcp_tool_call.rs`, `external/codex/codex-rs/core/src/guardian/policy.md`

## Planning inputs for the next chat

If the next chat is for actual design, these are the decisions that need to be made first:

1. Scope target
   Is the goal shell/patch parity first, or full parity including managed network, MCP, and Guardian?

2. Enforcement target
   Can the Pi extension call OS-specific helpers or sidecar binaries, or must enforcement stay inside the extension host?

3. Platform target
   Is phase 1 cross-platform, or is it acceptable to ship one platform first?

4. Rule model
   Should Pi clone the execpolicy DSL and persistent prefix-rule behavior, or use a Pi-native rule system with equivalent semantics?

5. Persistence model
   Where do session approvals, persisted prefix rules, and persisted network rules live?

6. Approval transport
   Is there one UI surface, or does the extension need a typed internal protocol because multiple frontends may exist later?

7. Additional permissions
   Should `request_permissions` ship in phase 1, or can phase 1 limit itself to inline escalations on shell/apply-patch?

8. Network story
   Is interactive network approval required in phase 1, or can phase 1 stay at coarse on/off network policy?

9. Protected roots
   Which Pi-specific directories must be treated like Codex treats `.codex` and `.git` under writable roots?

10. Compatibility level
   Is the objective behavior parity, UX parity, or protocol parity with upstream Codex?
