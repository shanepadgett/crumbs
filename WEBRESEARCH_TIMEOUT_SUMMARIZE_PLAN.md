# Web Research Timeout Summarize Plan

## Goal

Change `webresearch` timeout behavior so it does **not** hard-kill useful work immediately.

Instead, when the research child is near timeout or hits timeout, it should:

1. stop doing more search/fetch work,
2. summarize the most reliable findings gathered so far,
3. return that summary in the caller-requested `responseShape`,
4. keep the parent agent context clean.

## Current architecture

Today, `webresearch` runs in an isolated child Pi process so the parent agent does **not** get polluted by:

- raw fetched page contents,
- intermediate retrieval noise,
- exploratory search steps,
- child-agent reasoning.

The parent currently only receives:

- progress updates for UI,
- final synthesized output,
- usage/error metadata.

This is the right architecture and should stay that way.

## Current timeout limitation

Right now the child process is effectively a one-shot print/json subprocess.

On overall timeout or idle timeout, the runner eventually terminates the child process. That means:

- partially useful research may be lost,
- spent tokens may not produce a usable final synthesis,
- the parent receives an error instead of a "best effort so far" result.

## Desired behavior

Timeout handling should become a **soft-stop then summarize** flow:

1. research proceeds normally,
2. a soft timeout threshold is reached,
3. the child is instructed to stop further searching/fetching,
4. the child produces a final answer from gathered evidence so far,
5. only if that fails do we hard-abort.

## Important constraint

The parent agent must **not** do the research or receive the raw child context.

Any steering message must go to the **child process/session**, not the parent.

The parent should still only receive:

- progress/status,
- final synthesized result,
- metadata.

## Likely implementation direction

### 1. Refactor child execution into a controllable session/process

Current runner uses a one-shot subprocess invocation.

To support summarize-on-timeout, refactor the child runner so it can:

- keep the child alive as a session/process,
- send a follow-up/steering message into that child,
- continue reading events until final assistant output arrives.

Possible directions to investigate:

- Pi RPC mode,
- Pi SDK session runtime,
- a session-backed interactive child process,
- any supported stdin/control mechanism for queued follow-up messages.

### 2. Add soft timeout thresholds

Split timeout handling into stages:

- **soft timeout**: trigger summarize-now steering,
- **hard timeout**: kill if child does not finish after the summarize request,
- **idle timeout**: ideally also try summarize-now before kill, unless the child is fully wedged.

### 3. Add child steering message

Candidate steering message:

> Stop searching and fetching now. Using only the information already gathered, produce the best possible final answer in the required response shape. Clearly note uncertainty or missing evidence where needed.

This message should preserve:

- `responseShape`,
- citation requirements,
- source-bounded answering,
- no additional tool calls unless explicitly allowed.

### 4. Guard against more tool calls after soft timeout

Once summarize-now is triggered, child execution should avoid further web tool usage.

Possible enforcement options:

- update system/prompt instructions in the steering message,
- add a runner-side flag that rejects further `websearch`/`webfetch` calls after soft timeout,
- treat attempted new tool calls as a signal to force hard shutdown sooner.

### 5. UI states

Potential progress states during timeout summarization:

- `└ [1m28s] finalizing from gathered results`
- `└ [1m31s] compiling timed summary`

This should stay minimal and consistent with the current UI.

## Files most likely involved

- `extensions/web/shared/research-runner.ts`
- `extensions/web/research.ts`
- potentially a new child-session control helper in `extensions/web/shared/`

## Suggested checkpoints

1. choose child control mechanism,
2. prove a child can be steered after initial launch,
3. implement soft-timeout summarize request,
4. preserve final output/usage extraction,
5. verify parent context remains clean,
6. test with forced short timeout on quick/balanced/thorough runs.

## Acceptance criteria

- timed-out research returns a best-effort final synthesis when possible,
- parent context still only gets final shaped output and metadata,
- no raw fetched context leaks into parent,
- hard-abort still exists as a fallback,
- UI clearly shows finalization after timeout is triggered.
