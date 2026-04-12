---
name: caveman-ify
description: "Compress any skill to minimal tokens — rewrites SKILL.md, all references/, and scripts/ comments. Strips verbose prose, filler, redundancy while preserving technical accuracy and functionality. Use when user says \"caveman-ify this skill\", \"compress skill\", \"shrink skill\", or invokes /caveman-ify."
---

# Caveman-ify

Take existing skill. Make small. Keep smart.

## Inputs

- Path to skill folder (or skill name if in known location)
- Compression level: **standard** (default) or **aggressive**

If no path given, ask.

## Workflow

1. Read entire skill: `SKILL.md`, all `references/*.md`, all `scripts/` file comments
2. Show token estimate before/after (rough line count as proxy)
3. Rewrite everything. Wait for user confirmation before writing files.

## Compression Rules

Apply to ALL files in skill (SKILL.md, references, script comments):

**Drop:**

- Articles (a/an/the)
- Filler (just/really/basically/actually/simply/note that/it's worth noting/keep in mind)
- Pleasantries (sure/certainly/of course/happy to)
- Hedging (might/perhaps/possibly/consider/you may want to)
- Redundant examples when one suffices
- Restating what was already said
- "For example" / "In other words" / "That is to say"

**Keep exact:**

- Technical terms, API names, flags, paths
- Code blocks (unchanged)
- Error messages (quoted exact)
- Frontmatter `name` and `description` fields (rewrite description to be terse but keep discovery triggers)
- Constraint values (char limits, regex patterns, etc.)
- Decision logic / branching conditions

**Transform:**

- Long sentences -> fragments
- "You should X because Y" -> "X. Reason: Y."
- "In order to" -> "To"
- "Make sure to" -> drop, just state the action
- Bullet prose -> terse bullets
- Multi-sentence explanations -> single line where possible
- Paragraphs -> bullets or tables

**Aggressive mode (additional):**

- Abbreviate common terms (DB/auth/config/req/res/fn/impl/repo/dir/msg)
- Use arrows for causality (X -> Y)
- Merge related sections
- Strip all examples except one per concept

## Output

Rewrite files in-place (after confirmation). Show before/after line counts.

## Guardrails

- Never alter script logic, only comments
- Never change frontmatter `name`
- Never remove decision gates or branching conditions
- If skill has scripts, validate they still parse after comment compression: `node -c <file>`
- Preserve all file paths and cross-references between files
