# Terminal Clear Extension

Clears terminal viewport and scrollback when Pi starts, then clears again on `/quit`.

It does not clear on `/reload`, `/resume`, `/new`, or `/fork`, so Pi hot reloads and session switches keep current TUI flow intact.

## Notes

- Runs only when stdout is a TTY.
- Uses ANSI clear sequences on modern terminals.
- Old Windows consoles get a best-effort visible clear, not guaranteed scrollback clearing.
- Process-level state prevents duplicate startup clears and duplicate exit hooks across `/reload`.

## Usage

Install/load extension, then reload Pi:

```text
/reload
```

The package manifest loads `terminal-clear.ts` directly through its `pi.extensions` field.
