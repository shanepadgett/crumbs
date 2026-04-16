# Capability: Creation

## Overview

Creation defines interactive `/subagent create` behavior for cloning existing agents and generating new agents.

Creation covers:

- command availability
- interactive flow entry
- clone flow
- new flow
- generation contract
- collision and shadowing notices
- persistence
- post-write refresh behavior
- current creation limitations

## Requirements

### Command Availability

- The system SHALL expose `/subagent create` under subagent command set.
- `/subagent create` SHALL require interactive UI.
- When interactive UI is unavailable, the system SHALL reject `/subagent create` with message stating that interactive mode is required.

### Registry Preconditions

- `/subagent create` SHALL load current discovered registry at flow start.
- `/subagent create` SHALL load available tool names from runtime.
- `/subagent create` SHALL load available model identifiers from current model registry.
- Under current behavior, if discovered registry contains zero agents, `/subagent create` SHALL stop and SHALL show `No agents found` message even though `new` flow could theoretically proceed.

### Top-Level Mode Selection

- `/subagent create` SHALL present exactly two top-level modes: `new` and `clone`.
- If user cancels top-level mode selection, the system SHALL exit create flow without side effects.

### Shared Destination Scope Rules

- Creation flows SHALL allow destination scope `project` or `user`.
- `user` destination SHALL resolve to user agent directory plus `<agentName>.md`.
- `project` destination SHALL resolve to nearest discovered project agent directory when one exists.
- When no project agent directory exists, `project` destination SHALL resolve to project root `.pi/crumbs/agents/<agentName>.md`.

### Shared Configuration Options

- Creation flows SHALL allow model mode `inherit parent` or explicit model.
- Creation flows SHALL allow thinking mode `inherit parent` or explicit thinking level.
- Creation flows SHALL allow tools mode `inherit parent active tools` or explicit selected tools.
- Explicit thinking choices SHALL be limited to `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`.

### Clone Flow Entry

- When user selects clone flow, the system SHALL prompt for source agent.
- Clone source choices SHALL come from discovered effective agents.
- Source entry SHALL identify source scope and description.
- If user cancels source selection, clone flow SHALL exit without side effects.

### Clone Flow Defaults

- Clone flow SHALL default model selection from source agent model when present, else inherit.
- Clone flow SHALL default thinking selection from source agent thinking level when present, else inherit.
- Clone flow SHALL default tools selection from source agent tools when present, else inherit.

### Clone Flow Confirmation

- Before writing clone result, the system SHALL show confirmation screen.
- Clone confirmation SHALL include mode, source agent, destination scope, target path, model summary, thinking summary, and tools summary.
- If write target already exists in selected scope for same agent name, clone confirmation SHALL show overwrite warning.
- If resulting clone will shadow lower-precedence same-name agent, clone confirmation SHALL show shadowing note.
- If user cancels clone confirmation, clone flow SHALL exit without write.

### Clone Persistence

- When user confirms clone, the system SHALL ensure target parent directory exists.
- When user confirms clone, the system SHALL write Markdown agent definition using source agent `name`, `description`, and prompt body.
- Clone write SHALL include explicit `model` field only when user chose explicit model.
- Clone write SHALL include explicit `thinkingLevel` field only when user chose explicit thinking level.
- Clone write SHALL include explicit `tools` field only when user chose explicit non-empty tools list.
- Under current behavior, explicit empty tools selection SHALL be omitted from file rather than written as empty list.

### New Flow Entry

- When user selects new flow, the system SHALL collect destination scope, model selection, thinking selection, and tools selection before requesting freeform description.
- The system SHALL then prompt user for description of desired agent.
- If user submits empty description, the system SHALL require non-empty description before continuing.
- If user cancels description entry, new flow SHALL exit without side effects.

### Generation References

- New flow SHALL attempt to load built-in `scout`, `planner`, and `reviewer` prompt bodies as generation style references.
- If one or more built-in references are unavailable, generation MAY proceed with fewer references.

### Generation Model Selection

- If user selected explicit model for creation settings, new flow SHALL use that provider-qualified model for generation.
- If user selected inherit for model and active model exists in current session, new flow SHALL use current active model for generation.
- If explicit generation model cannot be resolved, new flow SHALL fail.
- If inherited generation model is requested and no active model exists, new flow SHALL fail.

### Generation Output Contract

- Generation SHALL request JSON object only.
- Generated object SHALL contain `name`, `description`, and `prompt`.
- Generated `name` SHALL match lowercase file-friendly pattern `^[a-z0-9][a-z0-9-]*$`.
- Generated `description` SHALL be non-empty string.
- Generated `prompt` SHALL be non-empty string.
- Generated `prompt` SHALL NOT include Markdown code fences.
- Generated `prompt` SHALL NOT begin with YAML frontmatter delimiter.

### Generation Retry Behavior

- If generation response is not valid JSON object or fails output validation, the system SHALL retry generation up to three total attempts.
- Retry prompt SHALL include previous invalid output and validation error.
- If generation stops with provider error, the system SHALL fail immediately rather than retrying as validation repair.
- If generation is aborted, the system SHALL fail immediately rather than retrying.

### New Flow Confirmation

- After valid generation, the system SHALL resolve target path from generated name and chosen scope.
- Before writing generated result, the system SHALL show confirmation screen.
- New confirmation SHALL include mode, generated name, generated description, destination scope, target path, model summary, thinking summary, and tools summary.
- If generated target already exists in selected scope, new confirmation SHALL show overwrite warning.
- If generated agent will shadow lower-precedence same-name agent, new confirmation SHALL show shadowing note.
- If user cancels new confirmation, new flow SHALL exit without write.

### New Persistence

- When user confirms new flow, the system SHALL ensure target parent directory exists.
- When user confirms new flow, the system SHALL write Markdown agent definition using generated `name`, generated `description`, generated `prompt`, and explicit selected runtime settings.
- New write SHALL include explicit `model` field only when user chose explicit model.
- New write SHALL include explicit `thinkingLevel` field only when user chose explicit thinking level.
- New write SHALL include explicit `tools` field only when user chose explicit non-empty tools list.

### Collision and Shadowing Analysis

- The system SHALL treat same-name agent in selected destination scope as overwrite target.
- The system SHALL treat lower-precedence same-name agents as shadowed entries.
- For `project` destination, shadowing notices SHALL include user and built-in same-name agents.
- For `user` destination, shadowing notices SHALL include built-in same-name agents.
- Collision and shadowing checks SHALL compare by agent name and source scope.

### Post-Write Refresh

- After successful create or clone write, the system SHALL clear in-memory registry cache.
- After successful create or clone write, the system SHALL refresh discovery immediately.
- Success screen SHALL identify whether agent was created or updated.
- Success screen SHALL show agent name and exact target path.

### Failure Handling

- If create or clone persistence fails, the system SHALL show failure screen with error message.
- If selected clone source disappears before use, the system SHALL show failure screen indicating source agent no longer exists.
- If generation fails, the system SHALL show failure screen with generation error message.

### Written File Shape

- Written agent file SHALL begin with YAML frontmatter delimiter line.
- Written agent file SHALL include `name` and `description` in frontmatter.
- Written agent file SHALL include optional `model`, `thinkingLevel`, and `tools` only when explicit value is being persisted.
- If `tools` are written, file SHALL render one YAML list item per tool.
- Written file SHALL contain blank line between frontmatter and prompt body.
- Written file SHALL end with trailing newline.
