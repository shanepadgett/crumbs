# Auto Guardian

Gates Pi tool execution before tools run.

- Read-only and web tools run without prompts.
- Dangerous bash patterns, protected paths, and outside-workspace writes are blocked.
- Risky-but-overridable actions prompt with `ctx.ui.select`.
- Optional LLM guardian review is off by default and falls back to user prompt on deny/error.

Configure under `extensions.autoGuardian` in crumbs config. Array fields replace defaults, so re-include built-in patterns you still want.

Main fields:

- `mode`: `gate` or `off`.
- `ignoreTools`: always-allowed tools. Defaults include `read`, `grep`, `find`, `ls`, `websearch`, `webfetch`, `codesearch`, and `view_image`.
- `bash`: `denyPatterns`, `promptPatterns`, `allowPatterns`, and `defaultAction`.
- `mutation`: protected path globs, outside-workspace policy, size prompt threshold.
- `unknownToolAction`: `allow`, `prompt`, or `block`.
- `guardian`: optional LLM review, disabled by default.

```json
{
  "extensions": {
    "autoGuardian": {
      "bash": { "defaultAction": "prompt", "allowPatterns": ["^git status$"] },
      "mutation": { "protectedPaths": [".git", ".git/**", "*.env"] }
    }
  }
}
```

Changes under `extensions.autoGuardian` need `/reload` before they take effect.
