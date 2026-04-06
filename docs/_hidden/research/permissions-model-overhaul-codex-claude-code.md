# Permissions Model Research: Codex and Claude Code

Scope: this document is grounded only in Codex and Claude Code implementation details. It intentionally excludes analysis of the local project.

## Executive summary

Two strong patterns emerge from the implementations:

1. **Sandbox boundaries and approval policy must be separate controls.**
   Codex models them as distinct first-class concepts. Claude Code also keeps runtime sandboxing separate from permission mode and trust flow.

2. **A serious permission system needs more than a mode enum.**
   Codex adds structured per-command and per-session permission grants. Claude Code adds layered rule sources, bypass-immune safety checks, and sandbox translation from accumulated rules.

3. **Shell execution needs deeper safety logic than simple path allowlists.**
   Both systems treat shell commands as a special case because wrappers, compound commands, redirects, flags, and path tricks can bypass naive checks.

4. **Protected or prompt-worthy subpaths still matter inside otherwise-allowed roots.**
   Codex protects `.git`, `.agents`, and `.codex` inside writable roots. Claude Code forces approval for dangerous paths and command shapes even when broad permission modes are active.

5. **Network access should have its own approval and persistence model.**
   Codex has host/protocol/port approval state. Claude Code can persist domain rules and refresh the sandbox immediately.

6. **Non-shell tool approvals are part of the same story.**
   Both systems have separate approval handling for MCP or side-effectful non-shell tools, rather than pretending all permissions are just shell permissions.

## Source set

### Codex

- `external/codex/codex-rs/protocol/src/permissions.rs`
- `external/codex/codex-rs/protocol/src/models.rs`
- `external/codex/codex-rs/protocol/src/protocol.rs`
- `external/codex/codex-rs/sandboxing/src/policy_transforms.rs`
- `external/codex/codex-rs/sandboxing/src/manager.rs`
- `external/codex/codex-rs/sandboxing/src/seatbelt.rs`
- `external/codex/codex-rs/tools/src/local_tool.rs`
- `external/codex/codex-rs/core/src/config/permissions.rs`
- `external/codex/codex-rs/core/src/exec_policy.rs`
- `external/codex/codex-rs/core/src/tools/sandboxing.rs`
- `external/codex/codex-rs/core/src/tools/network_approval.rs`
- `external/codex/codex-rs/core/src/tools/handlers/mod.rs`
- `external/codex/codex-rs/core/src/tools/handlers/shell.rs`
- `external/codex/codex-rs/core/src/tools/runtimes/shell/unix_escalation.rs`
- `external/codex/codex-rs/config/src/mcp_types.rs`

### Claude Code

- `external/claude-code/src/types/permissions.ts`
- `external/claude-code/src/utils/permissions/PermissionMode.ts`
- `external/claude-code/src/utils/permissions/permissions.ts`
- `external/claude-code/src/utils/permissions/permissionSetup.ts`
- `external/claude-code/src/utils/permissions/permissionsLoader.ts`
- `external/claude-code/src/utils/permissions/filesystem.ts`
- `external/claude-code/src/utils/permissions/pathValidation.ts`
- `external/claude-code/src/tools/BashTool/bashPermissions.ts`
- `external/claude-code/src/tools/BashTool/pathValidation.ts`
- `external/claude-code/src/tools/BashTool/shouldUseSandbox.ts`
- `external/claude-code/src/tools/BashTool/modeValidation.ts`
- `external/claude-code/src/utils/sandbox/sandbox-adapter.ts`
- `external/claude-code/src/entrypoints/sandboxTypes.ts`
- `external/claude-code/src/Tool.ts`
- `external/claude-code/src/hooks/useCanUseTool.tsx`
- `external/claude-code/src/hooks/toolPermission/PermissionContext.ts`
- `external/claude-code/src/hooks/toolPermission/handlers/interactiveHandler.ts`
- `external/claude-code/src/services/tools/toolExecution.ts`
- `external/claude-code/src/interactiveHelpers.tsx`
- `external/claude-code/src/setup.ts`
- `external/claude-code/src/screens/REPL.tsx`
- `external/claude-code/src/services/mcp/config.ts`
- `external/claude-code/src/services/mcp/utils.ts`

## Codex implementation model

### 1. Codex cleanly separates sandbox boundary, approval policy, and per-command override

The core split is visible across `protocol/src/models.rs`, `core/src/exec_policy.rs`, `core/src/tools/handlers/shell.rs`, and `core/src/tools/runtimes/shell/unix_escalation.rs`.

- **Sandbox boundary** comes from the turn-level sandbox policy and filesystem/network sandbox policy.
- **Approval policy** comes from `AskForApproval` values such as `Never`, `OnFailure`, `OnRequest`, `UnlessTrusted`, and `Granular(...)`.
- **Per-command override** comes from `SandboxPermissions`, which has three distinct states:
  - `UseDefault`
  - `RequireEscalated`
  - `WithAdditionalPermissions`

That split matters because `RequireEscalated` and `WithAdditionalPermissions` are not treated as the same thing.

### 2. Codex has a first-class additive permission model

`protocol/src/models.rs` defines `PermissionProfile` as structured permissions:

- `file_system.read`
- `file_system.write`
- `network.enabled`

Shell-like tool calls can carry this profile directly via:

- `ShellToolCallParams.additional_permissions`
- `ShellCommandToolCallParams.additional_permissions`

The request is only valid when paired with `sandbox_permissions = with_additional_permissions`.

`core/src/tools/handlers/mod.rs` then makes additive permissions real runtime state:

- requested permissions merge with granted session permissions and granted turn permissions
- already-granted permissions can make later requests implicitly preapproved
- if effective additional permissions exist, a later shell request can implicitly run as `WithAdditionalPermissions`

This is stronger than a one-off approval prompt because the permission payload stays structured all the way through execution.

### 3. Codex validates additive permissions tightly

`core/src/tools/handlers/mod.rs` enforces several guardrails in `normalize_and_validate_additional_permissions(...)`:

- `additional_permissions` is rejected unless `sandbox_permissions` is `WithAdditionalPermissions`
- `WithAdditionalPermissions` is rejected if the permission profile is missing or empty
- non-preapproved additive requests are rejected unless approval policy is `OnRequest`

This means additive grants are not a vague hint. They are an explicit contract with type checks and policy checks.

### 4. Codex distinguishes sandbox widening from unsandboxed execution

`core/src/tools/runtimes/shell/unix_escalation.rs` is the clearest evidence:

- `RequireEscalated` maps to unsandboxed execution
- `WithAdditionalPermissions` maps to execution that stays sandboxed but with widened permissions

That is one of Codex’s most important ideas. It avoids collapsing all escalations into “turn the sandbox off”.

The file also shows that once additive permissions are already preapproved, approval-time sandbox permissions can collapse back to `UseDefault`, which avoids redundant prompts while preserving the effective grant.

### 5. Codex does not prompt for every command in `OnRequest`

`core/src/exec_policy.rs` shows the exact logic.

For restricted sandboxes:

- known-safe commands can run directly
- non-dangerous commands without sandbox override can run directly
- commands that request sandbox override prompt
- dangerous commands prompt

This is a crucial design choice. Codex uses the sandbox as the default enforcement boundary and asks mainly when the command wants to go beyond that boundary, when policy rules require a prompt, or when the command is considered dangerous.

### 6. Codex treats dangerous commands and missing sandbox protection as special

`core/src/exec_policy.rs` checks both:

- whether a command may be dangerous
- whether the environment lacks meaningful sandbox protection

If either is true, the command is never silently allowed in the usual restricted path. Depending on approval policy, it prompts or is forbidden.

That makes the approval system sensitive not just to command content, but also to the actual protection strength of the environment.

### 7. Codex protects sensitive subpaths inside writable roots

`protocol/src/permissions.rs` is explicit about protected writable-root carveouts.

Inside otherwise writable roots, Codex protects at least:

- `.git`
- `.agents`
- `.codex`

Protection is recursive. If `.git` is a pointer file, the resolved Git directory is also protected. This is a strong pattern because it avoids the false choice between “workspace writable” and “everything under the workspace writable”.

### 8. Codex merges additional permissions into sandbox policy, not just approval UI

`sandboxing/src/policy_transforms.rs`, `core/src/config/permissions.rs`, and `core/src/tools/sandboxing.rs` show that Codex carries permissions through actual sandbox policy construction.

This includes:

- filesystem permission overlays
- network/domain/unix-socket policy overlays
- approval caching and sandbox override logic

So Codex’s permission model is not only a front-end approval abstraction. It directly changes the execution policy fed into sandboxing.

### 9. Codex has a separate network approval system

`core/src/tools/network_approval.rs` keeps network approvals separate from command approval.

The stored identity includes:

- host
- protocol
- port

The implementation also deduplicates concurrent requests behind a single pending approval flow. This is much better than prompting independently for every outgoing connection attempt.

### 10. Codex has separate approval treatment for MCP-like tool surfaces

`config/src/mcp_types.rs` shows per-tool approval states such as:

- `auto`
- `prompt`
- `approve`

This matters because it shows Codex does not force all approvals through shell semantics. Tool ecosystems get their own approval vocabulary.

## Claude Code implementation model

### 1. Claude Code is organized around a permission context plus layered rule sources

`src/Tool.ts`, `src/types/permissions.ts`, `src/utils/permissions/PermissionMode.ts`, and `src/utils/permissions/permissionsLoader.ts` show the shape.

`ToolPermissionContext` includes:

- `mode`
- `additionalWorkingDirectories`
- `alwaysAllowRules`
- `alwaysDenyRules`
- `alwaysAskRules`
- bypass/auto availability flags
- headless or worker prompt controls such as `shouldAvoidPermissionPrompts`

Claude Code then loads and merges rules from multiple sources, including policy, user, project, local, session, and CLI layers.

The important point is that the model is not just “current mode”. It is mode plus layered rule state plus runtime context.

### 2. Claude Code has a strict permission decision pipeline

`src/utils/permissions/permissions.ts` is the main reference.

The ordering matters:

1. deny rules
2. ask rules
3. tool-specific permission logic
4. bypass-immune safety checks
5. bypass mode or broad allow handling
6. mode transforms such as `dontAsk`, `auto`, and headless fallback

This ordering is one of Claude Code’s strongest ideas. It prevents broad permission modes from bypassing certain safety-critical checks.

### 3. Claude Code separates workspace trust from permission mode

`src/interactiveHelpers.tsx` and `src/setup.ts` show that workspace trust and dangerous bypass activation are separate concerns.

Even if a permission mode is broad, trust or onboarding checks may still apply. Likewise, dangerous bypass mode has its own hard gating.

This is a major architectural advantage over designs that try to encode trust, approval posture, and sandbox scope into a single switch.

### 4. Claude Code has bypass-immune filesystem safety checks

`src/utils/permissions/filesystem.ts` and `src/tools/BashTool/pathValidation.ts` provide the clearest evidence.

Examples of paths or situations that still force approval include:

- `.git`
- `.claude`
- `.vscode`
- shell RC files
- suspicious Windows path patterns
- dangerous removal targets
- compound `cd` plus write flows
- ambiguous redirection or process-substitution cases

This is more than a static allowlist. It is path-aware and command-aware safety logic.

### 5. Claude Code treats shell permissions as a parsing and normalization problem

`src/tools/BashTool/bashPermissions.ts`, `src/tools/BashTool/pathValidation.ts`, and `src/tools/BashTool/shouldUseSandbox.ts` show several shell-specific defenses:

- exact, prefix, and wildcard shell rules
- compound-command splitting
- stripping leading env vars before matching
- stripping wrapper commands before matching
- flag-aware validation limits
- redirect-aware path checks
- `cd`-aware path checks for compound commands

Claude Code treats shell input as adversarially shapeable. That is the right assumption.

### 6. Claude Code’s sandbox config is derived from rule state

`src/utils/sandbox/sandbox-adapter.ts` and `src/entrypoints/sandboxTypes.ts` show that the runtime sandbox is produced by translating higher-level permission state into sandbox config.

Inputs include:

- edit/read allow and deny rules
- sandbox filesystem settings
- sandbox network settings
- managed-only restrictions

This means the sandbox is not an isolated subsystem. It is the runtime projection of the permission system.

### 7. Claude Code has mode-specific behavior, but mode is not the whole model

`src/tools/BashTool/modeValidation.ts` shows one concrete example: `acceptEdits` auto-allows a narrow set of filesystem shell commands such as:

- `mkdir`
- `touch`
- `rm`
- `rmdir`
- `mv`
- `cp`
- `sed`

This is useful evidence because it shows Claude Code uses mode as a transform layer on top of the deeper rule model, not as the whole permission model.

### 8. Claude Code auto mode strips dangerous allow rules before automation

`src/utils/permissions/permissionSetup.ts` is important here.

When auto mode is enabled, dangerous allow rules that would undermine classifier-based automation are stripped temporarily and later restored. That is a strong example of the system defending itself against previously granted broad rules.

### 9. Claude Code’s network approval UX acts like a durable rule system

`src/screens/REPL.tsx` shows the sandbox network approval flow.

When a host needs approval, Claude Code can:

- show a dedicated network approval dialog
- approve or deny the host
- persist the decision as a `domain:<host>` allow or deny rule in local settings
- refresh the sandbox config immediately
- resolve all concurrent pending requests for the same host together

This makes network access a first-class grant category, not just a side effect of shell approval.

### 10. Claude Code has separate approval logic for MCP servers and other non-shell tools

`src/services/mcp/config.ts` and `src/services/mcp/utils.ts` show a separate approval path for project MCP servers, including `approved`, `rejected`, and `pending` states.

This is another sign that Claude Code does not flatten everything into bash permissions.

### 11. Claude Code’s tool execution pipeline respects permission outcomes everywhere

`src/hooks/useCanUseTool.tsx`, `src/hooks/toolPermission/handlers/interactiveHandler.ts`, and `src/services/tools/toolExecution.ts` show that permission decisions are threaded through:

- direct allow/deny paths
- automated checks and classifier flows
- interactive prompts
- headless behavior
- telemetry and decision attribution

The result is not just a prompt before execution. It is a full decision lifecycle.

## Codex vs Claude Code

### Where they strongly agree

### 1. Sandbox and approval are separate layers

Both implementations reject the idea that one mode enum is enough.

- Codex explicitly separates sandbox policy, approval policy, and per-command override.
- Claude Code separates permission mode, layered rules, trust state, and runtime sandbox config.

### 2. Some approvals must survive broad permission modes

- Codex still prompts or forbids when commands are dangerous or sandbox protection is missing.
- Claude Code still forces approval for bypass-immune path and command safety cases.

### 3. Network access needs dedicated treatment

- Codex has host/protocol/port network approval state.
- Claude Code has domain-based approval persistence and sandbox refresh.

### 4. Shell commands need special parsing-aware protections

Both implementations clearly assume shell input is too flexible for naive string matching.

### 5. Non-shell tools need their own approval tracks

Both implementations model MCP or side-effectful non-shell tools separately from shell command approval.

### Where Codex is stronger

### 1. Codex has the clearest first-class additive permission model

Its `PermissionProfile` plus `SandboxPermissions::WithAdditionalPermissions` model is explicit, structured, and enforced end to end.

### 2. Codex has the clearest separation between sandbox widening and unsandboxed escalation

That distinction is visible in both the tool-call types and the execution runtime.

### 3. Codex has an especially crisp mental model for `OnRequest`

Restricted commands run inside the sandbox by default. Approval is mostly for crossing the boundary, not for every nontrivial command.

### Where Claude Code is stronger

### 1. Claude Code has the richer rule-source and UI-context model

Its permission state includes source precedence, automation hooks, interactive flow, and headless behavior.

### 2. Claude Code has deeper path-aware shell safety logic

Its command parsing, redirect handling, dangerous path checks, and bypass-immune cases are more obviously hardened around shell edge cases.

### 3. Claude Code has a more explicit persistent rule UX for network and tool approval

The network permission dialog and MCP approval logic show a mature user-facing rule workflow.

## Synthesis: the best ideas from both implementations

If someone were designing a new permissions system based only on these implementations, the strongest reference model would be:

1. **Separate trust, base sandbox, approval policy, and runtime rule state.**
2. **Keep a first-class additive permission object** for extra read/write/network grants.
3. **Distinguish sandbox widening from unsandboxed escalation.**
4. **Protect sensitive subpaths inside writable roots.**
5. **Keep bypass-immune path and command safety checks.**
6. **Translate accumulated rule state into runtime sandbox config.**
7. **Use separate approval channels for shell, network, and MCP/non-shell tools.**
8. **Persist grants and denials as structured rules with clear scope and precedence.**

## Practical conclusions

### 1. A permission model should not be built around a single mode enum

Codex and Claude Code both go beyond that, but in different ways.

- Codex adds explicit approval policy and additive permissions.
- Claude Code adds layered rule state, trust state, and sandbox translation.

The shared lesson is the same: modes are useful presets, not a sufficient architecture.

### 2. Per-command additive permissions are worth treating as first-class data

Codex is the strongest implementation evidence here. `PermissionProfile` is the cleanest mechanism in the whole comparison for expressing: “run this command with a little more access, but still inside the sandbox.”

### 3. Protected subpaths and bypass-immune safety checks are both necessary

Codex shows the value of protected subpaths inside writable roots.
Claude Code shows the value of path-aware prompts that survive broad modes.

These are complementary, not competing, ideas.

### 4. Network permission should not ride entirely on generic shell approval

Codex and Claude Code both treat it as its own category. That is the right pattern for both UX and policy clarity.

### 5. Permission systems need a runtime story, not only a prompt story

Both implementations carry permission state into actual execution:

- Codex through sandbox policy transforms and escalation execution modes
- Claude Code through sandbox adapter config and live refresh behavior

That is what makes the permission model enforceable instead of performative.

## Final takeaway

Codex provides the cleaner **capability model**:

- default sandbox
- explicit approval policy
- structured additive grants
- explicit unsandboxed escalation

Claude Code provides the cleaner **policy orchestration model**:

- layered rule sources
- bypass-immune checks
- path-aware shell analysis
- persistent UI-driven grants for domains, tools, and working directories

The strongest overall direction is not to copy either system wholesale, but to combine:

- **Codex’s capability structure**
- with **Claude Code’s rule layering and safety gating**

That combination is the clearest implementation-backed answer from the code that was reviewed.
