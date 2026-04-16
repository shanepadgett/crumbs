# Subagents Specification

## Overview

Subagents provide isolated, role-specific workflow execution inside Pi.

This specification captures current subagents behavior as implemented under `extensions/subagents/`.

This specification is intentionally behavior-first.
It defines externally visible capability, operator-visible behavior, and current edge-case semantics without prescribing internal file layout or refactor shape.

This specification includes current observed behavior even when that behavior is awkward, asymmetric, or in tension with README wording.
That is deliberate. Current truth first. Cleanup decisions later.

## Capability Index

- [Registration](./capabilities/registration.md)
- [Workflows](./capabilities/workflows.md)
- [Execution](./capabilities/execution.md)
- [Rendering](./capabilities/rendering.md)
- [Creation](./capabilities/creation.md)
- [Lifecycle and Debug](./capabilities/lifecycle-and-debug.md)

## Terms

- **Agent definition** means one Markdown file containing YAML frontmatter and prompt body.
- **Registry** means discovered effective agent set plus diagnostics and resolved source directories.
- **Requested agent** means agent explicitly named by one workflow invocation.
- **Run** means one isolated subagent execution.
- **Workflow** means one `single`, `chain`, or `parallel` invocation.
- **Handoff** means prior chain step output forwarded into later chain step prompt.
- **Blocking diagnostic** means diagnostic with level `error` that prevents execution.

## Scope

- This specification SHALL cover built-in command behavior, tool behavior, interactive create behavior, registry behavior, runtime execution semantics, rendering behavior, lifecycle hooks, and debug behavior.
- This specification SHALL describe current behavior for built-in, user, project, and path-scoped agent discovery.
- This specification SHALL describe current behavior for successful flows, validation failures, runtime failures, and abort flows.
- This specification SHALL NOT prescribe implementation decomposition, module boundaries, or refactor strategy.

## Capability Boundaries

- Registration SHALL define agent source discovery, file format, merge precedence, and diagnostics.
- Workflows SHALL define invocation shapes, workflow-level validation, and workflow-level control semantics.
- Execution SHALL define isolated run behavior, model/thinking/tools application, activity capture, result aggregation, and failure semantics.
- Rendering SHALL define user-visible labels, progress summaries, expanded results, diagnostics rendering, and command-visible text surfaces.
- Creation SHALL define `/subagent create` user flows, generation contract, collision handling, write behavior, and current limitations.
- Lifecycle and Debug SHALL define startup, reload, shutdown, debug toggles, environment influence, and debug payload visibility.

## Conformance Notes

- Where current user-facing documentation and current runtime behavior differ, this specification SHALL prefer current runtime behavior.
- Where current behavior exposes inconsistencies rather than intentional product policy, this specification SHALL record those inconsistencies explicitly.
