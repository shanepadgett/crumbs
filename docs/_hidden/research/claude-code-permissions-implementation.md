# Claude Code Permissions Implementation Research

Scope: this document is based only on `external/claude-code/` implementation.

## Executive summary

Claude Code is not built around one permission mode switch.

It is a layered system made of:

1. a **permission context** with mode, rule sets, additional working directories, and runtime flags
2. a **rule engine** with separate allow, deny, and ask rules from multiple sources
3. **tool-specific permission logic**, especially for Bash and filesystem tools
4. a **sandbox adapter** that turns permission state into actual runtime sandbox config
5. an **interactive approval runtime** that races user input, hooks, classifiers, bridge replies, and channel replies
6. separate approval tracks for **network**, **MCP servers**, and **workspace trust**

The big implementation takeaway is this: Claude Code treats permissions as a combination of **policy state**, **tool-aware validation**, and **runtime enforcement**. The mode enum is only one input into that system.

## Primary source files

### Core permission model

- `external/claude-code/src/types/permissions.ts`
- `external/claude-code/src/Tool.ts`
- `external/claude-code/src/utils/permissions/PermissionMode.ts`
- `external/claude-code/src/utils/permissions/PermissionRule.ts`
- `external/claude-code/src/utils/permissions/permissionRuleParser.ts`
- `external/claude-code/src/utils/permissions/permissionsLoader.ts`
- `external/claude-code/src/utils/permissions/permissions.ts`
- `external/claude-code/src/utils/permissions/permissionSetup.ts`

### Filesystem and path validation

- `external/claude-code/src/utils/permissions/filesystem.ts`
- `external/claude-code/src/utils/permissions/pathValidation.ts`

### Bash-specific permission logic

- `external/claude-code/src/tools/BashTool/bashPermissions.ts`
- `external/claude-code/src/tools/BashTool/pathValidation.ts`
- `external/claude-code/src/tools/BashTool/modeValidation.ts`
- `external/claude-code/src/tools/BashTool/shouldUseSandbox.ts`
- `external/claude-code/src/tools/BashTool/bashSecurity.ts`

### Sandbox and runtime approval flow

- `external/claude-code/src/utils/sandbox/sandbox-adapter.ts`
- `external/claude-code/src/entrypoints/sandboxTypes.ts`
- `external/claude-code/src/hooks/useCanUseTool.tsx`
- `external/claude-code/src/hooks/toolPermission/PermissionContext.ts`
- `external/claude-code/src/hooks/toolPermission/handlers/interactiveHandler.ts`
- `external/claude-code/src/services/tools/toolExecution.ts`
- `external/claude-code/src/screens/REPL.tsx`

### Trust, bypass, and MCP approval

- `external/claude-code/src/interactiveHelpers.tsx`
- `external/claude-code/src/setup.ts`
- `external/claude-code/src/services/mcp/config.ts`
- `external/claude-code/src/services/mcp/utils.ts`
- `external/claude-code/src/utils/settings/constants.ts`

## 1. Data model

### Permission modes are presets, not the full system

`types/permissions.ts` and `PermissionMode.ts` define these user-facing modes:

- `default`
- `plan`
- `acceptEdits`
- `bypassPermissions`
- `dontAsk`
- `auto` when `TRANSCRIPT_CLASSIFIER` is enabled

Important implementation detail: these modes are not direct policy objects. They are transformed later by the main permission pipeline.

Examples:

- `dontAsk` is applied as a final `ask -> deny` transform in `permissions.ts`
- `acceptEdits` only auto-allows narrow filesystem behavior, not everything
- `bypassPermissions` still does **not** bypass certain safety gates
- `auto` adds classifier behavior on top of the regular permission engine

### Rules are structured by behavior and source

`types/permissions.ts` defines:

- `PermissionBehavior = allow | deny | ask`
- `PermissionRule = { source, ruleBehavior, ruleValue }`
- `PermissionRuleValue = { toolName, ruleContent? }`

Rule sources include:

- `userSettings`
- `projectSettings`
- `localSettings`
- `flagSettings`
- `policySettings`
- `cliArg`
- `command`
- `session`

`permissionRuleParser.ts` stores rules in the `ToolName(content)` string form and normalizes legacy tool names.

### The live permission state is `ToolPermissionContext`

`Tool.ts` and `types/permissions.ts` show the central runtime object:

- `mode`
- `additionalWorkingDirectories`
- `alwaysAllowRules`
- `alwaysDenyRules`
- `alwaysAskRules`
- `isBypassPermissionsModeAvailable`
- `strippedDangerousRules`
- `shouldAvoidPermissionPrompts`
- `awaitAutomatedChecksBeforeDialog`
- `prePlanMode`

This is the real center of the system. Most of Claude Code’s permission behavior is a function of this context plus tool-specific validation.

### Permission decisions carry structured reasons

`types/permissions.ts` gives every allow, ask, or deny result a `PermissionDecisionReason` such as:

- `rule`
- `mode`
- `subcommandResults`
- `hook`
- `classifier`
- `workingDir`
- `safetyCheck`
- `sandboxOverride`
- `asyncAgent`

That is important because downstream UI, analytics, retries, and tool execution all inspect the decision reason, not just the final allow/deny bit.

## 2. How permission state is initialized

### Rules are loaded additively from multiple sources

`permissionsLoader.ts` loads permission rules from enabled settings sources.

Two important enterprise controls exist:

- `allowManagedPermissionRulesOnly` forces Claude Code to ignore non-policy permission rules
- `shouldShowAlwaysAllowOptions()` hides persistent allow choices when managed-only rules are enforced

`settings/constants.ts` shows settings source order is:

1. `userSettings`
2. `projectSettings`
3. `localSettings`
4. `flagSettings`
5. `policySettings`

For general settings, later sources override earlier ones. For permission rules, Claude Code loads rules additively into the context unless managed-only rules collapse the source set.

### CLI rules and directories are merged into the same context

`permissionSetup.ts` builds the initial `ToolPermissionContext` by combining:

- rules from disk
- CLI `--allowed-tools`
- CLI `--disallowed-tools`
- base-tool presets
- additional directories from settings and `--add-dir`

It also adds `process.env.PWD` as an extra working directory when it is a symlink alias of the original cwd, so symlinked shells do not produce permission mismatches.

### Auto mode removes dangerous allow rules before it starts

`permissionSetup.ts` contains one of the most important design choices in the whole system.

Before entering `auto` mode, Claude Code attempts to strip dangerous allow rules from the live context when they come from mutable/runtime-managed sources. Examples include:

- `Bash(*)`
- broad interpreter rules like `Bash(python:*)`
- dangerous PowerShell rules like `PowerShell(iex:*)`
- Agent allow rules that would auto-approve sub-agent launches

These stripped rules are saved in `strippedDangerousRules` and restored when leaving auto mode.

Implementation nuance: the helper only removes rules from sources it can rewrite in the live context update pipeline, such as user, project, local, session, and CLI-argument sources. Read-only sources like managed policy are logged but not rewritten by that helper.

This means Claude Code explicitly defends the classifier from user rules that would otherwise nullify it.

### Plan mode and auto mode are intentionally entangled

`permissionSetup.ts` uses `prePlanMode` plus `prepareContextForPlanMode()` and `transitionPlanAutoMode()` to keep plan mode separate from, but interoperable with, auto mode.

Plan mode can preserve prior mode state and optionally keep auto semantics active during planning, depending on settings and gate state.

## 3. The main permission decision pipeline

`permissions.ts` is the core implementation.

### The order is strict

The effective order is:

1. whole-tool deny rules
2. whole-tool ask rules
3. tool-specific permission check
4. bypass-immune tool results
5. bypass mode or whole-tool allow rules
6. convert passthrough into ask
7. mode transforms like `dontAsk` and `auto`
8. headless fallback behavior

This ordering matters more than the mode names.

### Tool-specific checks happen before broad allow behavior

`hasPermissionsToUseToolInner()` calls `tool.checkPermissions(...)` before broad allow handling.

That means tool-specific logic can still:

- deny the action
- force an ask due to content-specific rules
- force an ask due to safety checks

even when the mode is broad.

### `bypassPermissions` is not a total bypass

The pipeline explicitly preserves several checks before `bypassPermissions` is allowed to auto-allow.

In particular, Claude Code still respects:

- tool-level denies
- content-specific ask rules
- tool-denied results
- `safetyCheck` results
- tools that require explicit user interaction

So bypass mode is broad, but not absolute.

### `dontAsk` is a final deny transform

If the pipeline returns `ask` and the current mode is `dontAsk`, `permissions.ts` turns the result into a deny with a mode-based rejection reason.

This happens late, so earlier safety and rule checks still run normally.

### `auto` mode adds fast paths before classifier use

When the result is `ask`, `permissions.ts` tries several shortcuts before the expensive transcript classifier call:

1. if the action would already be allowed in `acceptEdits`, allow it
2. if the tool is in the auto-mode safe allowlist, allow it
3. otherwise run the transcript classifier

This keeps auto mode from spending classifier calls on obviously safe cases.

### Some safety checks are classifier-approvable, others are not

`PermissionDecisionReason.safetyCheck` includes `classifierApprovable: boolean`.

Claude Code uses that to distinguish between:

- safety cases that the classifier may evaluate, like sensitive file edits
- safety cases that must remain interactive only, like suspicious Windows path patterns

This is a subtle but strong design choice.

### Headless agents do not get free prompting

When `shouldAvoidPermissionPrompts` is true, Claude Code does **not** show permission UI.

Instead it:

1. gives `PermissionRequest` hooks a chance to allow or deny
2. auto-denies if no hook resolves the request

That behavior lives in `permissions.ts` and `PermissionContext.ts`.

## 4. Filesystem permissions

The filesystem model lives mainly in `filesystem.ts` and `utils/permissions/pathValidation.ts`.

### Working directories are the baseline read/write scope

Claude Code starts from:

- the original cwd
- additional working directories added in settings or via `/add-dir`
- some symlink-equivalent cwd aliases

`pathInAllowedWorkingPath()` resolves both input paths and working directories through the same path-resolution machinery so symlinked forms do not accidentally bypass or break checks.

### File rules use path patterns rooted by source

`filesystem.ts` implements several path conventions:

- `//path` means filesystem-root relative
- `~/path` means home-relative
- `/path` means relative to the settings source root
- `./path` or plain relative patterns are matched without a source root

This is a big implementation detail. Claude Code’s path rules are not just raw absolute paths; they depend on where the rule came from.

### Reads and writes have separate rule evaluation

`checkReadPermissionForTool()` and `checkWritePermissionForTool()` are separate pipelines.

For reads:

1. block UNC paths and suspicious Windows patterns early
2. apply read-specific deny rules
3. apply read-specific ask rules
4. treat write permission as implying read permission
5. allow reads in working directories
6. allow reads from internal harness paths
7. apply read allow rules
8. otherwise ask, usually with read-rule suggestions

For writes:

1. apply write deny rules
2. allow special internal editable paths
3. allow narrowly scoped session `.claude/**` rules before safety checks
4. run safety checks
5. apply write ask rules
6. auto-allow working-dir writes only in `acceptEdits`
7. apply write allow rules
8. otherwise ask

### Certain paths are bypass-immune safety cases

`filesystem.ts` protects dangerous files and directories like:

- `.git`
- `.vscode`
- `.idea`
- `.claude`
- shell RC files
- `.gitconfig`
- `.mcp.json`
- `.claude.json`

`checkPathSafetyForAutoEdit()` turns these into `safetyCheck` ask results before broad allow logic can auto-approve them.

### `.claude` has a special narrow session bypass for skills

Claude Code makes one very specific exception.

`checkWritePermissionForTool()` allows session-scoped `.claude/**` edit rules to bypass the general `.claude` safety wall, but only when the rule is properly scoped and only for session rules.

`getClaudeSkillScope()` can generate a narrower `.claude/skills/<name>/**` suggestion instead of requiring permission for all of `.claude/`.

This is one of the cleanest examples of Claude Code using narrow-scoped grants instead of broad folder grants.

### Internal harness paths get explicit carve-outs

`filesystem.ts` silently allows certain internal paths, including things like:

- current-session plan files
- scratchpad files
- agent memory files
- session memory reads
- project memory directories
- tool result storage
- some job or preview files

These are implementation carve-outs, not general user-granted permissions.

## 5. Bash permission system

The Bash implementation is the most sophisticated part of the whole permission system.

### Bash has its own rule grammar

From `bashPermissions.ts` and `shellRuleMatching.ts`, Bash rules support:

- exact command rules
- legacy prefix rules via `:*`
- wildcard rules using `*`

Examples:

- exact: `Bash(git status)`
- prefix: `Bash(git:*)`
- wildcard: `Bash(git * --stat)`

### Rule matching normalizes wrappers and env prefixes

Before matching, Bash permission code strips safe wrappers and safe leading env vars for allow checks, and strips all leading env vars for deny/ask matching.

This prevents trivial bypasses like:

- `FOO=bar denied_command`
- `timeout 30 dangerous_command`
- `nohup -- command`

The implementation is careful about not over-stripping unsafe forms that would change the actual runtime meaning of the shell command.

### Bash is analyzed structurally first

`bashPermissions.ts` tries an AST-based parse first.

If tree-sitter parsing succeeds and the command is simple enough, Claude Code uses AST-derived commands and redirects for later checks.

If parsing says the command is too complex, Claude Code falls back to a guarded ask path after respecting exact/prefix deny rules.

This is the core reason Claude Code’s Bash system is stronger than naive command-string matching.

### There is still a legacy regex security path

When AST parsing is unavailable, `bashSecurity.ts` provides a legacy safety layer with validators for cases such as:

- command substitution
- dangerous redirections
- newline and comment desync issues
- IFS injection
- backslash-escaped whitespace or operators
- brace expansion
- Unicode whitespace
- zsh-specific dangerous commands

`bashPermissions.ts` treats that legacy path as a fail-closed safety backstop.

### Bash denies and asks are checked before path validation

This ordering is intentional.

`bashToolCheckPermission()` first checks:

1. exact deny or ask
2. prefix or wildcard deny or ask
3. only then path constraints

That prevents path-based checks from accidentally weakening explicit Bash deny rules.

### Path validation for Bash is command-aware

`tools/BashTool/pathValidation.ts` understands specific path-bearing commands such as:

- `cd`
- `ls`
- `find`
- `mkdir`
- `touch`
- `rm`
- `mv`
- `cp`
- `cat`
- `grep`
- `rg`
- `sed`
- `git`

It also validates:

- output redirections
- dangerous removal targets like `/`, home, drive roots, and root children
- compound `cd` plus write/redirection patterns
- process substitution like `>(...)` and `<(...)`
- `--` end-of-options handling so `rm -- -/../foo` still gets validated

### Bash has compound-command-specific safety rules

`bashPermissions.ts` blocks or prompts for several cross-command patterns, especially:

- multiple `cd` commands in one compound command
- compound commands containing both `cd` and `git`
- redirections in compound commands that change directory

The `cd + git` check is specifically there to prevent bare-repository attacks.

### `acceptEdits` is narrow for Bash

`modeValidation.ts` shows `acceptEdits` only auto-allows a small set of filesystem commands:

- `mkdir`
- `touch`
- `rm`
- `rmdir`
- `mv`
- `cp`
- `sed`

So `acceptEdits` is not a general “allow Bash” mode.

### Bash also has sandbox-based auto-allow

If sandboxing is enabled and `sandbox.autoAllowBashIfSandboxed` is on, `bashPermissions.ts` can auto-allow commands that will execute inside the sandbox.

`shouldUseSandbox.ts` decides whether a command stays sandboxed. It can refuse sandboxing for:

- `dangerouslyDisableSandbox`
- user-configured excluded commands
- settings that explicitly allow unsandboxed execution

The implementation is explicit that `excludedCommands` is a convenience feature, not a security boundary.

### Claude Code has two different Bash classifier concepts

This is easy to miss.

1. **Bash prompt classifier**
   - tied to Bash prompt deny/ask descriptions
   - used to decide whether a Bash permission prompt can be auto-approved or must be prompted

2. **Auto mode transcript classifier**
   - used by `permissions.ts` when mode is `auto`
   - sees broader transcript context and makes the main auto-mode decision

These are related, but not the same mechanism.

## 6. Sandbox integration

The sandbox layer is implemented in `utils/sandbox/sandbox-adapter.ts`.

### The sandbox config is derived from permission state

`convertToSandboxRuntimeConfig()` turns Claude Code settings and permission rules into sandbox-runtime config.

It derives:

- allowed and denied domains from WebFetch rules and sandbox network settings
- read and write allow/deny filesystem lists
- unix socket and local binding settings
- ripgrep sandbox config
- weaker nested-sandbox and weaker network-isolation flags

This means runtime sandbox policy is a projection of Claude Code permission state, not an unrelated subsystem.

### Claude Code injects its own hard protections into sandbox config

The adapter always adds protections for things like:

- Claude settings files
- managed settings directories
- `.claude/skills`
- bare-repo indicator files at cwd
- worktree main repo paths when needed
- current cwd and Claude temp dir as writable paths

So the sandbox is not merely mirroring user grants. It also encodes Claude Code’s own safety assumptions.

### Managed policy can restrict sandbox reads and network domains

The adapter has separate controls for:

- `allowManagedSandboxDomainsOnly`
- `allowManagedReadPathsOnly`

So enterprise policy can restrict which sandbox-derived permissions are even considered.

### Sandbox config is live-updated

`initialize()` subscribes to settings changes and calls `BaseSandboxManager.updateConfig(...)` whenever settings change.

`refreshConfig()` exists for immediate updates after permission persistence so there is no race where old sandbox config lingers after a newly approved or denied rule.

### Sandbox availability is explicit

The adapter distinguishes:

- sandbox enabled in settings
- sandbox actually supported on this platform
- sandbox dependencies actually installed
- sandbox required via `failIfUnavailable`

`REPL.tsx` surfaces this at startup:

- warning notification if sandbox was requested but cannot run
- hard exit if `sandbox.failIfUnavailable` is set

That is a real fail-closed option.

## 7. Interactive approval runtime

The permission engine does not stop at “return ask”. There is a full approval orchestration layer.

### `toolExecution.ts` runs hooks before permission UI

`checkPermissionsAndCallTool()` in `toolExecution.ts` does all of this before the tool actually runs:

- validates tool input
- starts speculative Bash classifier work early
- runs `PreToolUse` hooks
- accepts hook-supplied updated input or hook permission decisions
- only then calls the permission system

This means permission prompts are downstream of pre-tool policy and hook preprocessing.

### `useCanUseTool.tsx` is the main orchestrator

It takes the result of `hasPermissionsToUseTool(...)` and routes it through:

- direct allow/deny resolution
- coordinator-worker automated checks
- swarm-worker approval paths
- speculative Bash classifier race
- interactive permission dialog

This is the central approval scheduler for interactive sessions.

### `PermissionContext.ts` owns persistence and resolution helpers

`createPermissionContext()` encapsulates:

- logging decisions
- persisting permission updates
- building allow/deny results
- running `PermissionRequest` hooks
- classifier-based auto-approval helpers
- queue operations for the UI

This keeps the interactive permission handler from directly owning persistence logic.

### `interactiveHandler.ts` is built as a race

The interactive handler deliberately races multiple possible approvers against each other:

- local user input
- `PermissionRequest` hooks
- Bash classifier auto-approval
- bridge responses from remote control / claude.ai
- channel replies from external chat channels

It uses a resolve-once guard so only the first winner commits the decision.

This is a more advanced design than a simple synchronous modal dialog.

### Queue entries can be rechecked after permission changes

`REPL.tsx` rechecks queued permission items when `toolPermissionContext` changes.

That means if one prompt persists a rule like “always allow”, later queued items can auto-resolve without re-prompting.

## 8. Network approval behavior

Claude Code treats sandbox network permission as its own workflow.

### Network access requests go through `sandboxAskCallback`

`REPL.tsx` installs a `sandboxAskCallback` into `SandboxManager.initialize(...)`.

When a host needs approval, Claude Code can:

- show a local network approval dialog
- relay the request through the bridge
- forward worker requests to a swarm leader
- dedupe concurrent requests for the same host

### Persistent network approvals are stored as permission rules

When the user chooses to persist a network approval, `REPL.tsx` writes a permission update like:

- `toolName: WebFetch`
- `ruleContent: domain:<host>`
- `behavior: allow` or `deny`
- `destination: localSettings`

Then it immediately calls `SandboxManager.refreshConfig()`.

So network approvals are not ephemeral one-off shell exceptions. They become durable rule entries that the sandbox layer consumes.

## 9. MCP approval is separate from tool permission approval

Claude Code treats MCP server approval as a distinct policy layer.

### Project MCP servers have `approved | rejected | pending` status

`services/mcp/utils.ts` computes project MCP status using:

- explicit enabled server list
- explicit disabled server list
- `enableAllProjectMcpServers`

It also auto-approves project MCP servers in two special cases when project settings are enabled:

- dangerous bypass mode after the user has already accepted the bypass dialog
- non-interactive sessions where no popup can be shown

### Only approved project MCP servers are activated

`services/mcp/config.ts` filters project servers so only approved ones are merged into the active MCP config.

This is a separate approval track from generic tool permission prompts.

## 10. Trust and dangerous bypass are separate from tool permissions

Claude Code does not treat workspace trust as the same concept as tool permission.

### Trust is always checked in interactive sessions

`interactiveHelpers.tsx` explicitly says the trust dialog is the workspace trust boundary and is shown regardless of permission mode.

That trust flow also gates:

- CLAUDE.md external include approval
- MCP `.mcp.json` approvals
- later environment application and telemetry initialization

### Bypass mode is hard-gated by environment checks

`setup.ts` refuses dangerous bypass mode in unsafe environments.

Examples:

- root or sudo on Unix, unless already sandboxed
- ant builds outside an isolated container / sandbox
- environments with internet access when bypass requires offline containment

So `bypassPermissions` is not just a mode toggle. It is guarded by startup safety policy.

## 11. What Claude Code’s implementation is actually optimizing for

From the code, Claude Code is optimizing for these properties:

1. **Broad usability in default mode**
   - working-directory reads are easy
   - common edits can graduate to `acceptEdits`

2. **Strong special handling for Bash**
   - shell is treated as structurally adversarial input

3. **Path-aware safety even in broad modes**
   - `.git`, `.claude`, shell configs, dangerous removals, and redirect tricks still matter

4. **Auto mode that is safer than raw bypass**
   - dangerous preexisting allow rules are stripped
   - classifier fast paths are constrained

5. **Runtime enforcement, not just UI prompts**
   - sandbox config updates with permission state
   - network grants refresh sandbox immediately

6. **Multiple approval surfaces**
   - local UI
   - hooks
   - classifiers
   - bridge
   - channels
   - swarm/coordinator workflows

## Final conclusions

Claude Code’s permission system is best understood as three interlocked layers:

### 1. Policy state

- modes
- allow/deny/ask rules
- additional working directories
- trust state
- managed-policy restrictions

### 2. Tool-aware decision logic

- filesystem read/write pipelines
- Bash AST parsing and shell-aware validation
- bypass-immune safety checks
- auto-mode classifier flow

### 3. Runtime enforcement and approval orchestration

- sandbox config generation
- startup fail-closed options
- interactive prompt racing across local and remote approvers
- persistent network and MCP approval handling

The most important implementation insight is that Claude Code does **not** rely on one mechanism.

It combines:

- rule layering
- mode transforms
- path-sensitive safety checks
- shell parsing
- classifier automation
- sandbox enforcement
- separate trust and MCP approval flows

That combination is the actual architecture.
