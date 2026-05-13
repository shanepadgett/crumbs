import {
  DynamicBorder,
  getSelectListTheme,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  Key,
  SelectList,
  Spacer,
  Text,
  matchesKey,
  truncateToWidth,
  type Focusable,
  type SelectItem,
} from "@earendil-works/pi-tui";
import { MultiSelectList, type MultiSelectItem } from "../../../shared/ui/multi-select-list.js";
import type { InheritMode } from "./model.js";

function renderFramedScreen(
  theme: ExtensionCommandContext["ui"]["theme"],
  width: number,
  title: string,
  body: Container,
  hint?: string,
): string[] {
  const border = new DynamicBorder((text) => theme.fg("border", text));
  const lines = [...border.render(width)];
  lines.push("");
  lines.push(truncateToWidth(theme.fg("accent", theme.bold(title)), width));
  if (hint) lines.push(truncateToWidth(theme.fg("dim", hint), width));
  lines.push("");
  lines.push(...body.render(width));
  lines.push("");
  lines.push(...border.render(width));
  return lines;
}

export async function pickFromList<T extends string>(
  ctx: ExtensionCommandContext,
  title: string,
  items: Array<{ value: T; label: string; description?: string }>,
  initialIndex = 0,
): Promise<T | undefined> {
  return ctx.ui.custom<T | undefined>((tui, theme, _kb, done) => {
    const listItems: SelectItem[] = items.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.description,
    }));
    const list = new SelectList(
      listItems,
      Math.min(Math.max(listItems.length, 1), 12),
      getSelectListTheme(),
    );

    for (let i = 0; i < initialIndex; i++) list.handleInput(Key.down);

    return {
      focused: true,
      handleInput(data: string) {
        if (matchesKey(data, Key.enter)) {
          done(list.getSelectedItem()?.value as T | undefined);
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done(undefined);
          return;
        }
        list.handleInput(data);
        tui.requestRender();
      },
      invalidate() {
        list.invalidate();
      },
      render(width: number) {
        const body = new Container();
        body.addChild(list);
        return renderFramedScreen(
          theme,
          width,
          title,
          body,
          "↑/↓ move • Enter choose • Esc cancel",
        );
      },
    };
  });
}

export async function pickTools(
  ctx: ExtensionCommandContext,
  allTools: string[],
  initialMode: InheritMode,
  initialTools: string[],
): Promise<{ mode: InheritMode; tools: string[] } | undefined> {
  return ctx.ui.custom<{ mode: InheritMode; tools: string[] } | undefined>(
    (tui, theme, _kb, done) => {
      let mode = initialMode;
      const rows = (): MultiSelectItem[] => [
        {
          value: "inherit",
          label: "inherit parent active tools",
        },
        ...allTools.map((tool) => ({
          value: tool,
          label: tool,
        })),
      ];
      const list = new MultiSelectList(rows(), Math.min(Math.max(allTools.length + 1, 1), 14), {
        selectedText: (text) => theme.bg("selectedBg", theme.fg("text", text)),
        description: (text) => theme.fg("dim", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("dim", text),
      });

      const syncCheckedValues = () => {
        list.setCheckedValues(mode === "inherit" ? ["inherit"] : initialTools);
      };

      syncCheckedValues();
      list.onToggle = (values, item) => {
        if (item.value === "inherit") {
          mode = "inherit";
          list.setCheckedValues(["inherit"]);
        } else {
          mode = "explicit";
          list.setCheckedValues(values.filter((value) => value !== "inherit"));
        }
        tui.requestRender();
      };
      list.onConfirm = (values) => {
        done({
          mode,
          tools: mode === "inherit" ? [] : values.filter((value) => value !== "inherit").sort(),
        });
      };
      list.onCancel = () => done(undefined);

      return {
        focused: true,
        handleInput(data: string) {
          list.handleInput(data);
          tui.requestRender();
        },
        invalidate() {
          list.invalidate();
        },
        render(width: number) {
          const body = new Container();
          body.addChild(list);
          return renderFramedScreen(
            theme,
            width,
            "Choose tools",
            body,
            "↑/↓ move • Space toggle • Enter confirm • Esc cancel",
          );
        },
      };
    },
  );
}

export async function promptForText(
  ctx: ExtensionCommandContext,
  options: {
    title: string;
    description: string;
    emptyMessage: string;
    hint: string;
  },
): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
    const input = new Input();
    let message = "";
    let focused = true;
    input.onSubmit = () => {
      const value = input.getValue().trim();
      if (!value) {
        message = options.emptyMessage;
        tui.requestRender();
        return;
      }
      done(value);
    };
    input.onEscape = () => done(undefined);

    const component: Focusable & {
      render(width: number): string[];
      handleInput(data: string): void;
      invalidate(): void;
    } = {
      get focused() {
        return focused;
      },
      set focused(value: boolean) {
        focused = value;
        input.focused = value;
      },
      handleInput(data: string) {
        input.handleInput(data);
        message = "";
        tui.requestRender();
      },
      invalidate() {
        input.invalidate();
      },
      render(width: number) {
        const body = new Container();
        body.addChild(
          new Text(truncateToWidth(theme.fg("muted", options.description), width), 0, 0),
        );
        body.addChild(new Spacer(1));
        body.addChild(input);
        if (message) {
          body.addChild(new Spacer(1));
          body.addChild(new Text(truncateToWidth(theme.fg("warning", message), width), 0, 0));
        }
        return renderFramedScreen(theme, width, options.title, body, options.hint);
      },
    };

    return component;
  });
}

export async function confirmAction(
  ctx: ExtensionCommandContext,
  options: {
    title: string;
    lines: string[];
    confirmLabel: string;
    hint: string;
  },
): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
    const actions: SelectItem[] = [
      { value: "confirm", label: options.confirmLabel },
      { value: "cancel", label: "Cancel" },
    ];
    const list = new SelectList(actions, actions.length, getSelectListTheme());
    list.handleInput(Key.down);

    return {
      focused: true,
      handleInput(data: string) {
        if (matchesKey(data, Key.enter)) {
          done(String(list.getSelectedItem()?.value ?? "cancel") === "confirm");
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done(false);
          return;
        }
        list.handleInput(data);
        tui.requestRender();
      },
      invalidate() {
        list.invalidate();
      },
      render(width: number) {
        const body = new Container();
        for (const line of options.lines)
          body.addChild(new Text(truncateToWidth(line, width), 0, 0));
        body.addChild(new Spacer(1));
        body.addChild(list);
        return renderFramedScreen(theme, width, options.title, body, options.hint);
      },
    };
  });
}

export async function showMessage(
  ctx: ExtensionCommandContext,
  title: string,
  lines: string[],
): Promise<void> {
  await ctx.ui.custom<void>((_tui, theme, _kb, done) => ({
    focused: true,
    handleInput(data: string) {
      if (
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c"))
      ) {
        done();
      }
    },
    render(width: number) {
      const body = new Container();
      for (const line of lines) body.addChild(new Text(truncateToWidth(line, width), 0, 0));
      return renderFramedScreen(theme, width, title, body, "Enter or Esc close");
    },
    invalidate() {},
  }));
}

export async function runBusy<T>(
  ctx: ExtensionCommandContext,
  title: string,
  lines: string[],
  work: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let failure: unknown;
  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    void work()
      .then((value) => {
        result = value;
      })
      .catch((error: unknown) => {
        failure = error;
      })
      .finally(() => {
        tui.requestRender();
        done();
      });

    return {
      focused: true,
      handleInput() {},
      render(width: number) {
        const body = new Container();
        for (const line of lines) body.addChild(new Text(truncateToWidth(line, width), 0, 0));
        return renderFramedScreen(theme, width, title, body);
      },
      invalidate() {},
    };
  });
  if (failure) throw failure;
  return result as T;
}
