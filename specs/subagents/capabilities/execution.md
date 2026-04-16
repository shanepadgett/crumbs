# Capability: Execution

## Overview

Execution defines how one subagent run starts, how workflow orchestration uses isolated sessions, how agent configuration affects runtime, and how results are produced.

Execution covers:

- isolated run creation
- cwd resolution
- model, thinking, and tool configuration
- task and handoff prompt construction
- activity capture and streaming state
- result finalization
- aggregate usage and output behavior
- runtime failure and abort semantics

## Requirements

### Isolated Run Creation

- Each run SHALL create fresh in-process session state.
- Each run SHALL use fresh resource-loading state.
- Each run SHALL use fresh in-memory session manager.
- Each run SHALL NOT reuse prior subagent message history.
- Each run SHALL execute without child process or IPC boundary.

### Run Working Directory Resolution

- Each run SHALL resolve working directory from step-local `cwd` when provided.
- If step-local `cwd` is not provided, the run SHALL use workflow default current working directory.
- Runs within same workflow MAY use different working directories.

### Agent Prompt Injection

- If agent prompt body is non-empty, the system SHALL append agent prompt body to session system prompt context.
- Agent prompt text SHALL be trimmed before use.
- Agent prompt injection SHALL occur before user task prompt is executed.

### Model Selection

- If agent definition omits `model`, the system SHALL leave run model unchanged unless inherited parent session model is already active.
- If agent definition provides bare model id, the system SHALL attempt to resolve matching model by id.
- If agent definition provides provider-qualified model value, the system SHALL attempt to resolve matching model by provider and id.
- When configured model resolves successfully, the system SHALL set session model before prompt execution.
- When configured model does not resolve, the system SHALL continue run without applying explicit override.
- Unknown configured model SHALL have already produced warning diagnostic during validation when model registry was available.

### Thinking Level Selection

- If agent definition omits `thinkingLevel`, the system SHALL leave run thinking level unchanged.
- If agent definition provides `thinkingLevel`, the system SHALL set session thinking level before prompt execution.

### Tool Selection and Inheritance

- If agent definition provides non-empty `tools`, the system SHALL request exactly that tool allowlist.
- If agent definition omits `tools`, the system SHALL inherit active tools from parent caller when parent active tools are available.
- If neither agent definition nor parent caller provides tools, the system SHALL leave tool activation unchanged.
- Before applying requested tools, the system SHALL verify that every requested tool exists in session-available tool set.
- When requested tool does not exist, the system SHALL fail run before prompt execution.

### Current Empty-Tools Behavior

- Under current parsed behavior, explicit empty `tools` array SHALL become indistinguishable from omitted `tools`.
- Under current parsed behavior, explicit empty `tools` array SHALL therefore inherit parent active tools rather than disabling tools.

### Prompt Construction

- A non-chain run SHALL execute prompt in exact two-line form:
  - `Task:`
  - `<trimmed task text>`
- A first chain step SHALL execute same prompt form as non-chain run.
- A later chain step SHALL execute prompt containing:
  - `Task:`
  - `<trimmed step task text>`
  - blank line
  - `Received handoff:`
  - fenced `text` block containing prior step output
- The system SHALL preserve raw prior step output inside chain handoff block.
- The system SHALL record human-readable prompt text used for each run result.

### Chain Handoff Source

- Handoff text SHALL come from prior step run `output` field.
- If prior step output is empty, later step SHALL receive no handoff block.
- Handoff SHALL NOT include sibling step state, tool traces, or aggregate workflow summary.

### Activity Capture

- The system SHALL capture assistant text deltas during run.
- The system SHALL capture tool execution start events.
- The system SHALL capture tool execution update events.
- The system SHALL capture tool execution end events.
- Tool start capture SHALL include tool call id, tool name, running status, and truncated arguments preview when available.
- Tool update capture SHALL update running activity preview with truncated partial result when available.
- Tool end capture SHALL move activity from active list to event history and SHALL mark status as `done` or `error`.
- The system SHALL maintain both active tool list and completed event list per run.

### Live Output State

- The system SHALL accumulate assistant text deltas into live text buffer.
- During active text streaming, the system SHALL publish interim run state including live text, active tools, and completed events.
- When assistant message ends, the system SHALL fold assistant usage and final text into run state.
- When agent ends, the system SHALL publish final activity state even if no additional text arrives.

### Usage Accounting

- Each run SHALL track input tokens, output tokens, cache read tokens, cache write tokens, total cost, context tokens, and turn count.
- When assistant message includes usage block, the system SHALL add usage values into run totals.
- Workflow aggregate usage SHALL equal sum of all run usage values.

### Run Finalization

- On normal completion, the system SHALL inspect session messages and extract latest assistant message.
- On normal completion, the system SHALL derive final output from latest assistant text when available.
- If assistant text is unavailable, the system SHALL fall back to existing output, error text, or trimmed stderr.
- The system SHALL record resolved model id when available.
- The system SHALL record stop reason when available.
- The system SHALL record error message from assistant message when available.
- The system SHALL mark completed run as done.
- The system SHALL record run duration.

### Non-Abort Error Handling

- If run fails with ordinary error, the system SHALL attempt to finalize from session state when session exists.
- On ordinary error, the system SHALL set run error text from caught error.
- On ordinary error, the system SHALL set `exitCode` to `1`.
- On ordinary error, the system SHALL mark run as done.
- On ordinary error, the system SHALL return failed `RunResult` rather than rethrowing, except for abort case.

### Abort Handling

- If external abort signal is already aborted before prompt starts, the system SHALL treat run as aborted.
- If external abort signal fires during run, the system SHALL request session abort.
- When run is aborted, the system SHALL rethrow `Subagent was aborted`.
- Aborted run SHALL NOT be converted into normal returned failed result under current behavior.

### Workflow Orchestration

- A `single` workflow SHALL create exactly one run.
- A `chain` workflow SHALL create one run per started step in order.
- A `parallel` workflow SHALL create one run per task slot.
- `parallel` execution SHALL respect effective concurrency limit while filling result slots by original index.
- During `parallel` execution, progress updates SHALL reflect currently available slot results and active update for in-flight task.

### Workflow Output Aggregation

- For `single`, workflow aggregate `output` SHALL equal single run output.
- For `chain`, workflow aggregate `output` SHALL equal last started run output.
- For `parallel`, workflow aggregate `output` SHALL concatenate one numbered section per task in original order.
- Each parallel output section SHALL include task index, agent name, and task output when present.
- If parallel task output is absent, aggregate output SHALL fall back to run error, trimmed stderr, or literal `(no output)`.

### Workflow Debug Progress

- When debug mode is enabled, workflow progress snapshots SHALL be collected.
- Progress snapshot SHALL include sequence number, done count, total count, mode, active agent, active tool names, recent tool names, live text, and output preview.
- Final workflow result MAY include collected progress debug payload.

## Current Behavioral Notes

- Under current behavior, chain stop condition uses failed step result and then exits loop without starting later steps.
- Under current behavior, ordinary run failures are normalized into `RunResult`, but aborts are rethrown.
- Under current behavior, parent active tools are inherited only when caller exposes active tool list.
