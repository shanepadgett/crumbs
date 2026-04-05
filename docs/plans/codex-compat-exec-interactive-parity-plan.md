# Codex Compat Exec Interactive Parity Plan

## Why this needs to happen

Current `exec_command` behavior in `extensions/codex-compat/src/shell-sessions.ts` is not interactive parity with Codex/Pi bash behavior.

Observed failure pattern:

- tool call runs `git commit`
- 1Password/GPG auth prompt requires user interaction
- compat tool does not remain in a true interactive terminal session
- command exits/fails early, and agent continues instead of waiting for proper auth completion

Root causes in current implementation:

1. `tty: true` is not a real PTY path (it is pipe mode with a fallback message).
2. Pipe mode does not enforce stdin-closed semantics for non-interactive runs.
3. Yield timing defaults are too short for interactive/auth workflows.
4. Session lifecycle and poll behavior are not tuned for long-lived interactive waits.
5. Environment shaping is currently optimized for deterministic non-interactive output, not terminal-auth workflows.

Without this fix, agent behavior around auth-gated commands remains unreliable and can produce incorrect follow-up actions.

---

## Goal

Make `exec_command` + `write_stdin` in `extensions/codex-compat` behave like Codex unified-exec for interactive correctness:

- real PTY when `tty: true`
- strict pipe behavior when `tty: false` (stdin closed, writes rejected)
- robust wait/poll timing for interactive and background flows
- predictable session state transitions (`session_id` while running, `exit_code` on completion)

---

## Scope

### In scope

- `extensions/codex-compat/src/shell-sessions.ts` runtime redesign for PTY + pipe split
- `extensions/codex-compat/index.ts` contract alignment if needed for parameter/default handling
- targeted tests for session semantics and timing clamps
- tool behavior verification with real auth-like command patterns

### Out of scope

- Porting full Codex Rust orchestration stack (approval/sandbox internals)
- Reworking unrelated tools (`apply_patch`, `view_image`) beyond compatibility side effects

---

## Implementation plan

### 1) Add true PTY execution path for `tty: true`

File: `extensions/codex-compat/src/shell-sessions.ts`

- Introduce PTY backend (`node-pty`) for interactive sessions.
- Keep pipe backend for non-interactive sessions.
- Preserve session abstraction so response shape remains:
  - `output`, `wall_time_seconds`, optional `session_id`, optional `exit_code`, optional `chunk_id`, optional `original_token_count`.

Expected behavior:

- PTY sessions carry terminal I/O and allow auth prompts to block naturally.
- `write_stdin` writes to PTY session stdin only.

### 2) Enforce strict non-interactive stdin semantics

File: `extensions/codex-compat/src/shell-sessions.ts`

- For pipe sessions (`tty: false`), spawn with stdin closed or equivalent no-write contract.
- `write_stdin` against non-PTY session returns error:
  - clear message: rerun `exec_command` with `tty=true` for interactive stdin.

This prevents false expectations that non-interactive sessions can be resumed interactively.

### 3) Align yield-time behavior to unified-exec style

File: `extensions/codex-compat/src/shell-sessions.ts`

Timing targets:

- `exec_command` default yield: ~10_000ms
- `write_stdin` default yield: ~250ms
- empty `write_stdin` polls clamp to min ~5_000ms
- retain upper clamp (~30_000ms)

Behavioral intent:

- non-empty writes stay responsive
- empty polls avoid hot-looping and give background processes time to produce output
- initial `exec_command` call does not return prematurely in common interactive flows

### 4) Separate environment policy for PTY vs pipe

File: `extensions/codex-compat/src/shell-sessions.ts`

- Keep deterministic env normalization for non-interactive pipe mode.
- For PTY mode, preserve terminal-relevant environment and semantics (`TERM`, interactive shell expectations, auth agent visibility).
- Avoid forcing PTY mode into `TERM=dumb` profile.

This reduces compatibility issues with prompts and terminal-aware auth tooling.

### 5) Tighten session lifecycle invariants

File: `extensions/codex-compat/src/shell-sessions.ts`

- Running session always returns `session_id` until complete.
- Completed session returns `exit_code` exactly once in final report and is then retired.
- Unknown/completed session ids fail deterministically in `write_stdin`.
- Preserve pruning/cap rules, but never destroy active interactive session unexpectedly without explicit limit/timeout signal.

### 6) Add regression tests

Add/update tests for:

- PTY path selected when `tty: true`
- pipe path selected when `tty: false`
- `write_stdin` rejected for non-PTY sessions
- yield clamp rules (exec default, write default, empty-poll minimum)
- finalization behavior (`session_id` -> `exit_code` transition)
- output truncation metadata remains consistent

---

## Acceptance criteria

1. `tty: true` uses real PTY and supports interactive stdin round-trips.
2. `tty: false` sessions reject `write_stdin` with explicit error.
3. Default/poll timing matches plan targets and prevents premature follow-up behavior.
4. Commands requiring auth prompts remain attached as running session until user interaction is completed.
5. Final response semantics are deterministic and stable for agent decision-making.
6. Type checks pass: `mise run check`.

---

## Validation checklist

### Automated

- run `mise run check`

### Manual

1. PTY echo loop smoke test
   - open session with `tty=true`
   - send stdin via `write_stdin`
   - verify echoed output and running session behavior
2. Non-PTY stdin rejection
   - run short command with `tty=false`
   - call `write_stdin`
   - verify explicit rejection error
3. Auth workflow repro
   - run signed `git commit` (or equivalent prompt-driven command) with `tty=true`
   - verify session remains running during prompt wait
   - complete prompt manually
   - poll to final `exit_code`

Note: any changes under `extensions/` require extension reload before live validation.

---

## Risks and mitigations

- Risk: PTY stream parsing introduces control-sequence noise.
  - Mitigation: keep current sanitization/delta logic for display output and validate with interactive command fixtures.

- Risk: longer default waits increase latency on fast commands.
  - Mitigation: preserve `yield_time_ms` override and clamp logic; tune defaults only to match interactive reliability.

- Risk: session cleanup regressions.
  - Mitigation: add explicit tests for completion, timeout, and pruning boundary behavior.

---

## Execution order

1. Implement PTY/pipe split in `shell-sessions.ts`.
2. Enforce stdin contract + write rejection rules.
3. Align timing defaults/clamps.
4. Tune env policy split for PTY vs pipe.
5. Add/update tests.
6. Run `mise run check`.
7. Reload extension and run manual auth-flow validation.
