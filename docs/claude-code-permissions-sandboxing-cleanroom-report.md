# Claude Code Permissioning And Sandboxing Cleanroom Report

## Scope

This report is derived only from code under `external/claude-code`. It describes the permissioning and sandboxing system that is visible in that tree, the boundaries between its layers, and the implementation surface required to recreate the aggregate behavior.

## System Shape

Claude Code does not implement permissioning as a single "tool prompt" layer. The architecture in this tree is a stack:

- Workspace trust is an outer gate. Untrusted directories can disable assistant behavior before tool permissions are even relevant. Evidence: [interactiveHelpers.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/interactiveHelpers.tsx#L150), [main.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/main.tsx#L1597)
- Permission mode and rule-source loading decide what rules exist in memory and which settings sources are authoritative. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/types/permissions.ts#L16), [permissionsLoader.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionsLoader.ts#L31)
- The core decision engine evaluates deny rules, ask rules, tool-specific analyzers, safety checks, mode behavior, allow rules, classifier escalation, and headless hook fallbacks in a fixed order. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1078), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1238)
- Filesystem policy is not string matching on one path. It is based on normalized working-directory membership, multiple path representations, symlink-aware resolution, sensitive-path blocking, and separate read/write pipelines. Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L667), [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L138)
- Bash and PowerShell have separate analyzers. Claude Code does not reuse one generic shell policy layer for both. Evidence: [bashPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/bashPermissions.ts#L1), [modeValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/PowerShellTool/modeValidation.ts#L1)
- A sandbox adapter projects permission context and managed policy into an execution runtime built on `@anthropic-ai/sandbox-runtime`. Evidence: [sandbox-adapter.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sandbox/sandbox-adapter.ts#L62), [sandboxTypes.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sandboxTypes.ts#L1)
- Remote sessions, swarm workers, MCP channels, MCP server approval, and computer-use grants are distinct approval surfaces layered over the same core concepts. Evidence: [RemoteSessionManager.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/remote/RemoteSessionManager.ts#L153), [permissionSync.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/swarm/permissionSync.ts#L676), [channelPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelPermissions.ts#L40), [ComputerUseApproval.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx#L24)

The minimum faithful recreation is therefore a multi-layer system, not an extension dialog plus a few allowlists.

## Permission Modes And Rule Sources

External or SDK-facing permission modes are:

- `default`
- `acceptEdits`
- `bypassPermissions`
- `plan`
- `dontAsk`

Evidence: [coreSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/coreSchemas.ts#L337), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/types/permissions.ts#L16)

There is also an internal `auto` mode that exists only when transcript-classifier support is enabled. It is intentionally not part of the external permission-mode surface and is mapped back to `default` when exposed outward. Evidence: [PermissionMode.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionMode.ts#L80), [PermissionMode.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionMode.ts#L111)

Mode behavior is narrower than their names imply:

- `acceptEdits` is not "allow everything". It only auto-allows certain write cases inside allowed working directories, after safety checks. Evidence: [pathValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/pathValidation.ts#L198), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1360)
- `bypassPermissions` does not bypass everything. Deny rules, ask rules that are content-specific, and safety checks still run before mode-based bypass takes effect. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1238), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1252)
- `plan` can inherit bypass behavior only when `isBypassPermissionsModeAvailable` is set. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1265)
- `dontAsk` is implemented as a late fail-closed transform: if the decision is still `ask`, it becomes `deny`. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L503)

Rule sources are explicit:

- `userSettings`
- `projectSettings`
- `localSettings`
- `flagSettings`
- `policySettings`
- `cliArg`
- `command`
- `session`

Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/types/permissions.ts#L54), [settings/constants.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/settings/constants.ts#L7)

Precedence is source ordered. Later sources override earlier ones, and the aggregation code uses later `Map.set()` writes to win on duplicate `toolName + ruleContent` keys. Evidence: [settings/constants.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/settings/constants.ts#L4), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L109), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L386)

Only three destinations are truly persisted or user-editable:

- `userSettings`
- `projectSettings`
- `localSettings`

`session` and `cliArg` can exist as update destinations in memory, but `persistPermissionUpdate()` only writes those three editable settings sources. Attempts to delete rules from policy, flag, or command sources are rejected. Evidence: [PermissionUpdate.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionUpdate.ts#L208), [PermissionUpdate.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionUpdate.ts#L222), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1334)

Persisted targets are concrete files:

- global user settings under Claude config home
- project `.claude/settings.json`
- local `.claude/settings.local.json`

Persisted mode changes are written to `permissions.defaultMode`. Evidence: [settings.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/settings/settings.ts#L264), [settings.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/settings/settings.ts#L302), [PermissionUpdate.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionUpdate.ts#L317)

Managed policy can override the entire loading model. If `allowManagedPermissionRulesOnly` is true, the loader accepts only `policySettings`, removes non-policy buckets from memory, and hides "always allow" UI. Evidence: [settings/types.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/settings/types.ts#L500), [permissionsLoader.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionsLoader.ts#L42), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1425)

## Mode Transitions, Auto Mode, And Dangerous Rule Stripping

`transitionPermissionMode()` is the central mode-transition function. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L581)

The important behavior is:

- Entering internal `auto` checks whether the auto gate is available, sets auto-mode active state, and strips dangerous rules that would bypass classifier review. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L597), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L627)
- Leaving classifier-backed modes restores stripped rules and preserves information needed to resume after plan mode exits. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L633), [ExitPlanModePermissionRequest.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx#L397)
- Entering `plan` delegates to specialized logic that can keep auto semantics active or reactivate them depending on feature gates and settings. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L1462), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L1480)

Dangerous-rule stripping is a concrete anti-bypass mechanism, not a UI preference. The dangerous set includes:

- broad Bash allow rules
- interpreter-prefix shell rules
- broad or dangerous PowerShell rules
- agent-wide allow rules
- ant-only `Tmux` allow rules

Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L84), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L150), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L236)

The implementation strips only mutable destinations, records the removed rule strings in `strippedDangerousRules`, and restores them when the session exits the classifier-backed mode. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L453), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L510), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L561)

One caveat is visible in the tree: dangerous rules can be detected from read-only sources like managed policy or flags, but the stripping implementation mutates only destinations that are valid `PermissionUpdateDestination`s. That suggests a potential sharp edge unless some other layer prevents those sources from reintroducing bypass behavior in auto mode. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L295), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L472)

## Core Decision Pipeline

The core engine is ordered and layered. The important implementation fact is not just which checks exist, but when each one runs.

The observed order is:

1. Pre-tool hooks run before permission resolution and may modify input or propose allow/deny/ask.
2. Rule-based resolution evaluates deny rules before ask rules.
3. Tool-specific permission logic runs.
4. Safety checks run.
5. Mode-based bypass can apply.
6. Explicit always-allow logic can apply.
7. Passthrough decisions can be converted back to `ask`.
8. Internal auto mode can call the classifier, but only if the decision is still `ask`.
9. In `dontAsk`, any remaining `ask` becomes `deny`.

Evidence: [toolExecution.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/tools/toolExecution.ts#L800), [toolHooks.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/tools/toolHooks.ts#L321), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L518), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L929), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1238)

Two design decisions matter:

- Safety checks are deliberately bypass-immune. Bypass mode is later than those checks. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L1238)
- Auto classifier review is not first-line policy. It only runs after ordinary rule evaluation still yields `ask`, and it short-circuits cases that would already be safe in `acceptEdits` or on safe-tool allowlists. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L533), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L560), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L688)

Hooks are part of the permission model, not an afterthought:

- `PreToolUse` can modify input and propose a permission decision, but a hook `allow` still passes through rule checks, so deny or ask rules can override it. Evidence: [toolHooks.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/tools/toolHooks.ts#L372), [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L929)
- `PermissionRequest` hooks are used in headless or async flows when a prompt would otherwise be required. Evidence: [toolExecution.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/tools/toolExecution.ts#L1073)
- `PermissionDenied` hooks can request retry after an auto-mode classifier denial. Evidence: [hooks.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/hooks.ts#L3529)

Hook payloads are permission-aware and can carry permission suggestions, updated input, and permission updates. Evidence: [coreSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/coreSchemas.ts#L388), [coreSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/coreSchemas.ts#L425), [coreSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/coreSchemas.ts#L875)

## Filesystem Model

### Effective Workspace

The effective workspace is not just the real current working directory.

- The base is `getOriginalCwd()`.
- Additional working directories can be added through settings or CLI.
- Startup can automatically add `process.env.PWD` as a session-scoped working directory when it is only a symlink alias of the real cwd.

Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L913), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L993), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L667)

Extra directories are canonicalized with `resolve(expandPath(...))`, must exist, must be directories, and are rejected if they are already covered by an existing working directory. Evidence: [validation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/commands/add-dir/validation.ts#L41), [validation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/commands/add-dir/validation.ts#L79), [PermissionUpdate.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/PermissionUpdate.ts#L122)

### Path Representation And Normalization

Authorization is evaluated against multiple representations of a path:

- original path
- intermediate symlink targets
- final realpath
- deepest existing ancestor for nonexistent or dangling targets

Evidence: [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L138), [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L215), [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L325)

Containment checks normalize aggressively:

- lowercase path forms
- Windows-to-POSIX normalization for relative matching
- macOS `/private/var` and `/private/tmp` handling
- traversal rejection on any relative result

Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L90), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L683), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L738)

`safeResolvePath()` blocks UNC access before filesystem resolution and avoids `realpath()` on FIFOs, sockets, and devices. Evidence: [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L288), [fsOperations.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/fsOperations.ts#L376)

### Read And Write Pipelines

Read and write are separate decision pipelines.

Write checks are ordered to prevent privilege escalation:

- edit-deny rules first
- internal editable carveouts
- sensitive-path safety checks
- working-directory plus `acceptEdits`
- explicit allow rules
- otherwise prompt

Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1205), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1241), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1360), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1377)

That ordering is deliberate. Sensitive-path safety runs before working-directory and mode-based auto-allow, so `acceptEdits` cannot bypass `.claude`, `.git`, or similar protections. Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1302)

Read checks are stricter than "edit implies read":

- Windows-pattern and UNC checks first
- read-specific deny rules
- read-specific ask rules
- only then can write permission imply read permission
- working-directory and internal harness reads come after those read-specific rule checks

Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1050), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1081), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1124), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1153)

### Path Validation And Sensitive Paths

The path validator blocks shell-time reinterpretation, not just lexical traversal. It rejects:

- Windows UNC paths
- unexpanded `~user`, `~+`, `~-`
- `$`, `%`, or leading `=` expansion syntax
- glob patterns for write or create

Read globs are allowed only by validating the base directory. Evidence: [pathValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/pathValidation.ts#L373), [pathValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/pathValidation.ts#L438)

Sensitive-path blocking is broad and case-insensitive. The protected set includes:

- `.git`
- `.vscode`
- `.idea`
- `.claude`
- shell rc files
- `.gitconfig`
- `.gitmodules`
- `.mcp.json`
- `.claude.json`
- Claude project config directories like `.claude/commands`, `.claude/agents`, and `.claude/skills`

`.claude/worktrees` is an explicit exception. Evidence: [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L57), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L200), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L620)

### `.claude` Carveouts And Internal Harness Paths

`.claude` grants are intentionally session-scoped. The UI can synthesize session-only rules like:

- `Edit('/.claude/**')`
- `Edit('~/.claude/**')`

For `.claude/skills/<name>/...`, the backend can narrow this to a single skill subtree, after rejecting `..` and glob metacharacters in the skill name. Evidence: [constants.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/FileEditTool/constants.ts#L4), [permissionOptions.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/components/permissions/FilePermissionDialog/permissionOptions.tsx#L105), [usePermissionHandler.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/components/permissions/FilePermissionDialog/usePermissionHandler.ts#L104), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L101)

Internal harness paths are on explicit allowlists, not implicit workspace membership. Read and write carveouts exist for current-session plans, session memory, tool-results, scratchpads, task/team directories, and related Claude-managed storage. The bundled-skill temp root uses a per-process nonce to prevent predictable temp-tree precreation or symlink attacks. Evidence: [sessionStorage.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sessionStorage.ts#L198), [plans.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/plans.ts#L79), [toolResultStorage.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/toolResultStorage.ts#L104), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L261), [filesystem.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/filesystem.ts#L1479)

## Bash Permissioning

Bash permissioning is parser-driven and conservative.

- The command is parsed as shell syntax first.
- On parser uncertainty or excessive complexity, the logic fails closed and asks.
- Rules support exact, prefix, and wildcard forms.
- Matching strips wrappers, environment assignments, and handles `xargs`-style delegation.
- Compound commands are permissioned per subcommand, not once for the whole string.

Evidence: [bashPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/bashPermissions.ts#L1), [bashPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/bashPermissions.ts#L132), [bashPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/bashPermissions.ts#L281)

The sandbox and the Bash permissioner are coupled. If a Bash command is actually going to execute inside the sandbox and there are no conflicting rules, the permissioner can auto-allow on that basis. Evidence: [bashPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/bashPermissions.ts#L410)

`acceptEdits` Bash safety is intentionally narrow:

- read-only validation uses a conservative allowlist
- compound `cd && git` patterns are blocked
- bare-repo cases are treated specially
- git internal file creation plus git commands are blocked
- git outside the original cwd is blocked while sandboxing is enabled

Evidence: [readOnlyValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/readOnlyValidation.ts#L1), [readOnlyValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/readOnlyValidation.ts#L214)

Path validation for Bash is also conservative. It blocks:

- flags that hide path targets from static inspection
- write operations combined with `cd`
- redirect targets that are shell-expanded
- process substitution
- dangerous removals

Evidence: [pathValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/pathValidation.ts#L1), [pathValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/pathValidation.ts#L192)

This is a materially richer shell-permission system than rule-matching on raw command strings. A faithful recreation needs an AST-backed command decomposition layer, wrapper stripping, per-subcommand evaluation, and shell-specific static analysis.

## PowerShell Permissioning

PowerShell has its own analyzer and it is at least as strict as the Bash side.

Important behavior visible in the tree:

- matching is case-insensitive and canonicalized
- resolution is deny-first
- parse degradation is treated conservatively
- `acceptEdits` auto-allows only carefully validated filesystem cmdlets
- the validator rejects subexpressions, script blocks, member invocation, splatting, assignments, stop-parsing, expandable strings, path-like command names, and unclassifiable argument forms
- cwd-changing compounds and symlink-creation compounds are rejected in the permissive modes

Evidence: [modeValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/PowerShellTool/modeValidation.ts#L1), [modeValidation.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/PowerShellTool/modeValidation.ts#L270)

There is also a type-level safety gate tied to Constrained Language Mode semantics. The implementation inverts an allowlisted set of .NET types; type literals outside that set force an ask path. Evidence: [clmTypes.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/PowerShellTool/clmTypes.ts#L1)

The sandbox path on Windows is also special-cased. `Shell.exec()` wraps sandboxed PowerShell execution through `/bin/sh -c 'pwsh ... EncodedCommand'`, and the PowerShell tool contains explicit refusal paths when sandbox policy cannot support the request. Evidence: [Shell.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/Shell.ts#L128), [PowerShellTool.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/PowerShellTool/PowerShellTool.tsx#L1)

Recreating this requires a dedicated PowerShell parser and policy layer. Treating PowerShell as a second spelling of Bash would miss the core design.

## Sandbox Runtime And Policy Projection

Claude Code uses a sandbox adapter over `@anthropic-ai/sandbox-runtime`. The adapter translates internal permission context and managed settings into runtime config. Evidence: [sandbox-adapter.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sandbox/sandbox-adapter.ts#L62)

The exposed schema includes:

- `enabled`
- `failIfUnavailable`
- `autoAllowBashIfSandboxed`
- `allowUnsandboxedCommands`
- network domain allowlists and managed-only clamps
- Unix socket and local binding controls
- proxy ports
- filesystem allow-read, deny-read, allow-write, deny-write
- managed-only read-path clamp
- excluded commands
- platform gating

Evidence: [sandboxTypes.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sandboxTypes.ts#L1)

The adapter behavior matters more than the schema list:

- network allowlists are derived from `sandbox.network.allowedDomains` plus `WebFetch(domain:...)` permission rules
- `allowManagedDomainsOnly` can clamp network policy to managed settings only
- `allowManagedReadPathsOnly` can clamp read-path policy the same way
- write allowlists are seeded with `.` and the Claude temp directory
- additional working directories are projected into sandbox write allowances
- the adapter explicitly denies writes to settings, `.claude/skills`, and paths that could be used for bare-repo or git-hook escape
- a worktree main repo can still be granted write access

Evidence: [sandbox-adapter.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sandbox/sandbox-adapter.ts#L164), [sandbox-adapter.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sandbox/sandbox-adapter.ts#L232), [sandbox-adapter.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/sandbox/sandbox-adapter.ts#L339)

Two implementation constraints are explicit:

- `excludedCommands` is a convenience mechanism, not a security boundary. Evidence: [shouldUseSandbox.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/shouldUseSandbox.ts#L19)
- Unsandboxed execution is only available if `allowUnsandboxedCommands` is set. `dangerouslyDisableSandbox` does not work otherwise. Evidence: [shouldUseSandbox.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/tools/BashTool/shouldUseSandbox.ts#L52)

`Shell.exec()` is the join point where provider-built commands are optionally wrapped in sandbox execution and followed by sandbox cleanup. Evidence: [Shell.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/Shell.ts#L94), [Shell.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/Shell.ts#L180)

## Remote, Swarm, Bridge, MCP, And Computer-Use Approval Surfaces

### Remote Session Transport

Remote approval prompts travel as SDK `control_request` messages with `request.subtype === 'can_use_tool'`. `RemoteSessionManager` stores them by `request_id` and answers with `control_response`. Cancellation is explicit through `control_cancel_request`. Evidence: [RemoteSessionManager.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/remote/RemoteSessionManager.ts#L153), [RemoteSessionManager.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/remote/RemoteSessionManager.ts#L247), [controlSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/controlSchemas.ts#L106), [controlSchemas.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/entrypoints/sdk/controlSchemas.ts#L612)

The remote response shape is intentionally narrower than the local engine. Remote, direct-connect, and SSH flows carry `allow + updatedInput` or `deny + message`, but do not round-trip richer permission-update state the way local bridge or SDK paths can. Evidence: [useRemoteSession.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/useRemoteSession.ts#L376), [useDirectConnect.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/useDirectConnect.ts#L132), [useSSHSession.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/useSSHSession.ts#L133)

Remote-only tools are still rendered through local permission UI by fabricating synthetic assistant `tool_use` messages and a stub tool that always requires permissions. Evidence: [remotePermissionBridge.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/remote/remotePermissionBridge.ts#L7), [remotePermissionBridge.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/remote/remotePermissionBridge.ts#L48)

### Swarm And Worker Approval

Swarm worker approvals use a mailbox protocol with concrete JSON shapes:

- `permission_request` carries `tool_name`, `input`, `tool_use_id`, and `permission_suggestions`
- `permission_response` carries `updated_input` and `permission_updates` on allow, or `error` on reject
- `team_permission_update` is a separate session-grant propagation channel

Evidence: [teammateMailbox.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/teammateMailbox.ts#L449), [permissionSync.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/swarm/permissionSync.ts#L676), [teammateMailbox.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/teammateMailbox.ts#L979)

Worker-side handlers register callbacks before sending the request, set pending state while waiting, and resolve aborts so workers do not hang. Evidence: [swarmWorkerHandler.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/toolPermission/handlers/swarmWorkerHandler.ts#L67), [swarmWorkerHandler.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/toolPermission/handlers/swarmWorkerHandler.ts#L122)

Team leads resolve worker requests through the ordinary tool-confirm queue. In-process teammates can avoid mailbox IPC entirely and write granted permission updates directly into shared leader context with `preserveMode: true`. Evidence: [useInboxPoller.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/hooks/useInboxPoller.ts#L280), [leaderPermissionBridge.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/swarm/leaderPermissionBridge.ts#L4), [inProcessRunner.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/swarm/inProcessRunner.ts#L250)

There is also a distinct swarm path for sandbox/network host approval. Leaders can persist `WebFetch` `domain:<host>` rules to `localSettings`, and REPL sessions can forward that same host approval outward as a synthetic `SandboxNetworkAccess` request. Evidence: [REPL.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/screens/REPL.tsx#L2216), [permissionSync.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/swarm/permissionSync.ts#L805)

### MCP Channels, MCP Server Approval, And Computer Use

Channel-based approval over MCP is structured and gated.

- Claude Code sends `notifications/claude/channel/permission_request`
- channel servers answer with `notifications/claude/channel/permission {request_id, behavior}`
- a per-session pending map resolves the first matching response

Evidence: [channelNotification.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelNotification.ts#L49), [channelPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelPermissions.ts#L40), [channelPermissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelPermissions.ts#L196)

A channel server only becomes an approval surface after several gates:

- feature flag
- claude.ai auth
- org policy `channelsEnabled`
- membership in the session `--channels` list
- marketplace verification
- allowlist or explicit dev bypass

Evidence: [channelNotification.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelNotification.ts#L118), [channelAllowlist.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/channelAllowlist.ts#L1), [useManageMCPConnections.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/useManageMCPConnections.ts#L555)

Project `.mcp.json` servers have a startup approval surface separate from normal tool permissioning. Evidence: [mcpServerApproval.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcpServerApproval.tsx#L1)

Computer Use is a separate session-bound grant system layered on top of MCP:

- the built-in `computer-use` server is default-disabled
- app state stores non-persistent session `allowedApps`
- extra grant flags exist for clipboard and system-key access
- the approval dialog returns per-session app grants plus those flags

Evidence: [config.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/services/mcp/config.ts#L1507), [AppStateStore.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/state/AppStateStore.ts#L254), [wrapper.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/computerUse/wrapper.tsx#L59), [ComputerUseApproval.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx#L281)

## Workspace Trust And Dangerous Bypass Guardrails

Workspace trust is a separate outer boundary from permission mode.

- Interactive flows can present a trust dialog before normal tool permissions are active.
- Untrusted directories can disable assistant mode.
- After trust, the app proceeds to other startup approval surfaces like `.mcp.json` and external include warnings.

Evidence: [interactiveHelpers.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/interactiveHelpers.tsx#L150), [main.tsx](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/main.tsx#L1597)

The CLI also constrains "skip permissions" behavior. In `setup.ts`, `--dangerously-skip-permissions` is rejected for root or sudo unless already sandboxed, and ant builds add stricter conditions like Docker or bwrap-style containment and no internet unless special entrypoints are used. Evidence: [setup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/setup.ts#L1)

The core point is that Claude Code does not treat full bypass as a universally available state. There are org, runtime, trust, and environment gates above it.

## What Is Feature-Gated Or Incomplete In This Tree

Two areas appear not to be fully reconstructable from the external tree alone:

- The transcript-classifier path is feature-gated, and at least part of the classifier story appears stubbed or not fully present in this checkout. The visible code is enough to understand where classifier review sits in the decision pipeline, but not enough to reconstruct the classifier implementation itself. Evidence: [permissions.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissions.ts#L658)
- Dangerous-rule stripping against read-only sources such as managed policy or flags is not obviously neutralized by the mutation path alone. That likely depends on surrounding runtime behavior not fully visible from a static pass. Evidence: [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L295), [permissionSetup.ts](/Users/spadgett/dev/personal/crumbs-github/external/claude-code/src/utils/permissions/permissionSetup.ts#L472)

Those are caveats on exact parity, not on the overall architecture.

## What It Would Take To Recreate This In Aggregate

### Required Subsystems

A credible implementation would need all of the following:

- A permission-mode model with internal and external representations, mode transitions, and source-aware persistence.
- A rule loader that can merge user, project, local, flag, managed-policy, CLI, command, and session sources with deterministic precedence.
- A permission update system that can apply in-memory changes, persist only editable destinations, and reject illegal mutations to read-only sources.
- A core decision engine with strict evaluation order: hooks, deny, ask, tool-specific analyzers, safety checks, mode behavior, allow, classifier, and fail-closed transforms.
- A filesystem policy engine with normalized working-directory membership, path canonicalization, symlink-aware path-set evaluation, separate read/write pipelines, sensitive-path blocking, and explicit internal-path allowlists.
- A Bash analyzer with AST parsing, wrapper stripping, per-subcommand permissioning, and conservative read-only and path validation.
- A separate PowerShell analyzer with its own parser model and its own conservative acceptance rules.
- A sandbox policy compiler that projects working directories, internal path exceptions, network-domain policy, and managed-only clamps into a runtime sandbox configuration.
- A runtime execution wrapper that can decide when to sandbox, when unsandboxed execution is even legal, and how shell-specific wrapping works.
- Remote approval transport for `can_use_tool`, explicit cancellation, and bridge injection for remote-only tools.
- Swarm or team approval transport with mailbox or shared-context variants, plus propagation of session-scoped grants and sandbox-network approvals.
- MCP-specific approval surfaces for channel relays, project server startup approval, and computer-use session grants.
- A workspace-trust gate above tool permissioning.

### Key Invariants

The visible code relies on several invariants that should not be simplified away:

- Authorization must run on a set of path representations, not a single string path.
- Sensitive-path safety must run before workspace or mode-based auto-allow logic.
- `excludedCommands` cannot be treated as sandbox security.
- Shell permissioning must operate on syntax trees and decomposed subcommands, not only raw command strings.
- PowerShell needs a different analyzer than Bash.
- Managed policy needs hard clamps, not just higher-precedence defaults.
- Session-only grants are a real part of the model, especially for `.claude` editing and team propagation.
- Network host approval is part of the permission model, not just a WebFetch convenience.

### Reasonable Build Sequence

A practical build order would be:

1. Implement the core type system: modes, rule sources, update destinations, permission-decision envelope.
2. Implement source loading, precedence, persistence, and mode transitions.
3. Implement filesystem policy and path normalization first, because both shell analyzers and sandbox projection depend on it.
4. Implement Bash analysis and its conservative path and read-only validators.
5. Implement PowerShell analysis separately.
6. Implement the sandbox policy compiler and execution wrapper.
7. Add remote and swarm approval transport.
8. Add MCP surfaces: channel approvals, server approvals, and computer-use grants.
9. Add classifier or auto-review only after the deterministic rule engine is already correct.

## Planning Inputs For A Future Implementation Chat

If the next chat is about building a cleanroom version, the planning questions should center on these decisions:

- Which external permission modes are required in v1, and whether an internal-only auto mode is necessary immediately.
- Which settings sources exist in the extension environment, and which of them are mutable versus managed-only.
- Whether the extension can support a real sandbox runtime, or only a sandbox policy compiler plus host-provided execution boundary.
- Whether Bash and PowerShell both need first-class support in v1.
- Which non-local approval surfaces matter: remote control, multi-agent workers, MCP channels, MCP server approval, computer-use grants.
- How session-scoped grants should be persisted or discarded.
- Which sensitive paths should be hard-coded, and whether `.claude`-equivalent config paths need the same narrow session-only carveouts.
- How to represent network-host approvals so they can feed both permission prompts and sandbox configuration.

The implementation target visible in this tree is a policy compiler plus enforcement stack. Recreating the aggregate behavior means reproducing the ordering and separation between layers, not just the dialogs or the allow rules.
