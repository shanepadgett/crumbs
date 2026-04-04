# Unified Permissions Architecture Proposal

## Goal

Create a single, coherent **permissions system** for this repo that unifies the current strengths of:

- `extensions/permission-gate/`
- `extensions/file-guard.ts`
- the pi example `examples/extensions/sandbox/`

The intent is **not** to pretend these are the same mechanism. They are not.
The intent is to provide **one extension, one config surface, one UI model, and one status model** that coordinates multiple enforcement layers in a predictable way.

---

## Executive Summary

I recommend replacing the current multi-extension mental model with a single top-level extension concept:

- **Name:** `permissions` or `system-permissions`
- **Primary job:** unify command approval, path/resource protection, and shell sandboxing
- **User-facing behavior:** one system
- **Internal implementation:** multiple enforcement engines

### Core idea

Treat permissions as a **control plane** with three distinct protection layers:

| Layer | Purpose | Example |
|---|---|---|
| Intent / approval | Decide whether a tool call should be allowed | Prompt before risky `bash` |
| Resource / path policy | Decide whether a tool may touch a path | Block `.env`, gate `.pi/crumbs.json` |
| Runtime containment | Restrict what an already-approved process can do | Limit bash filesystem + network access |

These layers should be coordinated by one extension runtime so they do not fight each other on ordering, config parsing, or UI.

---

## Why unify them

## Problems with the current split

Today the repo effectively has:

- one extension that reasons about `bash`
- one extension that reasons about path access for a subset of tools
- a possible future sandbox extension that reasons about spawned shell processes

That leads to avoidable complexity:

- handler ordering matters
- the same config may be loaded multiple times
- UI patterns diverge
- one layer may inspect mutated input from another layer
- users must understand multiple safety concepts even though they feel related

## Benefits of one unified extension

A single permissions extension gives:

- **deterministic evaluation order**
- **one approval prompt style**
- **one footer/status story**
- **one policy file / schema model**
- **shared grouping primitives** for paths and domains
- **defense in depth** without duplicate user-facing concepts

---

## Design Principles

1. **One control plane, multiple enforcement layers**
   - Do not collapse everything into one fake abstraction.
   - Keep the internal layers distinct and explicit.

2. **Hard fences stay hard**
   - Sensitive paths like `.env`, `~/.ssh`, and policy files should not casually disappear just because a profile becomes more permissive.

3. **Profiles should be overlays, not separate worlds**
   - Base policy comes from config.
   - Profiles adjust the base policy.

4. **Approval and containment are complementary**
   - Approval decides intent.
   - Sandbox limits damage after approval.

5. **Preserve the best existing UX**
   - Keep the current option-picker approval flow style.
   - Keep notes/review logging where useful.
   - Keep the ability to persist “always allow” rules.

6. **Prefer built-in tool behavior over overrides when possible**
   - Avoid overriding `bash` if the same result can be achieved by wrapping command execution late in the pipeline.

---

## Proposed High-Level Architecture

## User-facing product model

Users should think in terms of **Permissions**.

That system should provide:

- a current **profile**
- a clear **footer/status indicator**
- a `/permissions` command
- a unified config section in `.pi/crumbs.json`
- unified approval prompts
- consistent block reasons

## Internal engine model

Internally, the extension should have these submodules:

1. **Policy Loader / Normalizer**
2. **Command Approval Engine**
3. **Resource Policy Engine**
4. **Sandbox Adapter**
5. **Decision Aggregator**
6. **UI + Status Renderer**
7. **Persistence + Audit**
8. **Profile Overlay Manager**

---

## Recommended package / file layout

If this becomes a real replacement, I would introduce a new package:

```text
extensions/
  permissions/
    package.json
    index.ts
    types.ts
    config.ts
    profiles.ts
    normalize.ts
    decision.ts
    command-policy.ts
    resource-policy.ts
    sandbox.ts
    ui.ts
    status.ts
    persistence.ts
    audit.ts
    path-groups.ts
    domain-groups.ts
```

### What happens to the current extensions

- `extensions/permission-gate/`
  - either becomes deprecated
  - or becomes a thin compatibility wrapper that forwards to the new system

- `extensions/file-guard.ts`
  - either becomes deprecated
  - or becomes a thin wrapper exposing only the path engine

The cleaner long-term direction is a real `permissions` package and then eventually retire the separate extensions.

---

## Responsibilities of each internal module

## 1. `config.ts`

Loads and validates configuration from:

- project: `.pi/crumbs.json`
- user: `~/.pi/agent/crumbs.json`

Responsibilities:

- parse config
- support migration from current keys
- resolve defaults
- merge user + project scopes
- expose a normalized config object to all other modules

## 2. `profiles.ts`

Defines built-in profile overlays:

- `restricted`
- `policy`
- `open`
- optional `unsafe`

Responsibilities:

- apply overlay rules on top of normalized base policy
- determine effective sandbox mode
- determine prompt strictness / default decisions
- expose display label, icon, and color semantics

## 3. `command-policy.ts`

This is the evolved `permission-gate` engine.

Responsibilities:

- inspect `bash` tool calls
- inspect `user_bash` commands
- normalize shell input
- analyze compound commands
- apply allow / deny / ask logic
- preserve built-in safe-command evaluators
- preserve exact/prefix/regex rules
- persist “always allow” rules where appropriate

## 4. `resource-policy.ts`

This is the evolved `file-guard` engine.

Responsibilities:

- protect direct file/resource tools
- apply hard-block and approval-gate semantics
- support grouped paths and aliases
- cover more built-ins than current file guard

Recommended direct coverage:

- `read`
- `write`
- `edit`
- `ls`
- `find`
- `grep`
- `bash` path heuristics as a soft layer

### Important note

For `bash`, path heuristics should remain a **secondary layer**, not the main protection.
Runtime sandboxing is the stronger backstop for shell execution.

## 5. `sandbox.ts`

This is the runtime containment adapter.

Responsibilities:

- initialize sandbox runtime when enabled
- manage merged network/filesystem restrictions
- wrap `bash` command execution late in the pipeline
- wrap `user_bash` execution
- expose status and supportability info
- reset sandbox state on shutdown / reload

### Important design choice

Do **not** override built-in `bash` unless there is no better alternative.
Preferred model:

- let approval/resource checks inspect the original command
- after approval succeeds, mutate the command into a sandbox-wrapped command
- keep built-in `bash` execution and rendering behavior

This avoids the main downside of tool override composition.

## 6. `decision.ts`

This module is critical.

Rather than each subsystem independently prompting the user, it should:

- collect command-policy findings
- collect resource-policy findings
- determine whether the result is:
  - allow
  - deny
  - ask
- merge multiple reasons into one prompt
- ensure only one prompt is shown per tool call

This is where the unified UX becomes real.

## 7. `ui.ts`

Unified permission prompt and explanation system.

Responsibilities:

- shared picker UI
- explain *why* something is blocked or gated
- show all triggered concerns together
- collect notes / review markings
- support different action sets depending on context

Suggested actions for command prompts:

- Allow once
- Always allow (project)
- Always allow (user)
- Deny

Suggested actions for path-only prompts:

- Allow once
- Deny

## 8. `status.ts`

Footer and command output.

Responsibilities:

- show current profile
- show whether sandbox is active
- show whether runtime is degraded or unsupported
- support `/permissions` display
- optionally show writable roots and network scope summary

## 9. `persistence.ts`

Preserve the useful parts of the current command approval system.

Responsibilities:

- persist exact allow rules
- write policy updates safely
- support review/audit records
- maintain schema references

## 10. `audit.ts`

Optional but useful.

Responsibilities:

- append human-review records
- record denied requests and manual approvals
- support future `/permissions history` or debug views

---

## Recommended runtime flow

## Session startup

On `session_start`:

1. load and normalize config
2. determine active profile
3. compute effective policy
4. initialize sandbox if enabled and supported
5. publish footer/status state
6. optionally inject a concise system reminder

## Before agent start

On `before_agent_start`:

- optionally append a short, compact reminder of active permissions
- do **not** dump excessive config into the prompt
- only include the subset the model benefits from knowing

Example reminder:

- current profile
- hard-fenced path groups
- whether direct mutations are gated
- whether sandbox is active

## Tool call evaluation

On `tool_call`:

### For direct file/resource tools

1. classify tool (`read`, `write`, `edit`, `ls`, `find`, `grep`)
2. extract path target(s)
3. apply hard-block rules
4. apply gate rules
5. aggregate reasons
6. prompt if needed
7. allow or block

### For `bash`

1. inspect original command
2. run command-policy evaluation
3. run bash path heuristics through resource-policy evaluation
4. aggregate all findings into one decision
5. prompt if needed
6. if allowed and sandbox active, wrap command with sandbox
7. let built-in `bash` run

## User shell evaluation

On `user_bash`:

Apply the same overall flow as `bash` tool execution:

1. inspect original command
2. apply command-policy
3. optionally apply path heuristics
4. if sandbox active, return sandboxed bash operations
5. preserve status and block reasons

This is important because `!` commands are otherwise outside the model-facing tool flow.

## Tool result handling

On `tool_result`:

- prepend approval notes when relevant
- attach audit metadata if useful
- do not overcomplicate normal output

## Session shutdown

On `session_shutdown`:

- clear status
- reset sandbox manager if initialized
- flush any in-memory audit state

---

## Profiles / Modes

I recommend the following built-in profiles.

## 1. `restricted`

Most conservative.

Characteristics:

- sandbox on
- network heavily restricted or off
- write scope narrow
- mutation defaults become stricter
- more `ask` / `deny`
- hard fences always on

Good for:

- unfamiliar repos
- exploration mode
- auditing/security-sensitive work

## 2. `policy`

Normal managed mode.

Characteristics:

- honors `.pi/crumbs.json` and user policy as-authored
- sandbox behavior follows config
- path gating follows config
- approval behavior follows config

Good for:

- standard daily use
- project-defined defaults

This should probably be the default profile.

## 3. `open`

More permissive, but still not fully unsafe.

Characteristics:

- reduces prompts
- may relax sandbox, depending on config
- may default more operations to allow
- should still preserve hard fences unless explicitly bypassed

Good for:

- trusted repos
- fast local iteration

## 4. Optional `unsafe`

Only include if there is a real use case.

Characteristics:

- approvals minimized or disabled
- sandbox off
- hard fences may be bypassable
- loud visual indicator
- explicit confirmation required
- ideally session-scoped, not sticky by default

I would **not** make `open` equivalent to `unsafe`.

---

## Profile model: overlays, not forks

Profiles should overlay the base project/user policy rather than replace it.

### Recommended precedence

1. built-in defaults
2. user config
3. project config
4. active profile overlay
5. optional temporary session override

This lets a project define a stable baseline while still allowing the user to switch modes temporarily.

---

## Config model recommendation

## Recommendation: unify under a top-level `permissions` section

The current repo has a split mental model:

- top-level command policy keys
- nested `fileGuard` section
- potential future separate sandbox config

I recommend moving toward:

```json
{
  "$schema": "../schemas/crumbs.schema.json",
  "permissions": {
    "profile": "policy",
    "defaults": {
      "onNoUi": "deny"
    },
    "groups": {
      "paths": {
        "hardBlocked": ["docs/_hidden/", ".env", "~/.ssh/", "~/.aws/"],
        "policyFiles": [".pi/crumbs.json"],
        "workspaceWritable": [".", "/tmp"]
      },
      "domains": {
        "safe": ["github.com", "*.github.com", "api.github.com"],
        "packageRegistries": ["npmjs.org", "*.npmjs.org", "registry.npmjs.org"]
      }
    },
    "commandPolicy": {
      "defaultPolicy": "ask",
      "allow": [
        { "match": "regex", "value": "^mise\\s+run\\s+(?:format|lint|typecheck|check)$" }
      ],
      "deny": []
    },
    "resourcePolicy": {
      "hardBlock": ["@hardBlocked"],
      "gate": {
        "mutate": [
          {
            "match": "@policyFiles",
            "reason": "Editing crumbs policy requires approval.",
            "onNoUi": "deny"
          }
        ],
        "read": [],
        "ls": [],
        "find": [],
        "grep": [],
        "bash": []
      }
    },
    "sandbox": {
      "enabled": true,
      "userBash": true,
      "filesystem": {
        "denyRead": ["@hardBlocked"],
        "allowWrite": ["@workspaceWritable"],
        "denyWrite": ["@hardBlocked", "@policyFiles"]
      },
      "network": {
        "allowedDomains": ["@safe", "@packageRegistries"],
        "deniedDomains": []
      }
    },
    "profiles": {
      "restricted": {
        "commandPolicy": { "defaultPolicy": "ask" },
        "sandbox": { "enabled": true },
        "resourcePolicy": {
          "gate": {
            "mutate": ["@workspaceWritable"]
          }
        }
      },
      "policy": {},
      "open": {
        "commandPolicy": { "defaultPolicy": "allow" }
      }
    },
    "ui": {
      "injectPromptReminder": true,
      "showFooterStatus": true
    }
  }
}
```

## Backward compatibility strategy

The extension should normalize old shapes into the new model.

For example:

- top-level `defaultPolicy`, `allow`, `deny` -> `permissions.commandPolicy`
- `fileGuard` -> `permissions.resourcePolicy`
- a future sandbox section -> `permissions.sandbox`

This allows migration without a flag day.

---

## Shared grouping model

One of the strongest reasons to unify the system is that groups become reusable.

## Path groups

Use named path groups for:

- hard-block fences
- gate rules
- sandbox `denyRead`
- sandbox `denyWrite`
- sandbox `allowWrite`

## Domain groups

Use named domain groups for:

- sandbox allow lists
- sandbox deny lists
- optional future web policy controls

This avoids duplicating the same sensitive path/domain lists in multiple places.

---

## Tool coverage recommendation

## Direct built-in tools

The unified permissions engine should explicitly reason about:

- `read`
- `write`
- `edit`
- `ls`
- `find`
- `grep`
- `bash`

### Why add `ls`, `find`, and `grep`

If the point of file/resource protection is “don’t let the agent casually enumerate or inspect sensitive areas,” then these tools matter too.

Current `file-guard` only directly enforces on:

- `read`
- `write`
- `edit`
- heuristic `bash`

That is too narrow for a broader permissions system.

## Bash / shell

For bash specifically, use all three layers:

1. command approval
2. path heuristics
3. runtime sandbox containment

That combination is much stronger than any one layer alone.

---

## Unified decision model

The system should evaluate a tool call into a single structured decision object, something conceptually like:

```ts
interface PermissionDecision {
  outcome: "allow" | "deny" | "ask";
  reasons: Array<{
    source: "command-policy" | "resource-policy" | "sandbox";
    severity: "info" | "warning" | "error";
    message: string;
  }>;
  canPersistAllowRule: boolean;
  canAllowOnce: boolean;
  requiresSandbox: boolean;
}
```

This is important because one tool call may trigger multiple concerns.

Example:

- bash command is compound and unapproved
- command references a gated policy file
- sandbox is active and will constrain writes

That should become **one prompt**, not three.

---

## UI / UX proposal

## Footer

Show a compact permission state:

- `🔒 restricted · sbx:on`
- `🛡 policy · sbx:on`
- `⚠ open · sbx:off`
- `☠ unsafe · sbx:off`

If sandbox is configured but unsupported, show something like:

- `🛡 policy · sbx:unsupported`

## Slash commands

Suggested commands:

- `/permissions`
  - show current effective state
- `/permissions profile`
  - choose restricted / policy / open / unsafe
- `/permissions sandbox`
  - show sandbox config summary
- `/permissions rules`
  - summarize effective command + resource rules
- `/permissions audit`
  - show recent approval / denial records

A shorter alias like `/perm` is also reasonable.

## Approval prompts

Preserve the repo’s current strengths:

- compact option picker
- reason display
- allow-once support
- persist-always support when appropriate
- note/review capture when useful

### Unified prompt structure

Prompt should show:

- tool
- command or target
- triggered reasons
- whether sandbox will still constrain execution

Example:

- Tool: bash
- Command: `rm foo && git status`
- Reasons:
  - Compound command includes unapproved segment
  - Target touches `.pi/crumbs.json`
- Runtime containment:
  - sandbox active, write scope limited to workspace

That gives the user a full picture.

---

## Persistence model

Keep the current approval persistence model for command rules, because it is good.

## Persistable decisions

Allow persistence for decisions like:

- exact command allow rule (project)
- exact command allow rule (user)

## Non-persistable decisions

Do **not** casually auto-persist path exceptions unless there is a deliberate design for them.
Current `file-guard` gate behavior is simpler and safer here.

If path exceptions are ever persisted, they should be much more explicit and harder to create accidentally.

---

## Audit / review model

I would keep review logging as a first-class feature.

Useful things to record:

- manual allows
- manual denies
- persisted allow rules
- optional review notes
- active profile at time of approval
- whether sandbox was active

This can remain best-effort and should never block command flow.

---

## Implementation strategy

## Phase 1: Create the unified package

Build `extensions/permissions/` with:

- config loader
- profile manager
- command-policy engine reused from `permission-gate`
- resource-policy engine reused from `file-guard`
- no sandbox yet

Goal: unify UX and evaluation order first.

## Phase 2: Expand direct tool coverage

Add direct enforcement for:

- `ls`
- `find`
- `grep`

Goal: make resource protection feel complete.

## Phase 3: Integrate sandbox

Add sandbox runtime adapter with:

- `session_start` initialization
- `session_shutdown` reset
- late command wrapping for `bash`
- `user_bash` sandbox coverage
- footer status

Goal: add real runtime containment without overriding built-in `bash`.

## Phase 4: Add profiles and mode switching

Add:

- `restricted`
- `policy`
- `open`
- optional `unsafe`
- footer indicators
- `/permissions profile`

Goal: provide a strong user-facing model.

## Phase 5: Deprecate old entrypoints

Either:

- deprecate `permission-gate` and `file-guard`
- or keep them as wrappers around the shared internal engine

Goal: reduce long-term maintenance duplication.

---

## Migration recommendation for this repo

## What to preserve from `permission-gate`

Keep:

- shell normalization
- compound command analysis
- built-in safe command evaluators
- allow/deny/ask policy semantics
- approval UI shape
- allow-rule persistence
- review note logging

## What to preserve from `file-guard`

Keep:

- group references like `@hardBlocked`
- hard-block vs gate distinction
- prompt reminder concept
- `onNoUi` behavior
- path canonicalization and directory matching logic

## What to add from sandbox

Add:

- runtime filesystem constraints for `bash`
- runtime network constraints for `bash`
- `user_bash` coverage
- footer status for sandbox state
- config merging for sandbox settings

---

## Important limitations

A unified permissions extension will still **not** solve every security problem.

## 1. It does not defend against malicious extension code

pi extensions run with full system access.
A malicious extension can still:

- use `node:fs`
- spawn arbitrary processes
- call `pi.exec`
- ignore the permissions framework entirely

So this system protects **tool-driven agent behavior**, not hostile runtime code.

## 2. Sandbox mainly protects shell execution

Even with sandbox, direct built-in tools like `read`, `write`, and `edit` are still governed mainly by tool-level policy checks unless you explicitly route those through a sandboxed execution model too.

## 3. Bash heuristics should not be trusted as the sole protection

Path extraction from shell commands is helpful, but inherently incomplete.
The runtime sandbox is the authoritative backstop.

## 4. Platform support matters

Sandbox support should degrade clearly when unavailable.
The UI should never imply that containment is active when it is not.

---

## Recommended naming

I recommend the package and command surface use **permissions** rather than **sandbox** or **file guard**.

Good names:

- `permissions`
- `system-permissions`
- `permissions-mode`

Recommended profiles:

- `restricted`
- `policy`
- `open`
- optional `unsafe`

I would avoid “YOLO.”

---

## Bottom-line recommendation

Build a single **Permissions** extension with:

- **one config model**
- **one profile model**
- **one approval UI**
- **one footer/status system**
- **one evaluation pipeline**

Internally, keep three distinct enforcement layers:

1. **command approval**
2. **resource/path protection**
3. **runtime shell sandboxing**

That gives you a clean mental model for users, preserves the best parts of the current repo, and adds real defense in depth without requiring a brittle override-first design.

---

## Suggested immediate next step

If implementing this, I would start by creating `extensions/permissions/` as a new package and make its first milestone:

- normalize current `permission-gate` + `file-guard` behavior
- unify prompts/status
- defer sandbox integration until the unified evaluation pipeline exists

That sequence reduces risk and avoids solving composition problems twice.
