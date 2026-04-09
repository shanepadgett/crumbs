# crumbs-pi-extensions

Personal Pi extensions packaged from user-level extensions.

## Prerequisites

Install these tools first:

- [Pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) installed on your system so the `pi` command is available

```bash
bun install -g @mariozechner/pi-coding-agent
// OR
npm install -g @mariozechner/pi-coding-agent
```

- [mise](https://mise.jdx.dev/) installed on your system

## First-time setup

Run these commands once when setting up the project for the first time:

```bash
mise trust
mise install
bun install
```

- `mise trust` lets mise use this project's config
- `mise install` installs the pinned project tools
- `bun install` installs the package dependencies

## Install extensions

```bash
pi install .
```

Use `-l` to install into project settings (`.pi/settings.json`) instead of global settings.

```bash
pi install -l .
```

## Remove extensions

```bash
pi remove .
```

```bash
pi remove -l .
```
