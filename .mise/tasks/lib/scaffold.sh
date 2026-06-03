#!/usr/bin/env bash
set -euo pipefail

run_step() {
  local label="$1"
  shift
  echo "==> $label"
  "$@"
}

run_filtered() {
  local label="$1"
  local failure_label="$2"
  shift 2

  local show_warnings="${SHOW_WARNINGS:-1}"
  local raw_file
  local filtered_file
  raw_file="$(mktemp)"
  filtered_file="$(mktemp)"

  echo "==> $label"
  if "$@" >"$raw_file" 2>&1; then
    cmd_status=0
  else
    cmd_status=$?
  fi

  awk 'NF > 0' "$raw_file" \
    | awk '!seen[$0]++' \
    | awk '
        /Found [0-9]+ warning/ { next }
        /Found [0-9]+ error/ { next }
        /Finished in [0-9.]+/ { next }
        /:[0-9]+:[0-9]+: .*\b(error|warning)\b/ { print; next }
        /\([0-9]+,[0-9]+\): error TS[0-9]+:/ { print; next }
        /^error[: ]/ { print; next }
        /^warning[: ]/ { print; next }
        tolower($0) ~ /failed/ { print; next }
        tolower($0) ~ /not formatted/ { print; next }
      ' >"$filtered_file"

  if [[ "$show_warnings" == "0" ]]; then
    awk 'tolower($0) !~ /warning/' "$filtered_file" >"$filtered_file.tmp"
    mv "$filtered_file.tmp" "$filtered_file"
  fi

  if [[ -s "$filtered_file" ]]; then
    cat "$filtered_file"
    rm -f "$raw_file" "$filtered_file"
    exit 1
  fi

  if [[ $cmd_status -ne 0 ]]; then
    echo "$failure_label"
    awk 'NF > 0' "$raw_file" | awk '!seen[$0]++'
    rm -f "$raw_file" "$filtered_file"
    exit "$cmd_status"
  fi

  rm -f "$raw_file" "$filtered_file"
}
