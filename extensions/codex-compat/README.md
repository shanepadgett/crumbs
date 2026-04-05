# Codex Compat Extension

Codex compatibility mode for Pi.

It does three things:

- switches Pi to Codex-style tools on supported Codex-family models (`exec_command`, `write_stdin`, `apply_patch`, and `view_image` when supported)
- keeps custom repo tools active (for example `webresearch` and `memory_recall`) instead of replacing them with native Codex web search
- restores the prior non-compat tool set when you switch away from a supported model

## How to use it

Install/enable the extension, then select a supported Codex-family model.

Compatibility mode activates automatically on model select/session start and updates the agent prompt with Codex-tool usage guidance.

## Example

- Select `openai/gpt-5.3-codex`.
- Ask Pi to inspect code (`exec_command`) and apply edits (`apply_patch`).
- Ask for external research and Pi still uses `webresearch`.
