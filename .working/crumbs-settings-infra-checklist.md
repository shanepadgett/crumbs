# Crumbs settings infrastructure migration checklist

## Goals

- Move crumbs-owned settings to crumbs config files only.
- Add global crumbs config support.
- Remove crumbs key usage from Pi settings.
- Add `/crumbs doctor` to detect deprecated key locations and guide cleanup.

## Phase 0 — Alignment + guardrails

- [x] Confirm canonical paths and precedence contract in code comments + docs:
  - global: `~/.pi/agent/crumbs.json`
  - project: `<projectRoot>/.pi/crumbs.json`
  - precedence: project > global > defaults
- [x] Confirm no legacy fallback behavior (no reads from Pi settings for crumbs-owned keys).
- [x] Define crumbs-owned key inventory for migration scope:
  - `extensions.pathVisibility`
  - `extensions.focusAdvanced`
  - `extensions.quietMarkdownlint`
  - `extensions.quietMiseTask`
  - `extensions.quietXcodeBuild`
  - `extensions.statusTable`
  - `extensions.codexCompat.fast` (migrates from `crumbs-fast`)
  - `extensions.caveman` (migrates from `crumbs-caveman`)
  - `extensions.pathVisibility.sessionFocus` (migrates from `crumbs-focus`)
  - `extensions.focusAdvanced.sessionFocus` (migrates from `crumbs-focus-advanced`)

## Phase 1 — Shared config infrastructure

- [x] Create `extensions/shared/config/project-root.ts`
  - resolve project root from arbitrary cwd (walk up for `.git` or `.pi/crumbs.json`).
- [x] Create `extensions/shared/io/json-file.ts`
  - safe read/write JSON object helpers.
  - stable formatting (`JSON.stringify(..., null, 2) + "\n"`).
- [x] Create `extensions/shared/config/crumbs-paths.ts`
  - helpers for global/project crumbs paths.
- [x] Create `extensions/shared/config/crumbs-merge.ts`
  - merge policy implementation (object deep merge + explicit array behavior).
- [x] Create `extensions/shared/config/crumbs-loader.ts`
  - load global crumbs config.
  - load project crumbs config.
  - load effective crumbs config (project over global).
  - scoped getters for `extensions.<name>`.

## Phase 2 — Schema + docs

- [x] Update `schemas/crumbs.schema.json`:
  - add `extensions.statusTable` schema block (`enabled`, `mode: full|minimal`).
  - ensure schema still allows existing extension keys.
- [x] Update `README.md` with settings architecture section:
  - global/project crumbs paths.
  - precedence and ownership boundary.
  - no Pi settings for crumbs-owned keys.
- [x] Add `docs/settings-architecture.md`:
  - authoring guide for extension developers.
  - examples for global defaults + project overrides.
- [x] Expand `schemas/crumbs.schema.json` for remaining migrated crumbs-owned runtime keys:
  - `extensions.codexCompat.fast`
  - `extensions.caveman` (`enabled`, `mode`)
  - `extensions.pathVisibility.sessionFocus` (`enabled`, `mode`, `roots`)
  - `extensions.focusAdvanced.sessionFocus` (`enabled`, `mode`, `roots`)

## Phase 3 — Status table migration (first writer cutover)

- [x] Refactor `extensions/status-table/src/settings.ts` to use shared crumbs loader.
- [x] Move status table prefs source of truth to crumbs config:
  - read from `extensions.statusTable` effective config.
  - write to global crumbs file (user preference).
- [x] Remove Pi settings read/write usage for status table.
- [x] Verify behavior:
  - toggle persists across repos.
  - mode persists (`full`/`minimal`).
  - project override still possible via project crumbs if explicitly set.

## Phase 4 — Reader migration for existing crumbs consumers

- [x] Refactor `extensions/path-visibility/src/settings.ts` to shared crumbs loader.
- [x] Refactor `extensions/focus-advanced/src/settings.ts` to shared crumbs loader.
- [x] Refactor `extensions/quiet-validators/config.ts` to shared crumbs loader.
- [x] Remove duplicated local JSON parsing helpers where replaced by shared infra.
- [x] Verify nested cwd sessions still resolve project crumbs correctly.

## Phase 5 — Crumbs doctor command

- [x] Add new extension entrypoint `extensions/crumbs-doctor/index.ts` (or fold into existing utility extension if cleaner).
- [x] Register `/crumbs doctor` command.
- [x] Implement checks:
  - deprecated crumbs keys in Pi global settings (`~/.pi/agent/settings.json`).
  - deprecated crumbs keys in Pi project settings (`<projectRoot>/.pi/settings.json`).
  - malformed crumbs JSON (global/project).
  - conflicting types for known keys.
- [x] Implement output:
  - clear findings summary.
  - suggested cleanup commands/edits.
  - optional `--fix` path only for safe, reversible edits.

## Phase 5.5 — Startup config discovery visibility

- [x] On session startup/reload, render crumbs settings section only when at least one crumbs file exists.
- [x] Render section in same startup format style as Pi context/skills/extensions blocks.
- [x] Render section header exactly:
  - `[Crumbs settings]`
- [x] Render only discovered file paths as indented lines (no bullets, no labels):
  - `  ~/.pi/agent/crumbs.json` (when global exists)
  - `  .pi/crumbs.json` (when project exists)
- [x] Reuse crumbs-doctor check infrastructure for lightweight startup health signal.
- [x] If any doctor-detectable issues exist, render compact hint on same header line in warning/yellow:
  - `[Crumbs settings]  issues detected (run /crumbs doctor)`
  - do not print full issue details during startup
- [x] Do not render missing entries.
- [x] Do not render section at all when neither file exists.
- [x] Do not render reminders, explanations, or extra metadata beyond optional issues hint line.

Expected examples:

```text
[Crumbs settings]
  ~/.pi/agent/crumbs.json
  .pi/crumbs.json
```

```text
[Crumbs settings]  issues detected (run /crumbs doctor)
  ~/.pi/agent/crumbs.json
  .pi/crumbs.json
```

## Phase 6 — Cleanup + polish

- [ ] Remove dead helpers and stale comments referencing Pi settings as crumbs source.
- [ ] Refactor `extensions/codex-compat/index.ts` to remove `SettingsManager` dependency for crumbs fast setting reads/writes.
- [ ] Refactor `extensions/caveman/index.ts` to use crumbs config instead of Pi settings.
- [ ] Refactor session override persistence in:
  - [ ] `extensions/path-visibility/index.ts`
  - [ ] `extensions/focus-advanced/src/settings.ts`
- [ ] After codex-compat migration, verify status-table `fast` flag still reflects persisted value immediately after reload.
- [ ] Ensure extension headers/docs mention correct config ownership.
- [ ] Run repo checks:
  - [ ] `mise run check` (or project standard task)
  - [ ] typecheck/lint/format clean
- [ ] Smoke test commands:
  - [ ] `/focus`
  - [ ] `/caveman`
  - [ ] `/mcp`
  - [ ] status table toggle flow
  - [ ] `/crumbs doctor`

## Definition of done

- [ ] Crumbs-owned settings no longer read from Pi settings paths.
- [ ] Global crumbs defaults work across repositories.
- [ ] Project crumbs overrides apply deterministically.
- [ ] Status table persisted in crumbs config (not Pi settings).
- [ ] `/crumbs doctor` identifies deprecated/invalid settings locations and guides cleanup.
- [ ] Docs + schema reflect final behavior.
