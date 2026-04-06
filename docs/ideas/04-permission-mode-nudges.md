# Permission-mode Nudges

Make permission failures more proactive by warning the user before a write or edit attempt is blocked. Instead of waiting for a tool call to fail, Pi could notice the current mode, detect likely intent to mutate files, and nudge the user toward switching to a better mode first.

This should feel like a helpful correction, not a noisy interruption. Good nudges would appear only when the user's next step is obvious, such as asking for a file edit while still in a read-only or research-oriented mode.

The existing permissions extension already has the data needed to support this. The open question is mostly UX: should the nudge be inline, modal, status-based, or an actionable prompt that can switch modes immediately with one confirmation.
