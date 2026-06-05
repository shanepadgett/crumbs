# Guardian

Gates Pi tool execution before tools run.

- Read-only and web tools run without prompts.
- Dangerous bash patterns, protected paths, and outside-workspace writes are blocked.
- Risky-but-overridable actions prompt with `ctx.ui.select`.
- Auto approval is on by default and falls back to user prompt on deny/error.

Configure under `extensions.guardian` in crumbs config. Array fields replace defaults.

Main fields:

- `mode`: `gate` or `off`.
- `ignoreTools`: always-allowed tools. Defaults include `read`, `grep`, `find`, `ls`, `websearch`, `webfetch`, `codesearch`, and `view_image`.
- `bash`: ordered glob `rules` plus `defaultAction`.
- `mutation`: ordered path `rules`, outside-workspace policy, size prompt threshold, plus `defaultAction`.
- `unknownToolAction`: `allow`, `prompt`, `autoApprove`, or `block`.
- `autoApprove`: model review settings. Enabled by default.

Actions are `allow`, `prompt`, `autoApprove`, or `block`. First matching rule wins.

```json
{
  "extensions": {
    "guardian": {
      "bash": {
        "rules": [{ "match": "git status", "action": "allow" }]
      },
      "mutation": {
        "rules": [{ "paths": ["README.md"], "action": "prompt" }]
      }
    }
  }
}
```

Changes under `extensions.guardian` need `/reload` before they take effect.
