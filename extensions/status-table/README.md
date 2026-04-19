# Status Table Extension

Attached status table for Pi that renders below editor and replaces built-in footer.

It shows:

- git cleanliness summary
- current branch
- current path
- model provider
- model id
- thinking level
- Codex fast mode
- caveman on/off state and active powers
- context usage as `used / total`

## Notes

- The built-in footer is hidden and replaced by this extension's attached status table.
- The table refreshes on session start, model changes, turn updates, and a short background poll.
- Status table preferences read/write `extensions.statusTable` in crumbs config.
- Global defaults: `~/.pi/agent/crumbs.json`
- Project override: `<projectRoot>/.pi/crumbs.json`

## Usage

Install/load the extension, then reload Pi:

```text
/reload
```

If you change files under `extensions/status-table/`, reload Pi before testing.

## Commands

- `/status-table` toggles widget on/off.
- `/status-table config` opens multi-select config for visible blocks.

## Config

```json
{
  "extensions": {
    "statusTable": {
      "enabled": true,
      "visibleBlocks": [
        "path",
        "git",
        "provider",
        "model",
        "thinking",
        "focus",
        "fast",
        "caveman",
        "context",
        "tokens"
      ]
    }
  }
}
```
