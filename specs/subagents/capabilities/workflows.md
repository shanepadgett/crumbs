# Capability: Workflows

## Overview

Workflows define how callers request subagent work.

A workflow is one of three invocation modes:

- `single`
- `chain`
- `parallel`

Workflows cover:

- invocation shapes
- workflow argument validation
- agent selection for workflows
- chain and parallel control semantics
- workflow-level completion and failure rules

## Requirements

### Supported Workflow Modes

- The system SHALL support `single`, `chain`, and `parallel` workflows.
- Each invocation SHALL provide exactly one valid workflow shape.
- When invocation provides more than one valid workflow shape, the system SHALL reject the invocation.
- When invocation provides no valid workflow shape, the system SHALL reject the invocation.

### Explicit Mode Consistency

- Invocation MAY provide explicit `mode` field.
- When explicit `mode` is provided, the system SHALL derive effective mode from supplied shape.
- If explicit `mode` does not match derived workflow shape, the system SHALL reject the invocation.

### Single Workflow Shape

- A `single` workflow SHALL consist of one `agent` string and one `task` string.
- A `single` workflow MAY include `cwd` as string.
- The system SHALL reject `single` workflow when `agent` is missing or not string.
- The system SHALL reject `single` workflow when `task` is missing or not string.
- The system SHALL reject `single` workflow when `cwd` is present and not string.

### Chain Workflow Shape

- A `chain` workflow SHALL consist of non-empty `chain` array.
- Each chain item SHALL be object with `agent` string and `task` string.
- Each chain item MAY include `cwd` as string.
- The system SHALL reject `chain` workflow when `chain` is empty.
- The system SHALL reject chain item when item is not object.
- The system SHALL reject chain item when `agent` or `task` is missing or not string.
- The system SHALL reject chain item when `cwd` is present and not string.
- The system SHALL preserve caller-supplied chain order.

### Parallel Workflow Shape

- A `parallel` workflow SHALL consist of non-empty `tasks` array.
- Each parallel task SHALL be object with `agent` string and `task` string.
- Each parallel task MAY include `cwd` as string.
- Invocation MAY include `concurrency` override.
- If `concurrency` is provided, it SHALL be finite number.
- The system SHALL reject `parallel` workflow when `tasks` is empty.
- The system SHALL reject parallel task when item is not object.
- The system SHALL reject parallel task when `agent` or `task` is missing or not string.
- The system SHALL reject parallel task when `cwd` is present and not string.

### Requested Agent Determination

- For `single`, requested agent set SHALL contain exactly named `agent`.
- For `chain`, requested agent set SHALL contain unique agent names across all chain items.
- For `parallel`, requested agent set SHALL contain unique agent names across all tasks.
- The system SHALL validate requested agents before execution begins.

### Registry-Gated Workflow Start

- Before workflow execution begins, the system SHALL resolve requested agents against effective registry.
- Before workflow execution begins, the system SHALL evaluate requested-agent diagnostics.
- If requested agents have blocking diagnostics, the system SHALL reject workflow before any run starts.
- If no effective agents exist, the system SHALL reject workflow with actionable guidance.

### Unknown Requested Agents

- If workflow references agent name absent from effective registry, the system SHALL reject execution when that run is reached.
- Unknown-agent failure SHALL include available effective agent names when available.

### Chain Control Semantics

- A `chain` workflow SHALL execute one step at time.
- Each chain step after first SHALL receive prior step output as handoff.
- The system SHALL stop chain after first failed, errored, or aborted run.
- The system SHALL NOT start later chain steps after chain stop condition occurs.

### Parallel Control Semantics

- A `parallel` workflow SHALL execute tasks independently.
- A `parallel` workflow SHALL preserve original task slot order in result set.
- A `parallel` workflow SHALL NOT use cross-task handoff.
- One failed parallel task SHALL NOT cancel sibling tasks under current behavior.

### Parallel Limits

- A `parallel` workflow SHALL require at least one task.
- The system SHALL reject `parallel` workflow with more than 8 tasks.
- The system SHALL derive effective concurrency from explicit override or default.
- When no concurrency override is provided, the system SHALL use `min(taskCount, 4)`.
- The system SHALL clamp effective concurrency to minimum `1`.
- The system SHALL clamp effective concurrency to maximum `4`.

### Workflow Completion Model

- A workflow result SHALL include workflow mode, requested items, collected runs, aggregate output, aggregate usage, completed count, total count, and duration.
- A `single` workflow SHALL complete after one run finishes.
- A `chain` workflow SHALL complete after last started step finishes or chain stop condition occurs.
- A `parallel` workflow SHALL complete after all started tasks finish.

### Workflow Failure Model

- A run SHALL count as failed when `exitCode` is non-zero.
- A run SHALL count as failed when stop reason is `error`.
- A run SHALL count as failed when stop reason is `aborted`.
- If any workflow run fails, tool-level execution SHALL ultimately surface workflow as error rather than success result.

### Workflow Abort Model

- Workflow execution SHALL accept abort signal.
- When active run observes abort signal, the system SHALL abort that run.
- Under current behavior, workflow abort SHALL propagate immediately rather than returning normal completed workflow result.
- Workflow MAY emit partial progress updates before abort propagates.

## Current Behavioral Notes

- Empty `chain` and empty `tasks` are both invalid shapes during argument resolution.
- `parallel` has both shape-level non-empty requirement and execution-level explicit zero-task rejection.
- Requested-agent validation is narrower than registry-wide validation and intentionally ignores unrelated broken agents.
