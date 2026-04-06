# Dynamic Path Locking

- Add dynamic path locking so agents can read only the active workspace plus approved shared paths.
- In monorepos, block unrelated workspaces by default to keep sessions focused.
- Allow explicit cross-workspace exceptions when scoped analysis surfaces a real dependency.
- Success: agents stay inside the intended working set unless the user or system expands access.
