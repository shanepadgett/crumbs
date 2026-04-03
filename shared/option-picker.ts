/**
 * Shared Option Picker
 *
 * What it does: renders a TUI option picker with optional per-option notes.
 * How to use it: call `showOptionPicker()` with a title and options, then read
 * `result.action` and `result.notes`.
 * Example:
 * ```ts
 * const result = await showOptionPicker(ctx, {
 *   title: "Choose an action",
 *   options: [
 *     { id: "allow", label: "Allow once" },
 *     { id: "deny", label: "Deny" },
 *   ],
 *   cancelAction: "deny",
 * });
 *
 * const selectedNote = result ? result.notes[result.action] : undefined;
 * ```
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

type OptionPickerTone = "accent" | "text" | "muted" | "dim";

interface OptionNoteConfig {
  initialValue?: string;
  maxLength?: number;
}

interface OptionState<TAction extends string> {
  id: TAction;
  label: string;
  noteEnabled: boolean;
  noteMaxLength: number;
  noteValue: string;
  noteOpen: boolean;
}

export type OptionPickerLine =
  | string
  | {
      text: string;
      tone?: OptionPickerTone;
      indent?: number;
    };

export interface OptionPickerOption<TAction extends string> {
  id: TAction;
  label: string;
  note?: false | OptionNoteConfig;
}

export interface OptionPickerConfig<TAction extends string> {
  title: string;
  lines?: ReadonlyArray<OptionPickerLine>;
  options: ReadonlyArray<OptionPickerOption<TAction>>;
  cancelAction?: TAction;
}

export interface OptionPickerResult<TAction extends string> {
  action: TAction;
  notes: Partial<Record<TAction, string>>;
}

const NOTE_KEY = "n";
const DEFAULT_NOTE_MAX_LENGTH = 300;
const NOTE_PLACEHOLDER = "Type to add a note.";

function removeLastCharacter(input: string): string {
  const chars = [...input];
  chars.pop();
  return chars.join("");
}

function isPrintableInput(data: string): boolean {
  if (!data) return false;
  if (data.startsWith("\u001b")) return false;

  for (const char of data) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }

  return true;
}

function normalizeOption<TAction extends string>(
  option: OptionPickerOption<TAction>,
): OptionState<TAction> {
  const noteConfig = option.note === false ? undefined : option.note;
  const noteEnabled = option.note !== false;
  const noteMaxLength = noteConfig?.maxLength ?? DEFAULT_NOTE_MAX_LENGTH;
  const initialValue = noteConfig?.initialValue ?? "";

  return {
    id: option.id,
    label: option.label,
    noteEnabled,
    noteMaxLength,
    noteValue: initialValue.slice(0, noteMaxLength),
    noteOpen: false,
  };
}

function buildNotes<TAction extends string>(
  options: ReadonlyArray<OptionState<TAction>>,
): Partial<Record<TAction, string>> {
  const notes: Partial<Record<TAction, string>> = {};

  for (const option of options) {
    if (option.noteValue.length === 0) continue;
    notes[option.id] = option.noteValue;
  }

  return notes;
}

function styleLine(theme: any, line: OptionPickerLine): string {
  if (typeof line === "string") {
    return theme.fg("text", line);
  }

  const indent = " ".repeat(Math.max(0, line.indent ?? 0));
  return theme.fg(line.tone ?? "text", `${indent}${line.text}`);
}

function isNoteToggleInput(data: string): boolean {
  return data.length === 1 && data.toLowerCase() === NOTE_KEY;
}

export async function showOptionPicker<TAction extends string>(
  ctx: ExtensionContext,
  config: OptionPickerConfig<TAction>,
): Promise<OptionPickerResult<TAction> | null> {
  const options = config.options.map(normalizeOption);

  if (options.length === 0) {
    return null;
  }

  const cancelAction =
    config.cancelAction !== undefined && options.some((option) => option.id === config.cancelAction)
      ? config.cancelAction
      : undefined;

  try {
    return await ctx.ui.custom<OptionPickerResult<TAction> | null>((tui, theme, _kb, done) => {
      let selectedIndex = 0;

      function currentOption(): OptionState<TAction> {
        return options[selectedIndex]!;
      }

      function moveSelection(delta: number): void {
        selectedIndex = (selectedIndex + delta + options.length) % options.length;
        tui.requestRender();
      }

      function submit(action: TAction): void {
        done({
          action,
          notes: buildNotes(options),
        });
      }

      function cancel(): void {
        if (cancelAction !== undefined) {
          submit(cancelAction);
          return;
        }

        done(null);
      }

      function openNote(option: OptionState<TAction>): void {
        if (!option.noteEnabled || option.noteOpen) return;
        option.noteOpen = true;
        tui.requestRender();
      }

      function clearOrCloseOrCancel(option: OptionState<TAction>): void {
        if (option.noteEnabled && option.noteOpen) {
          if (option.noteValue.length > 0) {
            option.noteValue = "";
          } else {
            option.noteOpen = false;
          }
          tui.requestRender();
          return;
        }

        cancel();
      }

      function closeNoteOrCancel(option: OptionState<TAction>): void {
        if (option.noteEnabled && option.noteOpen) {
          option.noteOpen = false;
          tui.requestRender();
          return;
        }

        cancel();
      }

      return {
        handleInput(data: string) {
          if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
            moveSelection(-1);
            return;
          }

          if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
            moveSelection(1);
            return;
          }

          if (matchesKey(data, Key.enter)) {
            submit(currentOption().id);
            return;
          }

          const option = currentOption();

          if (isNoteToggleInput(data) && option.noteEnabled && !option.noteOpen) {
            openNote(option);
            return;
          }

          if (matchesKey(data, Key.ctrl("c"))) {
            clearOrCloseOrCancel(option);
            return;
          }

          if (matchesKey(data, Key.escape)) {
            closeNoteOrCancel(option);
            return;
          }

          if (!option.noteEnabled || !option.noteOpen) return;

          if (matchesKey(data, Key.backspace) || data === "\x7f") {
            option.noteValue = removeLastCharacter(option.noteValue);
            tui.requestRender();
            return;
          }

          if (!isPrintableInput(data)) return;

          option.noteValue = `${option.noteValue}${data}`.slice(0, option.noteMaxLength);
          tui.requestRender();
        },
        render(width: number) {
          const lines: string[] = [];

          lines.push(truncateToWidth(theme.fg("accent", config.title), width));

          const detailLines = config.lines ?? [];
          if (detailLines.length > 0) {
            lines.push("");
            for (const line of detailLines) {
              lines.push(truncateToWidth(styleLine(theme, line), width));
            }
          }

          lines.push("");
          for (let i = 0; i < options.length; i++) {
            const option = options[i]!;
            const selected = i === selectedIndex;
            const prefix = selected ? theme.fg("accent", "❯") : " ";
            const label = selected
              ? theme.fg("accent", option.label)
              : theme.fg("text", option.label);
            lines.push(truncateToWidth(`${prefix} ${label}`, width));

            if (!option.noteEnabled || !option.noteOpen) continue;

            const noteText = option.noteValue.length > 0 ? option.noteValue : NOTE_PLACEHOLDER;
            lines.push(truncateToWidth(theme.fg("muted", `  └ ${noteText}`), width));
          }

          lines.push("");
          lines.push(
            truncateToWidth(
              theme.fg(
                "dim",
                `↑↓/Tab navigate • Enter select • ${NOTE_KEY} note • Ctrl+c clear/close • Esc cancel`,
              ),
              width,
            ),
          );

          return lines;
        },
        invalidate() {},
      };
    });
  } catch {
    return null;
  }
}
