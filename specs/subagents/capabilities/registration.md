# Capability: Registration

## Overview

Registration defines how subagent definitions are discovered, parsed, merged into effective registry state, and diagnosed.

Registration covers:

- agent source discovery
- agent definition file contract
- source precedence and shadowing
- duplicate handling
- runtime validation
- registry diagnostics
- requested-agent diagnostic filtering
- registry caching behavior

## Requirements

### Source Discovery

- The system SHALL discover agent definitions from built-in, user, and project source directories.
- The system SHALL treat built-in source directory as extension-local built-in agent directory.
- The system SHALL treat user source directory as `~/.pi/crumbs/agents`.
- The system SHALL treat project source directory as nearest ancestor `.pi/crumbs/agents` directory found by walking upward from current working directory.
- The system MAY accept additional explicit source directories and SHALL classify discovered definitions from those directories as `path` source.
- The system SHALL scan only directory entries whose names end with `.md`.
- The system SHALL include regular files and symbolic links during scan.
- The system SHALL ignore non-Markdown entries.
- If a source directory does not exist, the system SHALL treat that source as empty and SHALL NOT emit diagnostic.
- If a source path exists but is not a directory, the system SHALL treat that source as empty and SHALL NOT emit diagnostic.
- If directory enumeration fails for reason other than missing path or non-directory path, the system SHALL emit error diagnostic for that source path.

### Agent Definition File Contract

- Each agent definition SHALL be one Markdown file.
- Each agent definition SHALL contain YAML frontmatter that parses to object.
- Each agent definition SHALL contain non-empty prompt body after frontmatter.
- If file begins with frontmatter opening delimiter and no closing delimiter is present, the system SHALL reject that file with explicit error diagnostic.
- The system SHALL normalize mixed newline styles before parsing frontmatter and body.

### Required Frontmatter Fields

- Each agent definition SHALL provide `name` as non-empty string.
- Each agent definition SHALL provide `description` as non-empty string.
- If `name` is missing, empty, or not string, the system SHALL reject that file with error diagnostic.
- If `description` is missing, empty, or not string, the system SHALL reject that file with error diagnostic.

### Optional Frontmatter Fields

- An agent definition MAY provide `model` as non-empty string.
- An agent definition MAY provide `thinkingLevel` as one of `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- An agent definition MAY provide `tools` as array of non-empty strings.
- If `model` is present and not non-empty string, the system SHALL reject that file with error diagnostic.
- If `thinkingLevel` is present and not one of supported values, the system SHALL reject that file with error diagnostic.
- If `tools` is present and not array of non-empty strings, the system SHALL reject that file with error diagnostic.

### Prompt Body

- The system SHALL trim prompt body content after frontmatter parsing.
- If trimmed prompt body is empty, the system SHALL reject that file with error diagnostic.
- The system SHALL store trimmed prompt body as agent prompt text.

### Agent Naming and File Identity

- The system SHALL identify effective agents by frontmatter `name`.
- The system SHALL NOT use filename as successful registration substitute for missing `name`.
- The system SHALL use filename stem as best-effort diagnostic label only when frontmatter name is unavailable.
- Shadowing and duplicate checks SHALL compare agent `name`, not filename.

### Registry Construction

- The system SHALL merge all successfully parsed agent definitions into one registry.
- The registry SHALL include effective agent list.
- The registry SHALL include all collected diagnostics.
- The registry SHALL include resolved built-in, user, and project directory paths.
- The effective agent list SHALL be sorted by agent name.

### Source Precedence and Shadowing

- The system SHALL load default sources in precedence order `builtin`, then `user`, then `project`.
- The system SHALL load explicit extra `path` sources after default sources.
- When two agents from different sources share same `name`, later-loaded source SHALL replace earlier-loaded source in effective registry.
- When later-loaded source replaces earlier-loaded source with same `name`, the system SHALL emit informational shadowing diagnostic.
- Cross-scope shadowing SHALL NOT block registry construction.

### Same-Scope Duplicates

- When two agents from same source share same `name`, the system SHALL emit error diagnostic.
- When same-scope duplicate is detected, the system SHALL retain first encountered agent as effective entry for that source.
- Same-scope duplicate SHALL be treated as blocking diagnostic for execution if that agent is requested.

### Runtime Validation

- The system SHALL perform runtime validation separately from file parse validation.
- Runtime validation SHALL check configured tool names against currently available tool names.
- When agent references unknown tool name, the system SHALL emit error diagnostic for that agent.
- Runtime validation SHALL check configured model values against current model registry.
- When configured model is bare model id, the system SHALL match against available model ids.
- When configured model contains provider-qualified form `provider/id`, the system SHALL match against provider-qualified keys.
- When configured model is not found in current model registry, the system SHALL emit warning diagnostic for that agent.
- Unknown model reference SHALL NOT become blocking diagnostic by itself.
- If current model registry cannot be queried, the system SHALL skip model-availability warnings rather than fail registration.

### Requested-Agent Diagnostic Filtering

- When executing workflow, the system SHALL evaluate blocking registration diagnostics only for requested agents.
- The system SHALL treat diagnostic as belonging to requested agent when diagnostic contains matching `agentName`.
- When diagnostic does not contain `agentName`, the system SHALL also allow filename-stem match against requested agent name.
- Diagnostics for unrelated broken agents SHALL NOT block execution of requested valid agents.

### Empty and Degenerate Registry States

- The registry MAY contain zero effective agents.
- The registry MAY contain zero effective agents even when source directories exist.
- Invalid files, duplicate conflicts, or full shadowing MAY result in registry with fewer effective agents than files scanned.

### Registry Cache

- The system SHALL maintain in-memory registry cache keyed by resolved project root.
- Non-refresh discovery SHALL reuse cached registry for same project key when available.
- Refresh discovery SHALL rebuild registry from source directories.
- Session shutdown SHALL clear registry cache.

## Current Behavioral Notes

- The system currently preserves distinction between omitted `tools` and explicit non-empty `tools`, but it does NOT preserve distinction between omitted `tools` and explicit empty `tools` after parse.
- The system currently discovers nearest existing project agent directory rather than always materializing one at project root during registration.
- The system currently allows symbolic-link Markdown files to participate in effective registry.
