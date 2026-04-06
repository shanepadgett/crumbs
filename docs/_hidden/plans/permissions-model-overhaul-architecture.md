# Crumbs Permissions and Sandbox Plan

Related idea: `docs/ideas/14-permissions-model-overhaul.md`

Grounding research:

- `docs/research/claude-code-permissions-implementation.md`
- `docs/research/codex-permissions-implementation.md`
- `docs/research/permissions-model-overhaul-codex-claude-code.md`

## What we are building

Crumbs will stop making developers think in terms of one giant permission mode switch.

The system will feel like this instead:

- pick a preset for your normal working posture
- stay sandboxed by default
- when the agent needs one more thing, approve the exact thing it needs
- keep that approval for once, session, project, or user scope
- see the current state in the footer and inspect or revoke it later

The developer experience win is simple:

- no constant flipping between `read-only`, `workspace`, and `full-access`
- no vague “trust me” prompts
- no hidden sandbox widening
- no repeated prompts for the same domain or external path once approved

## The main product decisions

- Presets stay, but only as UX shortcuts.
- The real engine is capabilities plus grants.
- Trust is separate from presets.
- Filesystem, network, protected paths, shell risk, and tool classes each have their own approval flow.
- Extra permissions keep the sandbox on.
- Unsandboxed execution is a separate action with a separate prompt.
- Durable approvals are stored as structured path, domain, and tool grants.
- Shell approvals are **not** stored as arbitrary shell strings.
- If the sandbox backend cannot express the exact policy, Crumbs says so and asks for unsandboxed execution instead of silently broadening access.

## What developers will actually use

### 1. Trust a repo once

The first time a developer opens an unknown repo, Crumbs treats it as untrusted.

What they see:

- footer: `perm: read-only · trust: untrusted · net: allowlist · sbx: on`
- project-shared permission relaxations are ignored
- mutating actions prompt more aggressively

What they do:

- run `/permission trust`, or
- approve trust from the first mutation prompt

What happens after trust:

- repo-level shared preset config is enabled
- repo-local durable grants are enabled
- all worktrees for the same repo inherit the same trust state

Trust is keyed by repo identity root, not worktree path.

### 2. Pick a preset for the session

Crumbs ships four built-in presets.

#### `read-only`

For inspection, debugging, and planning.

- read inside repo
- no repo writes
- allowlist network only
- sandbox on
- prompts for any write, external path, or new network host

#### `research`

For docs-heavy sessions.

- same as `read-only`
- plus writes to `docs/research/**`, `docs/plans/**`, and `docs/notes/**`
- allowlist network only
- sandbox on

This becomes the “go gather information and write documents” preset.

#### `workspace`

For normal coding.

- read/write inside repo
- protected carveouts still guarded
- allowlist network only
- sandbox on
- prompts for external paths, protected files, destructive commands, and new domains

This becomes the daily-driver preset.

#### `full-access`

For deliberate bypass.

- sandbox off
- network open
- no routine prompts

Entering `full-access` requires an explicit confirmation dialog. That is the one deliberate “I know what I am doing” switch.

### 3. Approve exactly the missing capability

The best part of the system is that developers stop changing the whole session just to unlock one operation.

Examples:

- approve write access to `@repo/docs/plans` for this session
- approve read access to `~/Library/Application Support/...` once
- approve `developer.mozilla.org` for the project
- approve one unsandboxed shell command once

Crumbs will show the delta, not just the raw tool payload.

### 4. Reuse approvals without losing control

Approvals come in four scopes:

- `once`
- `session`
- `project`
- `user`

Developers will mostly use them like this:

- `once` for risky or unusual actions
- `session` for active debugging work
- `project` for repo-specific domains and external helper paths
- `user` for personal machine-level locations they trust across repos

### 5. Inspect and revoke later

Crumbs will expose:

- `/permission`
- `/permission preset`
- `/permission trust`
- `/permission grants`
- `/permission revoke`

`/permission grants` shows active grants grouped by category:

- external paths
- network domains
- tool approvals
- session-only shell approvals

## The concrete approval flows

### Flow 1: first mutation in an untrusted repo

The developer opens a new checkout and asks the agent to edit `src/index.ts`.

Crumbs response:

1. detects repo is untrusted
2. ignores repo-shared relaxations from `.pi/crumbs.json`
3. blocks the write under the untrusted `read-only` preset
4. shows a prompt with two separate choices:
   - trust this repo
   - allow this write once without trusting

Prompt shape:

```text
Title: Trust workspace?

Repo: /Users/me/code/new-project
Requested action: write @repo/src/index.ts
Current preset: read-only

Trusting enables repo-shared permission config and project-local grants.

Actions:
- Trust repo and continue
- Allow once without trusting
- Cancel
```

Why this is better:

- trust is explicit and visible
- developers do not have to infer that changing presets also changed trust
- one-off edits in untrusted repos still work without forcing a permanent trust decision

### Flow 2: research session that can write docs but not code

The developer switches to `research` and asks the agent to write a plan.

Allowed without prompt:

- `write docs/plans/permissions-model-overhaul.md`
- `apply_patch` touching only `docs/research/**` and `docs/plans/**`

Prompted:

- `write src/permissions/index.ts`
- `apply_patch` touching `package.json`

What the developer sees:

- footer stays `perm: research · trust: trusted · net: allowlist · sbx: on`
- the prompt says `Needs write access outside research paths`

Why this is better:

- `research` becomes a real working mode, not just read-only with a different label
- developers can safely let the agent do long research and writing sessions without worrying about accidental code edits

### Flow 3: read a file outside the repo

The agent tries to read `~/.config/mise/config.toml`.

Crumbs does not turn this into a vague “needs more permissions” prompt. It shows an external path prompt.

Prompt shape:

```text
Title: Allow external read?

Tool: read
Path: /Users/me/.config/mise/config.toml
Access: read
Location: home config
Current preset: workspace

Actions:
- Once
- Session
- Project
- User
- Deny
```

On approval:

- Crumbs stores a structured read grant for the canonical path
- the operation reruns immediately
- future reads of the same path or a covered directory use the stored grant

Why this is better:

- external paths become a first-class concept
- developers get stable approvals for real workflows like reading SDK config, local notes, sibling repos, and generated files

### Flow 4: shell command needs one write path, not full workspace write

The developer is in `read-only` and the agent wants to run:

```sh
npm test -- --updateSnapshots
```

Crumbs shell analysis extracts that the command needs write access under the repo.

Prompt shape:

```text
Title: Allow additional write access?

Command: npm test -- --updateSnapshots
Current preset: read-only
Needed capability: write inside @repo
Execution mode: sandboxed

Actions:
- Once
- Session
- Switch preset to workspace
- Cancel
```

If the developer chooses `Session`:

- the command reruns sandboxed
- the sandbox gets the exact approved write delta
- the session does not become `workspace`

Why this is better:

- developers stop widening the whole session just to run one command
- the sandbox stays on
- the approval is understandable and reusable

### Flow 5: network approval for a new host

The agent tries:

```ts
webfetch("https://docs.rs/serde")
```

`docs.rs` is not in the current allowlist.

Prompt shape:

```text
Title: Allow network access?

Tool: webfetch
Host: docs.rs
Scheme: https
Port: 443
Current preset: research

Actions:
- Once
- Session
- Project
- User
- Deny
```

On approval:

- Crumbs records a network grant keyed by host, scheme, and port
- the current sandbox allowlist refreshes immediately
- later `webfetch`, `websearch`, or sandboxed shell traffic to the same host works without another prompt

Why this is better:

- domain approvals become reusable project state
- the same approval applies across tools instead of being trapped in one tool implementation

### Flow 6: patch touches a protected file

The agent submits a patch touching `.pi/crumbs.json` or `AGENTS.md`.

Crumbs shows a protected path prompt, not a generic write prompt.

Prompt shape:

```text
Title: Protected file change

Patch touches:
- @repo/.pi/crumbs.json

Protected files require explicit approval.

Actions:
- Once
- Session
- Deny
```

Protected file approvals do not offer `Project` or `User` scope in v1.

Why this is better:

- repo metadata and agent-instruction files remain guarded even in `workspace`
- the UX makes it obvious that this is a stronger class of action

### Flow 7: command needs unsandboxed execution

The agent wants to run a command that the sandbox backend cannot represent exactly, or that explicitly needs unsandboxed access.

Crumbs shows that honestly.

Prompt shape:

```text
Title: Run without sandbox?

Command: docker build .
Current preset: workspace
Reason: current sandbox backend cannot grant the required device/socket access exactly

Actions:
- Run once unsandboxed
- Switch to full-access
- Cancel
```

Why this is better:

- no fake “restricted” mode that secretly broadened access
- developers know exactly when the sandbox stopped being real

## The permanent rules that always apply

These do not change with normal presets.

### Protected filesystem targets

These always prompt on write in restricted presets:

- `@repo/.git`
- `@repo/.pi`
- `@repo/AGENTS.md`
- `@repo/CLAUDE.md`
- `@repo/.env`
- `@repo/.env.*`
- `@home/.ssh`
- `@home/.aws`
- `@home/.gnupg`

### External paths

- reads outside `@repo` prompt
- writes outside `@repo` prompt
- read and write grants are stored separately

### Destructive commands

These always prompt in restricted presets:

- `rm -rf`
- `find ... -delete`
- `git reset --hard`
- `git clean -fd`
- `git push --force`
- `git update-ref`
- `git filter-branch`
- `git filter-repo`
- infra and remote admin commands like `ssh`, `scp`, `terraform`, `kubectl`, `psql`

Destructive command approvals are only `once` or `session` in v1.

### No durable arbitrary shell rules

Crumbs will not save rules like `Bash(foo:*)` or raw command strings.

What persists durably in v1:

- path grants
- domain grants
- tool approvals

What does not:

- free-form shell snippets
- interpreter `-c` forms
- compound shell text

This keeps the system explainable.

## The internal model

The engine will run on four things.

```ts
type GrantScope = "once" | "session" | "project" | "user";

type SandboxRequestMode = "default" | "additional-capabilities" | "unsandboxed";

interface CapabilityDelta {
  readPaths: string[];
  writePaths: string[];
  domains: Array<{ host: string; scheme?: string; port?: number }>;
  unsandboxed: boolean;
}

interface PermissionOperation {
  class: "filesystem-read" | "filesystem-write" | "patch" | "shell" | "network" | "tool";
  toolName: string;
  cwd: string;
  paths: string[];
  urls: string[];
  command?: string;
  sandboxRequest: SandboxRequestMode;
  requestedDelta: CapabilityDelta;
  metadata: Record<string, unknown>;
}

interface GrantRecord {
  id: string;
  scope: GrantScope;
  category: "path-read" | "path-write" | "domain" | "tool" | "shell-session";
  value: Record<string, unknown>;
  createdAt: string;
}

interface PermissionDecision {
  outcome: "allow" | "ask" | "deny";
  reason:
    | "baseline"
    | "grant"
    | "protected-path"
    | "external-path"
    | "destructive-command"
    | "new-domain"
    | "unsandboxed-required"
    | "headless-no-approval";
  prompt?: ApprovalPrompt;
}
```

The runtime state for the active session becomes:

```ts
interface EffectivePermissionState {
  trust: "trusted" | "untrusted";
  preset: "read-only" | "research" | "workspace" | "full-access";
  sandboxState: "on" | "off" | "degraded" | "unsupported";
  baseline: CapabilityProfile;
  mergedGrants: GrantRecord[];
}
```

## How decisions are made

Every tool call goes through one pipeline.

1. normalize the tool input into `PermissionOperation`
2. resolve repo scope and trust state
3. canonicalize lexical and real paths
4. build the baseline capability profile from the active preset
5. merge user, project, session, and once grants
6. apply protected path and destructive command checks
7. compute the exact missing capability delta
8. if there is no missing delta, allow
9. if there is a missing delta and prompts are available, show a category-specific prompt
10. if approved, store the grant in the selected scope and rerun
11. compile the exact sandbox spec and execute

The key point is that prompts happen for missing capability deltas, not because a tool happened to be `bash`.

## Filesystem model

Crumbs will use one split filesystem model only.

### Built-in path selectors

- `@cwd`
- `@repo`
- `@git`
- `@tmp`
- `@home`
- `@config`

These are used in config, grant storage, and UI summaries.

### Canonicalization rules

- store grants against canonical absolute paths
- also keep lexical path checks for symlink-sensitive protection
- protect `.git` pointer paths and resolved git directories
- treat `@repo/.pi` and `@repo/.git` as protected even if they do not yet exist

### Patch handling

`apply_patch` gets its own parser and its own approval keys.

Approval key examples:

```text
patch:/absolute/path/to/docs/plan.md
patch:/absolute/path/to/.pi/crumbs.json
```

That lets a later patch reuse an approval for the same file set without hashing the whole patch body.

## Shell model

Crumbs will handle shell in two classes.

### Simple command

Simple commands have no shell control operators, redirections, command substitution, or newlines.

Examples:

- `git status`
- `npm test -- --updateSnapshots`
- `cargo test`

For simple commands, Crumbs will:

- tokenize safely
- strip leading wrappers like `env`, `command`, and `builtin`
- extract path and network hints when possible
- apply destructive-command interlocks
- compute a capability delta

### Compound shell

Everything else is compound shell.

Examples:

- `cd src && npm test`
- `cat foo | jq .`
- `python -c "..."`

For compound shell, Crumbs will:

- run only under baseline sandbox or a prompt-approved widened sandbox
- never create durable shell rules
- never pretend command parsing is exact when it is not

That keeps shell policy honest and much simpler than storing a growing grammar of shell strings.

## Network model

Network is its own approval surface.

### Grant identity

Network grants are keyed by:

- hostname
- scheme when known
- port when known

Example:

```text
https://docs.rs:443
```

### Tool behavior

- web tools preflight the URL before execution
- MCP tools declare host hints or network class in a descriptor
- shell commands use extracted URL and host hints when available

If shell traffic has no analyzable host and the sandbox is in allowlist mode, it remains blocked until the developer either grants a known host through another flow or chooses unsandboxed execution.

That is an intentional limitation. It keeps the UX understandable.

## Tool descriptors

All nontrivial tools will register a permission descriptor.

```ts
interface ToolPermissionDescriptor {
  class: "read" | "write" | "network" | "shell" | "mcp" | "repo-admin";
  readOnly?: boolean;
  destructive?: boolean;
  hostHints?: string[];
  pathHints?: string[];
}
```

This is how Crumbs will make web, MCP, worktree, Git, and future extension tools all participate in the same decision engine.

## Sandbox architecture

Crumbs will compile every approved operation into one internal launch spec.

```ts
interface SandboxLaunchSpec {
  filesystem: CapabilityProfile["filesystem"];
  network: CapabilityProfile["network"];
  env: Record<string, string>;
  cwd: string;
}
```

Backends:

- macOS seatbelt
- Linux sandbox runtime or bwrap-style wrapper
- no-sandbox backend for explicit bypass only

### Exactness rule

If the backend cannot represent the approved delta exactly, Crumbs does not broaden it.

It shows the unsandboxed prompt from Flow 7.

That is the trust-building part of the product. The UI and the enforcement actually match.

## Config and persistence

Use separate stores for separate concerns.

### User-global config

Path:

- `~/.config/pi/crumbs.json`

Contains:

- custom presets
- default preset
- user-level durable grants
- trusted repo registry

### Project-shared config

Path:

- `<repo>/.pi/crumbs.json`

Contains:

- repo presets
- protected path additions
- project-level domain defaults

This file is configuration, not grant history.

### Project-local grant store

Path:

- `<repo>/.pi/crumbs.local.json`

Contains:

- durable external path grants
- durable domain grants
- durable tool approvals

This file is loaded only for trusted repos.

### Session state

Persist into Pi session entries:

- selected preset
- session grants
- explicit session denials

Entry types:

- `permissions/preset`
- `permissions/grant`
- `permissions/deny`

## The config developers will write

The config becomes capability-shaped.

Example:

```json
{
  "permissions": {
    "preset": "workspace",
    "presets": {
      "research": {
        "inherits": "read-only",
        "label": "research",
        "filesystem": {
          "write": ["@repo/docs/research", "@repo/docs/plans", "@repo/docs/notes"]
        },
        "network": {
          "allowedDomains": ["github.com", "*.github.com", "docs.rs", "mcp.exa.ai"]
        }
      }
    },
    "protectedPaths": ["@repo/AGENTS.md", "@repo/.env", "@repo/.env.*"]
  }
}
```

This is concrete and understandable:

- presets define baseline capabilities
- approvals live elsewhere
- protected paths are obvious

## The UI surface

### Footer

Footer status becomes:

```text
perm: workspace · trust: trusted · net: allowlist · sbx: on
```

### Prompt design

Every prompt shows:

- operation summary
- current preset
- exact missing capability
- scope choices allowed for that category

### Commands

- `/permission` opens the main permission panel
- `/permission preset` switches preset
- `/permission trust` toggles repo trust
- `/permission grants` lists active grants
- `/permission revoke` removes a selected grant

The main panel shows three sections:

- current state
- active grants
- preset picker

## How this improves the current extension

Today the extension mostly has:

- a flat preset with a few booleans
- blocked and protected path lists
- destructive shell interlocks
- network allowlist checks in a separate helper

After the rewrite, developers get:

- one engine for direct tools, shell, web, MCP, and patches
- reusable approvals for external paths and domains
- real `research` behavior instead of a thin config trick
- trust as a first-class concept
- prompts that talk about capabilities instead of mode names
- exact sandbox widening instead of session-wide mode flips

## Build sequence

1. replace the current mode config loader with preset plus capability config
2. add repo trust store and project-local grant store
3. build the shared operation normalizer and decision engine
4. move `read`, `write`, `edit`, and `apply_patch` onto the new engine
5. move web tools onto shared network authorization
6. add shell classification and capability-delta prompts
7. add the grant manager UI and revoke flows
8. add tool descriptors for MCP and extension tools
9. remove the old flat direct-mutation and network-mode logic

## Final call

Crumbs should feel like a developer tool with a real permissions model, not a bag of special cases.

The winning experience is:

- normal work in `workspace`
- long doc sessions in `research`
- exact prompts when the agent needs one more capability
- sticky approvals where they make sense
- a clearly marked escape hatch for `full-access`

That is concrete, teachable, and much easier to trust.
