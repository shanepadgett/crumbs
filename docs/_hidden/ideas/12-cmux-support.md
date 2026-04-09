# `cmux` Support

Add first-class compatibility for `cmux` environments so terminal behavior stays predictable when Pi is running inside a multiplexer that is not tmux. Right now the notify extension already avoids some `cmux` cases, which suggests there are real edge cases around pane detection, escape sequences, and session-aware UI.

This should probably start as a capability audit rather than an implementation guess. We need to know which features break under `cmux`: notifications, pane spawning, focus handling, resize behavior, or assumptions in the session model.

If the differences are small, support may just mean normalizing environment detection and disabling a few features when unsafe. If the differences are larger, `cmux` may need its own adapter layer similar to how terminal-specific notification paths are already handled.
