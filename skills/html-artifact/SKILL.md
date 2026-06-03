---
name: html-artifact
description: Create standalone HTML artifacts for plans, prototypes, explainers, code reviews, reports, and custom editing interfaces. Use when the user asks for an HTML file/artifact, visual plan/spec, interactive prototype, explainer page, PR/code review artifact, report, or throwaway editor.
---

# HTML Artifact

Create one self-contained HTML file for rich visual communication. Default output path is `.working/artifacts/<kebab-slug>.html`.

## Workflow

1. If artifact claims repo behavior, inspect relevant source/data first. Do not invent facts.
1. Pick concise kebab-case slug from user intent.
1. If target file exists, ask before overwrite unless user explicitly asks to update it.
1. Copy `assets/template.html` to target path, then edit copied file.
1. Keep artifact single-file unless user explicitly asks otherwise.
1. Read the single most relevant reference below before editing. Read another only when artifact explicitly combines modes. Do not browse references for inspiration; unused references waste context and attention.
1. Use existing semantic classes first. Add artifact-specific CSS only below template marker.
1. Preserve design tokens. Do not change token values unless explicitly asked.
1. Final response: path plus one-line summary. Do not paste full HTML in chat.

## Reference routing

| Intent                                                                       | Read                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| plans, options, implementation sequencing, exploration                       | `references/planning-exploration.md`      |
| PR review, code walkthrough, diff explanation, code understanding            | `references/code-review-understanding.md` |
| visual design, UI prototype, interaction tuning, design system artifacts     | `references/design-prototype.md`          |
| research, report, concept explainer, incident/status, architecture overview  | `references/report-explainer.md`          |
| throwaway editor, prioritizer, config editor, prompt tuner, data curation UI | `references/custom-editor.md`             |

## Template conventions

- Template includes Arc Lite tokens, semantic CSS primitives, Google Fonts, theme toggle, and copy helper.
- Theme toggle follows saved choice, then system preference. Agents do not need to add theme logic.
- Copy helper uses `data-copy-target="#selector"` on buttons to copy target text.
- Prefer native HTML elements when useful: `details`, `summary`, `dialog`, `table`, `form`, `svg`.
- Keep screens compact, app-like, readable, and organized. Avoid decorative gradients, glass effects, glow, and oversized marketing layouts.
