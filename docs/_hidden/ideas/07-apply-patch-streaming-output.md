# Streaming Line Output for `apply_patch`

Show patch progress as `apply_patch` runs so the user can see which files and hunks are being written in real time. Even a minimal stream like "update file", "add file", and changed line ranges would make edits feel less opaque than today's all-at-once result.

The goal is not to print the whole patch back to the screen every time, but to expose enough detail to build trust and help with debugging when a patch is larger than expected. A compact live view could show file-by-file progress, while an expanded mode could reveal actual added and removed lines for users who want more visibility.

This probably belongs in the Codex compatibility UI layer because that is already responsible for tool rendering. If done well, the same rendering model could also improve long-running shell tools by giving all mutating tools a consistent sense of progress.
