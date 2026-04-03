# tmux pane-based subagent orchestration (test notes)

This documents the simple tmux + `pi` orchestration test we ran.

## What worked

- We can treat a tmux pane as a lightweight “subagent worker”.
- Flow:
  1. target the currently visible active pane in an attached session
  2. split to create a worker pane
  3. run `pi -p --no-session "..."` in that worker pane
  4. poll pane output with `tmux capture-pane`
  5. detect a completion marker line
  6. collect output
  7. close worker pane when done

## Important findings

- **Targeting matters**
  - Creating/splitting in a detached test session works technically, but you won’t see it in your visible layout.
  - Use the active pane from an attached session.

- **Split direction gotcha**
  - `tmux split-window -v` => top/bottom panes
  - `tmux split-window -h` => left/right panes (vertical divider)

- **Completion detection**
  - Match an exact completion line (not a loose substring), because the command line itself may contain the marker text.
  - Example marker: `SUBAGENT_DONE: split-h and auto-close test`

- **Cleanup behavior**
  - On success: `tmux kill-pane -t <pane_id>` to return layout to normal.
  - On timeout/error: keep pane open for debugging unless explicitly asked to kill.

## Minimal command pattern

```bash
# 1) find active visible pane
active_target=$(tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{window_active} #{pane_active}' \
  | awk '$2==1 && $3==1 {print $1; exit}')

# 2) split left/right (vertical divider)
new_pane=$(tmux split-window -h -t "$active_target" -P -F '#{pane_id}')

# 3) run subagent with explicit done marker
tmux send-keys -t "$new_pane" \
  'pi -p --no-session "Return exactly this line and nothing else: SUBAGENT_DONE: test"' C-m

# 4) poll until exact output line appears
for i in $(seq 1 30); do
  sleep 2
  pane_text=$(tmux capture-pane -p -t "$new_pane" -S -200)
  if printf '%s\n' "$pane_text" | grep -q '^SUBAGENT_DONE: test$'; then
    tmux kill-pane -t "$new_pane"   # 5) cleanup on success
    break
  fi
done
```

## Suggested default policy

- Poll every 2 seconds, max ~60 seconds (or configurable).
- Require explicit completion marker from subagent.
- Auto-close pane on success.
- Leave pane open on timeout/failure for inspection.
