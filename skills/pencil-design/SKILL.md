---
name: pencil-design
description: Design UIs in Pencil (.pen files) and generate production code from them. Use when working with .pen files, designing screens or components in Pencil, or generating code from Pencil designs. Triggers on tasks involving Pencil, .pen files, design-to-code workflows, or UI design with the Pencil MCP tools.
---

# Pencil Design Skill

Design production-quality UIs in Pencil, generate clean code from them. Enforces design system reuse, variable usage, layout correctness, visual verification, design-to-code workflows.

## When to Use

- Designing screens/pages/components in `.pen` files
- Generating code from Pencil designs
- Building/extending design systems in Pencil
- Working with any Pencil MCP tools

## Critical Rules

### Rule 1: Reuse Design System Components

**NEVER recreate a component from scratch when one exists.**

Before inserting any element:

1. `pencil_batch_get` with `patterns: [{ reusable: true }]` — list all reusable components
2. Search results for matching component (button, card, input, nav, etc.)
3. Match found -> insert as `ref`: `I(parent, { type: "ref", ref: "<componentId>" })`
4. Customize instance via `U(instanceId + "/childId", { ... })`
5. Only create from scratch if no suitable component exists

See [references/design-system-components.md](references/design-system-components.md).

### Rule 2: Use Variables, Not Hardcoded Values

**NEVER hardcode colors, radius, spacing, typography when variables exist.**

1. `pencil_get_variables` — read all design tokens
2. Map values to variables (e.g., `primary` not `#3b82f6`, `radius-md` not `6`)
3. Apply variable references, not raw values

See [references/variables-and-tokens.md](references/variables-and-tokens.md).

### Rule 3: Prevent Overflow

**NEVER allow text/children to overflow parent or artboard.**

1. Set text wrapping/truncation appropriately
2. Constrain widths to parent bounds (mobile: 375px)
3. Use `"fill_container"` for text width inside auto-layout frames
4. After inserting: `pencil_snapshot_layout` with `problemsOnly: true` to detect clipping
5. Fix issues before proceeding

See [references/layout-and-text-overflow.md](references/layout-and-text-overflow.md).

### Rule 4: Visually Verify Every Section

**NEVER skip visual verification after building a section.**

After each logical section (header, hero, sidebar, form, etc.):

1. `pencil_get_screenshot` on section/screen node
2. Analyze: alignment, spacing, overflow, glitches, missing content
3. `pencil_snapshot_layout` with `problemsOnly: true` for clipping/overlap
4. Fix issues before next section
5. Final full-screen screenshot when complete

See [references/visual-verification.md](references/visual-verification.md).

### Rule 5: Reuse Existing Assets

**NEVER generate new logo/asset when one exists in the document.**

1. `pencil_batch_get` — search by name pattern (`logo|brand|icon`)
2. Match found elsewhere -> copy with `C()` operation
3. Only `G()` for genuinely new images not in document
4. Logos: ALWAYS copy, never regenerate

See [references/asset-reuse.md](references/asset-reuse.md).

### Rule 6: Load `frontend-design` Skill

**NEVER design or generate code without loading `frontend-design` first.**

1. Load at start of any Pencil design or code gen task
2. Follow its design thinking: purpose, bold aesthetic, differentiation
3. Apply guidelines on typography, color, motion, spatial composition
4. Never produce generic AI aesthetics

Applies to both Pencil design tasks and code generation from Pencil.

## Design Workflow

### Starting New Design

```text
0. Load `frontend-design` skill
1. pencil_get_editor_state        -> file state, schema
2. pencil_batch_get (reusable)    -> design system components
3. pencil_get_variables           -> design tokens
4. pencil_get_guidelines          -> design rules
5. pencil_get_style_guide_tags    -> (optional) style inspiration
6. pencil_get_style_guide         -> (optional) style direction
7. pencil_find_empty_space_on_canvas -> space for new screen
8. pencil_batch_design            -> build (section by section)
9. pencil_get_screenshot          -> verify each section
10. pencil_snapshot_layout        -> check layout problems
```

### Section-by-Section

1. **Plan** — identify reusable components
2. **Build** — insert as `ref` instances, apply variables
3. **Verify** — screenshot + layout check
4. **Fix** — address overflow/alignment/spacing
5. **Proceed** — only after verification passes

### Design-to-Code

See [references/design-to-code-workflow.md](references/design-to-code-workflow.md), [references/responsive-breakpoints.md](references/responsive-breakpoints.md).

Summary:

1. Load `frontend-design` skill
2. `pencil_get_guidelines` with `"code"`
3. `pencil_get_variables` -> read design tokens
4. `pencil_batch_get` -> read design tree
5. Map reusable components to appropriate UI library components
6. Apply `frontend-design` guidelines
7. Use Lucide for icons

## MCP Tool Reference

| Tool                                     | Use                                                            |
| ---------------------------------------- | -------------------------------------------------------------- |
| `pencil_get_editor_state`                | First call — file state, schema                                |
| `pencil_batch_get`                       | Read nodes, search components (`reusable: true`)               |
| `pencil_batch_design`                    | Insert/copy/update/replace/move/delete/image ops               |
| `pencil_get_variables`                   | Read design tokens                                             |
| `pencil_set_variables`                   | Create/update design tokens                                    |
| `pencil_get_screenshot`                  | Visual verification                                            |
| `pencil_snapshot_layout`                 | Detect clipping, overflow, overlap                             |
| `pencil_get_guidelines`                  | Design rules: `code`, `table`, `landing-page`, `design-system` |
| `pencil_find_empty_space_on_canvas`      | Find space for new screens                                     |
| `pencil_get_style_guide_tags`            | Browse style directions                                        |
| `pencil_get_style_guide`                 | Get style inspiration                                          |
| `pencil_search_all_unique_properties`    | Audit property values                                          |
| `pencil_replace_all_matching_properties` | Bulk update properties                                         |
| `pencil_open_document`                   | Open .pen file or create new                                   |

## Common Mistakes

| Mistake                        | Correct                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| Creating button from scratch   | Search for existing, insert as `ref`                             |
| `fill: "#3b82f6"`              | Reference `primary` variable                                     |
| `cornerRadius: 8`              | Reference `radius-md` variable                                   |
| Not checking overflow          | `pencil_snapshot_layout(problemsOnly: true)` after every section |
| Skipping screenshots           | `pencil_get_screenshot` after every section                      |
| Generating new logo            | Copy existing with `C()`                                         |
| Build entire screen then check | Build and verify section by section                              |
| Material Icons in code         | Map to Lucide icons                                              |
| Skipping `frontend-design`     | Always load before design or code gen                            |
| Generic AI aesthetics          | Follow `frontend-design` guidelines                              |

## Resources

- [Pencil Docs](https://docs.pencil.dev)
- [Pencil Prompt Gallery](https://www.pencil.dev/prompts)
- [Design as Code](https://docs.pencil.dev/core-concepts/design-as-code)
- [Variables](https://docs.pencil.dev/core-concepts/variables)
- [Components](https://docs.pencil.dev/core-concepts/components)
- [Design to Code](https://docs.pencil.dev/design-and-code/design-to-code)
- [Styles and UI Kits](https://docs.pencil.dev/design-and-code/styles-and-ui-kits)
