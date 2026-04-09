# `/btw` Command in New Pane

Make `/btw` behave more like Claude Code's "by the way" flow: a lightweight side chat that branches off the current conversation without requiring a full new session. The point is to let the user ask a quick related question, explore a tangent, or sanity-check something without polluting the main thread.

This side chat should start with a compact summary of the current conversation, or some other distilled context payload, so it has enough awareness to be useful without inheriting the full weight of the active session. That keeps it fast and disposable while still making it feel connected to the main task.

Opening it in a separate pane still makes sense, but the core idea is not just "show command output elsewhere." It is a temporary parallel conversation surface that is easy to open, easy to dismiss, and easy to return from after the tangent is resolved.
