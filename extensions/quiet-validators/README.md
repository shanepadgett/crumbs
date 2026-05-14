# Quiet Validators Extension

Runs configured mise tasks quietly after relevant file changes.

## User-facing surface

- Background `mise run <task>` validation for configured file scopes.
- System prompt guidance tells agents not to run duplicate manual validations unless requested.

## Configuration

Legacy single-task config remains supported:

```json
{
  "extensions": {
    "quietMiseTask": {
      "task": "check",
      "trackedExtensions": [".swift"],
      "excludeGlobs": ["Generated/**"]
    }
  }
}
```

Multiple task configs use `configs`. When present, `configs` wins over legacy fields:

```json
{
  "extensions": {
    "quietMiseTask": {
      "configs": [
        {
          "name": "swift",
          "task": "check:swift",
          "trackedExtensions": [".swift"]
        },
        {
          "task": "check:web",
          "trackedExtensions": [".ts", ".tsx"],
          "excludeGlobs": ["dist/**"]
        }
      ]
    }
  }
}
```

`name` is optional and only affects display labels.

## How it works

Each mise config gets its own file snapshot and dirty state. The extension runs only tasks whose tracked files changed, reports failures as steer messages, and stays silent when unsupported or unchanged.
