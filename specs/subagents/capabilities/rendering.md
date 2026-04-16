# Capability: Rendering

## Overview

Rendering defines how subagent calls, progress, results, diagnostics, and related command outputs appear to users.

Rendering covers:

- tool call labels
- progress summaries
- collapsed and expanded workflow result blocks
- diagnostic reports
- command-visible messages
- debug output rendering

## Requirements

### Tool Call Labeling

- The tool call title SHALL identify workflow shape.
- A single workflow title SHALL render as `subagent · <agent>` with optional task subtitle.
- A chain workflow title SHALL render as `subagent · <agent1> → <agent2> ...` with optional first-task subtitle.
- A parallel workflow title SHALL render as `subagent · <N> task` or `subagent · <N> tasks` with optional first-task subtitle.
- Subtitle text SHALL be whitespace-normalized and truncated.
- Chain agent list SHALL be truncated when long.

### Tool Activity Preview Rendering

- Tool activity SHALL render as `<ToolName>(<preview>)`.
- Tool name casing SHALL be transformed into title-like form based on underscores and hyphens.
- Preview extraction SHALL prefer values associated with keys `command`, `query`, `pattern`, `url`, `path`, `input`, `task`, or `agent` when available.
- If activity arguments parse as object, preview SHALL prefer first matching string among preferred keys.
- If activity arguments parse as string, preview SHALL use embedded preferred-key value when recoverable, else full string.
- Preview text SHALL be whitespace-normalized and truncated.
- Absolute preview paths inside run working directory SHALL be rendered relative to run working directory.
- If tool activity ends in error, rendered line SHALL append `· error: <preview or failed>`.

### Progress Updates

- During workflow execution, the system SHALL emit progress updates.
- Progress update text SHALL use collapsed workflow rendering.
- Progress update SHALL include structured workflow details payload when available.
- Progress footer SHALL communicate coarse state.
- Before visible activity exists, a single workflow collapsed body MAY be empty.
- While workflow is running without visible activity, footer SHALL render `Starting`.
- While workflow is running with visible activity or live text, footer SHALL render `Running...`.
- After workflow completion, footer SHALL render `Done` or `Failed` plus item count, tool-use count, and duration.

### Single Workflow Collapsed Rendering

- If single run has no visible tool activity, no live text, and is not complete, collapsed body SHALL be empty.
- If single run fails and has tool events, collapsed body SHALL prefer most recent tool event rendering.
- If single run fails and has no tool events, collapsed body SHALL show truncated error or stderr preview.
- If single run succeeds or is in progress, collapsed body SHALL show up to recent visible activities.
- If additional visible activities are hidden, collapsed body SHALL append `+N more tool use(s)`.
- If no visible activities exist and output text exists, collapsed body SHALL show truncated output preview.

### Single Workflow Expanded Rendering

- Expanded single result SHALL include `Prompt` section when prompt exists.
- Expanded single result SHALL include ordered tool activity lines when activities exist.
- Expanded single result SHALL include `Response` section for successful completed output.
- Expanded single result SHALL include `Error` section when run error or stderr exists.
- Expanded single result SHALL include `Debug` section when debug payload exists.

### Multi-Item Collapsed Rendering

- Chain and parallel collapsed rendering SHALL show one row per requested item.
- Each row SHALL show row label and one of `Waiting`, `Starting`, latest activity/live text, `Done`, or `Failed`.
- Parallel row labels SHALL always be numbered.
- Chain row labels SHALL be numbered when repeated agent names appear; otherwise chain MAY use bare agent name.

### Chain Expanded Rendering

- Chain expanded rendering SHALL render one section per requested step.
- Each started section SHALL be titled `Step <n> · <agent>`.
- Started section SHALL include `Prompt` when present.
- Started section SHALL include activity lines when present.
- Successful completed step SHALL label output section as `Handoff`.
- Failed step SHALL label failure section as `Error`.
- Not-started future step SHALL render `Waiting`.

### Parallel Expanded Rendering

- Parallel expanded rendering SHALL render one section per requested task.
- Each section SHALL be titled `Task <n> · <agent>`.
- Started section SHALL include `Prompt` when present.
- Started section SHALL include activity lines when present.
- Successful completed task SHALL label output section as `Response`.
- Failed task SHALL label failure section as `Error`.
- Not-yet-populated task slot SHALL render `Waiting`.

### Expandability

- Workflow result SHALL be treated as expandable only when expanded text is non-empty and differs from collapsed text.
- Diagnostics-only result SHALL render as plain text rather than workflow collapsible transcript.

### Diagnostics Rendering

- Blocking diagnostics text SHALL begin with heading `subagent blocked`.
- Blocking diagnostics text SHALL include one block per issue with level, location, and message.
- Thrown blocking summary SHALL begin with `Subagent run blocked by agent definition errors:`.
- Thrown blocking summary SHALL include up to first five issue messages.
- If more than five issue messages exist, thrown blocking summary SHALL append `... N more` line.
- Thrown blocking summary SHALL end with `Run /subagent doctor.`.

### List Command Rendering

- `/subagent list` output SHALL begin with heading `subagents`.
- If no agents are found, `/subagent list` SHALL render `No agents found.`.
- If agents are present, `/subagent list` SHALL group rows by `Project`, `User`, `Built-in`, and `Path`.
- Each group table SHALL render columns `Name`, `Model`, and `Tools`.
- Missing model SHALL render as `inherit parent`.
- Missing tools SHALL render as `inherit parent`.

### Doctor Command Rendering

- `/subagent doctor` output SHALL begin with heading `subagent doctor`.
- `/subagent doctor` output SHALL include counts for scanned agents, errors, warnings, and info.
- If no diagnostics exist, `/subagent doctor` SHALL render `No issues found.`.
- If diagnostics exist, `/subagent doctor` SHALL list each diagnostic with level, location, and message.

### Startup and Reload Notices

- When startup or reload detects warnings or errors, notice text SHALL identify issue count and phase.
- Startup or reload notice SHALL tell user to run `/subagent doctor`.
- If startup or reload diagnostic collection fails, notice text SHALL identify phase and caught error text.

### Command Usage and Debug Status Rendering

- `/subagent debug status` SHALL render `subagent debug: on` or `subagent debug: off`.
- `/subagent debug on` SHALL enable debug mode and SHALL render current debug status.
- `/subagent debug off` SHALL disable debug mode and SHALL render current debug status.
- Unknown command usage SHALL render `Usage: /subagent [list|doctor|create|debug on|off|status]`.

### Debug Rendering

- When run debug payload exists, expanded transcript SHALL include `Debug:` section.
- Debug section SHALL render pretty-printed structured debug payload.
- Debug payload MAY include model, thinking level, task, effective system prompt, appended system prompt parts, active tools, available tools, active tool definitions, loaded agents/context files, provider payload, and workflow progress snapshots.

### Result Coloring

- Diagnostics result with any error diagnostic SHALL use error color.
- Diagnostics result without error diagnostic SHALL use warning color.
- Workflow result with failed run SHALL use error color.
- Successful workflow result SHALL use normal tool-output color.

## Current Behavioral Notes

- Single collapsed view can intentionally render blank body while footer still shows `Starting`.
- Parallel textual aggregate output is not same as expanded transcript; it is numbered summary block.
- Expanded chain output uses `Handoff` label even for final chain step, because output is treated as next-step handoff-form text.
