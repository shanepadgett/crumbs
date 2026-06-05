# Subagents RPC enhancement brain dump

Status: future work, not current scope.

## Why this exists

Current subagents use one-shot child `pi --mode json -p --no-session ...` runs.

That was right for v1:

- small surface
- simple subprocess isolation
- easy stream parsing
- fewer lifecycle and cleanup risks

But longer-term orchestration wants more control than one-shot JSON mode gives.

## Desired outcomes

- true orchestrator control over child agents
- richer subagent introspection
- live steering during child execution
- controlled inter-agent communication
- enforced edit coordination across parallel agents
- better coordination primitives than plain text handoff
- durable groundwork for real multi-agent teams, not only chained prompts

## Main upgrade idea

Move subagents from one-shot JSON child execution toward persistent child sessions over RPC, or hybrid JSON+metadata path that evolves toward RPC.

## Features wanted

### 1. Effective child state introspection

Need ability to query actual child runtime state, not only requested settings.

Examples:

- effective model
- effective thinking level
- effective active tools
- provider/model capability info
- child cwd
- child session/run state

Why:

- debug overrides cleanly
- detect clamping/fallbacks
- show better expanded render/debug output

### 2. Live steering

Parent/orchestrator should be able to send follow-up steering while child is running.

Examples:

- tighten scope
- ask for different output format
- redirect effort after partial finding
- stop current branch and switch to narrower task

### 3. Mid-run querying

Parent should be able to ask child for state or progress without waiting for final exit.

Examples:

- current phase
- summary-so-far
- unresolved blockers
- current plan
- current artifacts produced

### 4. Inter-agent communication / mailbox

Add controlled message passing between child agents.

Mailbox is not source of truth for edit ownership. It is communication channel used by orchestrator and agents for coordination, questions, nudges, and status exchange.

Possible shapes:

- orchestrator-managed mailbox per agent
- broadcast and direct-addressed messages
- append-only messages with timestamps and sender ids
- explicit polling or push delivery via RPC

Primary uses:

- steering messages from orchestrator to child
- child status updates
- stale-lock nudges
- coordination questions between child agents through orchestrator
- unblock requests

Guardrails:

- no hidden free-for-all chat bus
- explicit routing only
- bounded message size
- bounded queue depth
- deterministic ordering
- orchestrator remains authority

### 5. Enforced edit locks / file coordination

This is stronger than soft claims.

Goal:

- child agents must acquire real orchestrator-managed edit locks before mutating files
- unauthorized writes should be blocked by architecture, not only discouraged by convention

Desired behavior:

1. child prepares intended mutation
2. before mutation, child requests lock for file or file set
3. orchestrator grants or denies lock
4. only lock owner may perform mutation
5. lock released immediately after mutation completes
6. if lock denied, child waits/retries with bounded backoff
7. if lock appears stale, child can message lock owner through mailbox via orchestrator

Important constraint:

- this only works if mutating operations are mediated by orchestrator-controlled write path
- raw direct child writes would bypass lock model

Likely architecture implication:

- proxy mutating tools (`apply_patch`, `write`, maybe edit variants) through orchestrator
- parent becomes transaction manager / file-system arbiter for child edits

Lock model notes:

- lock scope should start at file path level
- leases should be short-lived
- lock lifetime should wrap actual mutation operation, not whole child session
- orchestrator should force-release on child death or lease expiry
- all locks need lease renewal and cleanup semantics

Suggested lock fields:

- `path`
- `ownerAgentId`
- `runId`
- `kind` (`edit` first; maybe more later)
- `acquiredAt`
- `leaseMs`
- `expiresAt`

Waiting behavior:

- bounded retries with jittered backoff
- then mailbox ping to lock owner if still blocked
- then fail cleanly or escalate to orchestrator

Version safety:

- also add optimistic concurrency check on apply
- child patch/apply should carry expected file hash/version when possible
- if file changed since child prepared patch, reject and require rebase/regeneration

This pair is ideal:

- short edit locks
- version check on apply

### 6. Multi-turn child sessions

Child should optionally stay alive across multiple orchestrator interactions.

Why:

- lower spawn overhead
- preserve working context within branch
- enable true collaboration instead of stateless reruns
- support steering, mailbox delivery, and lock ownership/query flows

### 7. Better cancellation and lifecycle control

Need more than kill process.

Desired:

- graceful stop request
- hard kill fallback
- pause/resume maybe later
- explicit session close
- orphan cleanup rules

### 8. Structured outputs and artifacts

Parent should be able to pull machine-usable artifacts, not only final text.

Examples:

- checkpoints
- plan objects
- findings lists
- issue lists
- proposed patches metadata
- named documents produced during run

### 9. Team orchestration primitives

Possible future concepts:

- manager agent
- worker pool
- reviewer gate
- scout swarm
- planner + implementer + verifier loops
- quorum/consensus patterns
- file-owner / patch-writer / integrator patterns
- orchestrator-driven wait / retry / redirect behavior

## Possible architecture directions

### Option A: full RPC child sessions

Pros:

- richest control
- explicit request/response model
- state queries easy
- live steering possible
- mailbox and lock flows fit naturally

Cons:

- most complexity
- more lifecycle bugs
- harder cleanup
- more process management code

### Option B: hybrid JSON mode + metadata/control hooks

Idea:

- keep one-shot execution model
- add structured startup metadata event
- maybe add limited side-channel for steering/query
- maybe proxy write operations first before full RPC migration

Pros:

- less churn
- smaller risk
- enough for debugging and some orchestration

Cons:

- awkward midpoint
- may delay inevitable RPC migration
- edit-lock/mailbox design may become contorted if side-channel too limited

### Option C: RPC only for advanced mode

Idea:

- keep simple one-shot mode as default
- add advanced orchestrated mode for long-lived child sessions

This may be best long-term split.

Likely best future split:

- basic subagent mode stays one-shot and simple
- advanced orchestration mode uses persistent RPC child sessions, mailbox, and edit locks

## Suggested phased roadmap

### Phase 1

- add startup metadata from child
- capture effective model / effective thinking / active tools
- expose in subagent expanded render and result details

### Phase 2

- add orchestrator-mediated mutating tool path
- prototype file lock manager with short leases
- add optimistic version/hash checks on apply

### Phase 3

- add persistent child session abstraction
- basic RPC request/response wrapper
- graceful shutdown + timeout + hard-kill fallback

### Phase 4

- add live steering from parent to child
- add status/progress query APIs

### Phase 5

- add orchestrator mailbox/message passing
- bounded deterministic queues
- explicit delivery semantics
- stale-lock ping flow
- owner query flow for blocked edits

### Phase 6

- add team orchestration patterns/helpers
- branch-level shared artifacts
- structured outputs
- richer lock-aware worker coordination

### Phase 7

- optional multi-file lock sets with deadlock-safe acquisition
- path-scope locks only if proven necessary
- conflict visualization / inspection UI

## Important design constraints

- keep simple mode simple
- do not regress current one-shot reliability
- deterministic behavior matters more than flashy autonomy
- explicit control over hidden agent-to-agent comms
- bounded resources and cleanup mandatory
- no orphan children
- no unbounded mailbox growth
- no direct child write path that bypasses lock system in advanced mode
- lock lease expiry and forced cleanup mandatory
- avoid deadlock in multi-file locking
- mutation boundary matters more than long-lived ownership

## UX ideas

- expanded subagent result could show live child state
- orchestrator could inspect team members during run
- maybe future `/subagent team` or `/subagent inspect`
- maybe future mailbox/queue viewer in TUI
- maybe future branch graph / agent tree view
- maybe future lock viewer / contention inspector
- maybe future waiting-state UI for blocked child edits

## Risks

- complexity explosion
- subtle race conditions
- zombie child sessions
- hard-to-debug orchestration state
- too much autonomy, not enough determinism
- lock contention and deadlock bugs
- stale lock leaks after partial failure
- bypass paths through unmanaged write tools

## Notes

- current architecture was still right starting point
- do not derail current override flow or current stabilization work
- revisit after override UX and current test matrix are solid

## Refined architecture stance

- mailbox is communication layer, not ownership truth
- orchestrator-managed edit locks are ownership truth for advanced multi-agent editing
- advanced mode likely requires orchestrator-mediated writes and persistent RPC child sessions
- simple one-shot JSON mode should remain available for low-complexity work
