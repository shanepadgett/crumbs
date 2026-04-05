/**
 * Shared Option Picker
 *
 * What it does: renders a TUI option picker with optional per-option notes
 * and an optional review-mark toggle.
 * How to use it: call `showOptionPicker()` with a title and options, then read
 * `result.action`, `result.notes`, and optionally `result.reviewMarked`.
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

import { rawKeyHint, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, parseKey, truncateToWidth } from "@mariozechner/pi-tui";

type OptionPickerTone = "accent" | "text" | "muted" | "dim";

interface OptionNoteConfig {
  initialValue?: string;
  maxLength?: number;
}

interface OptionPickerReviewToggleConfig {
  key?: string;
  label?: string;
  initialValue?: boolean;
}

interface OptionState<TAction extends string> {
  id: TAction;
  label: string;
  noteEnabled: boolean;
  noteMaxLength: number;
  noteValue: string;
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
  reviewToggle?: OptionPickerReviewToggleConfig;
}

export interface OptionPickerResult<TAction extends string> {
  action: TAction;
  notes: Partial<Record<TAction, string>>;
  reviewMarked?: boolean;
}

type PickerStepResult<TAction extends string> =
  | { kind: "submit"; action: TAction }
  | { kind: "cancel" }
  | { kind: "edit-note"; index: number };

const NOTE_KEY = "ctrl+n";
const CLEAR_NOTE_KEY = "ctrl+d";
const DEFAULT_REVIEW_TOGGLE_KEY = "ctrl+r";
const DEFAULT_NOTE_MAX_LENGTH = 300;

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
  };
}

function buildNotes<TAction extends string>(
  options: ReadonlyArray<OptionState<TAction>>,
): Partial<Record<TAction, string>> {
  const notes: Partial<Record<TAction, string>> = {};

  for (const option of options) {
    if (option.noteValue.trim().length === 0) continue;
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
  return matchesKey(data, Key.ctrl("n"));
}

function isReviewToggleInput(data: string, enabled: boolean, key: string): boolean {
  if (!enabled) return false;

  const trimmed = key.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  const ctrlMatch = lower.match(/^ctrl\s*\+\s*([a-z])$/);
  if (ctrlMatch) {
    const parsed = parseKey(data);
    return parsed === `ctrl+${ctrlMatch[1]}`;
  }

  return data === trimmed;
}

function buildPickerLines<TAction extends string>(
  theme: any,
  width: number,
  config: OptionPickerConfig<TAction>,
  options: ReadonlyArray<OptionState<TAction>>,
  selectedIndex: number,
  reviewMarked: boolean,
  reviewToggleEnabled: boolean,
): string[] {
  const lines: string[] = [];

  const reviewTitleSuffix =
    reviewToggleEnabled && reviewMarked ? ` ${theme.fg("warning", "(R)")}` : "";
  lines.push(truncateToWidth(`${theme.fg("accent", config.title)}${reviewTitleSuffix}`, width));

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
    const label = selected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
    const noteIndicator = option.noteValue.trim().length > 0 ? theme.fg("muted", " 📝") : "";
    lines.push(truncateToWidth(`${prefix} ${label}${noteIndicator}`, width));
  }

  return lines;
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

  const reviewToggleEnabled = config.reviewToggle !== undefined;
  const reviewToggleKey = config.reviewToggle?.key ?? DEFAULT_REVIEW_TOGGLE_KEY;
  const reviewToggleLabel = config.reviewToggle?.label ?? "review";

  let selectedIndex = 0;
  let reviewMarked = config.reviewToggle?.initialValue ?? false;

  try {
    while (true) {
      const step = await ctx.ui.custom<PickerStepResult<TAction>>((tui, theme, _kb, done) => {
        function moveSelection(delta: number): void {
          selectedIndex = (selectedIndex + delta + options.length) % options.length;
          tui.requestRender();
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

            const option = options[selectedIndex]!;

            if (matchesKey(data, Key.enter)) {
              done({ kind: "submit", action: option.id });
              return;
            }

            if (isReviewToggleInput(data, reviewToggleEnabled, reviewToggleKey)) {
              reviewMarked = !reviewMarked;
              tui.requestRender();
              return;
            }

            if (isNoteToggleInput(data) && option.noteEnabled) {
              done({ kind: "edit-note", index: selectedIndex });
              return;
            }

            if (matchesKey(data, Key.ctrl("d")) && option.noteEnabled) {
              option.noteValue = "";
              tui.requestRender();
              return;
            }

            if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.escape)) {
              done({ kind: "cancel" });
            }
          },
          render(width: number) {
            const lines = buildPickerLines(
              theme,
              width,
              config,
              options,
              selectedIndex,
              reviewMarked,
              reviewToggleEnabled,
            );

            const footerParts: string[] = [
              rawKeyHint("↑↓/Tab", "navigate"),
              rawKeyHint("Enter", "select"),
              rawKeyHint(NOTE_KEY, "edit note"),
              rawKeyHint(CLEAR_NOTE_KEY, "clear note"),
            ];

            if (reviewToggleEnabled) {
              footerParts.push(rawKeyHint(reviewToggleKey, `toggle ${reviewToggleLabel}`));
            }

            footerParts.push(rawKeyHint("ctrl+c", "cancel"), rawKeyHint("esc", "cancel"));

            lines.push("");
            lines.push(truncateToWidth(footerParts.join(theme.fg("dim", " • ")), width));
            return lines;
          },
          invalidate() {},
        };
      });

      if (step.kind === "submit") {
        return {
          action: step.action,
          notes: buildNotes(options),
          reviewMarked: reviewToggleEnabled ? reviewMarked : undefined,
        };
      }

      if (step.kind === "cancel") {
        if (cancelAction !== undefined) {
          return {
            action: cancelAction,
            notes: buildNotes(options),
            reviewMarked: reviewToggleEnabled ? reviewMarked : undefined,
          };
        }

        return null;
      }

      const target = options[step.index];
      if (!target || !target.noteEnabled) {
        continue;
      }

      const edited = await ctx.ui.editor(`Note for: ${target.label}`, target.noteValue);
      if (edited === undefined) {
        continue;
      }

      const trimmed = edited.trim();
      target.noteValue = trimmed.length > 0 ? edited.slice(0, target.noteMaxLength) : "";
    }
  } catch {
    return null;
  }
}
