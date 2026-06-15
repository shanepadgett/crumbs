# Status line

Crumbs footer replacement for Pi.

## User surface

- `/status-line` toggles the custom footer on or off.
- Config key: `extensions.statusLine.enabled`.

## How it works

The extension replaces Pi's built-in footer with a fixed two-line layout:

- top left: git branch and active model
- top right: token, cache, cost, and context stats
- bottom left: current working directory and optional session name
- bottom right: caveman name and powers

Run `/reload` after changing files under `extensions/status-line/`.
