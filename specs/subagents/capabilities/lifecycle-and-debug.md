# Capability: Lifecycle and Debug

## Overview

Lifecycle and Debug define subagent behavior tied to session lifecycle, registry refresh touchpoints, debug toggles, and debug payload capture.

This capability covers:

- startup behavior
- reload behavior
- shutdown behavior
- command completion behavior
- debug toggle semantics
- environment interaction
- debug capture visibility

## Requirements

### Startup and Reload Diagnostics

- On session start, the system SHALL inspect session start reason.
- When session start reason is `startup`, the system SHALL run refreshed registry diagnostics.
- When session start reason is `reload`, the system SHALL run refreshed registry diagnostics.
- When session start reason is neither `startup` nor `reload`, the system SHALL NOT run startup diagnostic pass.
- Startup and reload diagnostics SHALL include registration diagnostics and runtime validation diagnostics.
- When startup or reload finds zero warnings and zero errors, the system SHALL emit no notice.
- When startup or reload finds one or more warnings or errors, the system SHALL emit notice summarizing issue count and directing user to `/subagent doctor`.
- When startup or reload diagnostic pass itself fails, the system SHALL emit failure notice containing phase and caught error text.

### Shutdown Behavior

- On session shutdown, the system SHALL clear in-memory agent registry cache.

### Command Routing

- The system SHALL expose `/subagent` command with subcommands `list`, `doctor`, `create`, and `debug`.
- `/subagent list` SHALL refresh agent discovery before reporting.
- `/subagent doctor` SHALL refresh diagnostics before reporting.
- `/subagent create` SHALL enter interactive creation flow.
- `/subagent debug` SHALL support `on`, `off`, and `status` subcommands.
- If `/subagent debug` is invoked without subcommand, the system SHALL behave as status request.
- Unknown `/subagent` usage SHALL show usage text.

### Registry Refresh Touchpoints

- Startup and reload diagnostic pass SHALL force registry refresh.
- `/subagent list` SHALL force registry refresh.
- `/subagent doctor` SHALL force registry refresh.
- Successful create and clone writes SHALL clear registry cache and SHALL force rediscovery.
- Workflow execution SHALL resolve runnable agents using refreshed discovery under current behavior.

### Debug Enablement Sources

- Debug mode SHALL be controllable by slash command.
- Debug mode SHALL also honor environment variable `CRUMBS_SUBAGENT_DEBUG`.
- Environment variable values `1`, `true`, `yes`, and `on` SHALL enable debug mode case-insensitively.
- Slash-command enablement SHALL update in-memory debug toggle.
- Slash-command disablement SHALL update in-memory debug toggle.
- Debug status SHALL report enabled when in-memory toggle is enabled or environment variable is truthy.

### Debug Scope

- Debug enablement SHALL be global process-memory state rather than per-workflow argument.
- The `subagent` tool schema SHALL NOT expose debug flag.
- Tool callers SHALL NOT be able to enable debug mode through tool parameters alone.

### Run-Level Debug Capture

- When debug mode is enabled, each run SHALL capture structured debug payload after prompt execution when session exists.
- When debug mode is enabled and ordinary run failure occurs after session creation, failed run SHALL still capture structured debug payload.
- Run debug payload SHALL include current model id when available.
- Run debug payload SHALL include current thinking level.
- Run debug payload SHALL include task prompt sent to session.
- Run debug payload SHALL include effective system prompt.
- Run debug payload SHALL include appended system prompt parts.
- Run debug payload SHALL include active tool names.
- Run debug payload SHALL include all available tool names.
- Run debug payload SHALL include metadata for active tool definitions.
- Run debug payload SHALL include loaded agents/context files from resource loader.
- When provider request payload is observable, run debug payload SHALL include captured provider payload.

### Workflow-Level Debug Capture

- When debug mode is enabled, workflow execution SHALL accumulate progress snapshots.
- Progress snapshots SHALL be attached to workflow result debug payload.
- Progress snapshot SHALL capture sequence number, done count, total count, mode, active agent, active tool names, recent tool names, live text, and output preview.

### Debug Visibility

- Debug payload SHALL be visible only through expanded workflow rendering.
- Debug payload SHALL NOT change workflow invocation schema.
- Debug payload MAY increase result verbosity substantially.

### Abort and Debug Interaction

- If run is aborted before normal completion, current behavior SHALL propagate abort error.
- Current behavior SHALL NOT guarantee final debug payload on abort path because aborted run rethrows instead of returning normalized failed result.

## Current Behavioral Notes

- Debug status command is state-reporting shell around combined in-memory and environment enablement.
- Current lifecycle behavior uses cache clear on shutdown but still refreshes on many read paths, so cache is opportunistic rather than strongly authoritative.
