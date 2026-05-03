# Caveman Extension

Terse caveman prompt layer for Pi.

What it does:

- replaces Pi system prompt when caveman enabled
- keeps responses short, direct, no-fluff
- adds optional powers for extra domain guidance
- injects optional configured context file contents into the system prompt
- supports project-scoped and session-scoped power selection

## Powers

- `improve` — stronger Pi self-improvement guidance
- `design` — stronger UX, product, interface, Pencil guidance
- `architecture` — stronger ownership, abstraction, boundary judgment
- `swiftui` — modern Swift and SwiftUI patterns
- `typescript` — stronger TypeScript boundary and type-shape judgment

## Commands

- `/caveman on` — enable caveman mode
- `/caveman off` — disable caveman mode
- `/caveman powers` — choose `Project powers` or `Session powers`, then edit that scope
- `/caveman minimal` — save empty session powers override for current session

## Power scopes

`Project powers`

- save to `<projectRoot>/.pi/crumbs.json`
- apply for repo by default

`Session powers`

- save in session history, not crumbs file
- start blank first time
- restore previous session selection on later opens
- override project and global powers for current session
- follow current branch on resume, fork, and tree navigation
- `/caveman minimal` writes this scope as empty, so project/global powers stay off for current session

## Precedence

When caveman is enabled, powers resolve like this:

1. session powers, if session override exists
2. project powers from `<projectRoot>/.pi/crumbs.json`
3. global powers from `~/.pi/agent/crumbs.json`
4. no powers

Important:

- empty saved session powers means `no powers` and still overrides project/global
- empty project `powers: []` overrides global powers for that project

## Config

Project or global crumbs config:

```json
{
  "extensions": {
    "caveman": {
      "enabled": true,
      "powers": ["architecture", "typescript"],
      "additionalContext": {
        "all": ["AGENTS.md", "docs/repo-rules.md"],
        "powers": {
          "architecture": ["docs/architecture-rules.md"],
          "typescript": ["docs/typescript-rules.md"]
        }
      }
    }
  }
}
```

`additionalContext` injects file contents directly into Caveman system prompt.

- `all` files apply whenever Caveman is enabled
- `powers.<power>` files apply only when that power is active
- relative paths resolve from project root
- `~` and absolute paths are supported
- unavailable files are skipped with a warning
- large files/context are truncated to protect prompt size

Injected context is wrapped with lightweight tags:

```text
<context source="docs/architecture-rules.md">
...file contents...
</context>
```

## Notes

- Caveman replaces Pi base system prompt instead of appending to it.
- Repo `AGENTS.md` content is not included in caveman prompt unless configured through `additionalContext` or caveman prompt adds equivalent guidance itself.
- Reload Pi after changing extension files under `extensions/caveman/`.
