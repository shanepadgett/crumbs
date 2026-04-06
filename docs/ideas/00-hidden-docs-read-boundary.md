# Hidden Docs Read Boundary

Treat `docs/_hidden` as a real protected area instead of a naming convention that polite code happens to ignore. If a plain shell read like `sed` can still access files there during normal agent work, then the current setup is not enforcing a boundary and users can get a false sense of isolation.

The product question is whether this protection belongs in prompt policy, tool wrappers, path allowlists, or a stronger sandbox around file access. A good solution should make the restriction explicit and enforceable across all read paths, not just best-effort behavior in one extension.

This also needs a clear failure mode. If access is denied, Pi should say the path is protected and explain how hidden planning docs are meant to be used, rather than silently leaking content through generic shell or file tools.
