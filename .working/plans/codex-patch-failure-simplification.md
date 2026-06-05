# Codex patch failure simplification

Goal: remove saved retry patch files and replace that complexity with stronger read-before-patch guidance.

## Remove

- `extensions/codex-compat/src/patch-attempt-store.ts`
- `@.pi/local/apply-patch-attempts/...` input references.
- Failed patch auto-save.
- Cleanup of saved retry patch files after success.
- Prompt lines telling agent to inspect/retry saved `.failed.patch` files.
- Tool parameter text mentioning saved retry patch references.

## Change guidance

- Update Codex compatibility system prompt to say:
  - read relevant file sections before `Update File`, `Replace File`, or `Delete File` patches.
  - use `read` with line ranges near intended edits before context-sensitive patches.
  - if `apply_patch` fails on context mismatch, read current target section before retrying.

## Keep

- `apply_patch` tool itself.
- Raw patch and explicit apply_patch invocation parsing.
- Existing failure summaries from patch executor.

## Known code targets

- `extensions/codex-compat/src/apply-patch.ts`
- `extensions/codex-compat/src/patch-attempt-store.ts`
- `extensions/codex-compat/src/patch-executor.ts`
- Codex compat tests.

## Validation

- Existing codex compat tests pass.
- Failed patch result no longer writes `.pi/local/apply-patch-attempts`.
- Tool schema and prompt no longer mention retry patch files.
- Prompt tells agent to read relevant file sections before patching.
