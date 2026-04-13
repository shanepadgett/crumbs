import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { formatDeletedOperationName } from "./discovery.js";
import type {
  DeletedOperation,
  ManagerRow,
  PickerOption,
  SkillRecord,
  SkillScope,
  SkillTab,
} from "./types.js";

export interface BrowserResult {
  kind: "cancel" | "action" | "refresh";
  selectedIds: string[];
  activeTab: SkillTab;
  hoveredId?: string;
}

const TABS: Array<{ id: SkillTab; label: string }> = [
  { id: "agents-global", label: "Agents Global" },
  { id: "agents-project", label: "Agents Project" },
  { id: "claude-global", label: "Claude Global" },
  { id: "claude-project", label: "Claude Project" },
  { id: "recently-deleted", label: "Recently Deleted" },
];

function rowLabel(row: ManagerRow): string {
  if (row.kind === "deleted-operation") return formatDeletedOperationName(row);
  return row.name;
}

function rowPath(row: ManagerRow): string {
  if (row.kind === "deleted-operation") return row.entries[0]?.originalPath ?? "";
  return row.path;
}

export async function runBrowser(
  ctx: ExtensionContext,
  rows: ManagerRow[],
  activeTab: SkillTab,
  selectedIds: Set<string>,
): Promise<BrowserResult> {
  return ctx.ui.custom<BrowserResult>((tui, theme, _kb, done) => {
    let tabIndex = Math.max(
      0,
      TABS.findIndex((tab) => tab.id === activeTab),
    );
    let cursor = 0;
    const selected = new Set(selectedIds);

    const visibleRows = (): ManagerRow[] => {
      const tab = TABS[tabIndex]!.id;
      return rows.filter((row) =>
        row.kind === "deleted-operation" ? tab === "recently-deleted" : row.tab === tab,
      );
    };

    const clampCursor = () => {
      const current = visibleRows();
      if (current.length === 0) cursor = 0;
      else cursor = Math.max(0, Math.min(cursor, current.length - 1));
    };

    return {
      handleInput(data: string) {
        const currentRows = visibleRows();
        if (matchesKey(data, Key.left)) {
          tabIndex = Math.max(0, tabIndex - 1);
          clampCursor();
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
          tabIndex = Math.min(TABS.length - 1, tabIndex + 1);
          clampCursor();
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down)) {
          cursor = Math.min(currentRows.length - 1, cursor + 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.space)) {
          const id = currentRows[cursor]?.id;
          if (!id) return;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          tui.requestRender();
          return;
        }
        if (data.toLowerCase() === "a") {
          done({
            kind: "action",
            selectedIds: [...selected],
            activeTab: TABS[tabIndex]!.id,
            hoveredId: currentRows[cursor]?.id,
          });
          return;
        }
        if (data.toLowerCase() === "r") {
          done({
            kind: "refresh",
            selectedIds: [...selected],
            activeTab: TABS[tabIndex]!.id,
            hoveredId: currentRows[cursor]?.id,
          });
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
          done({
            kind: "cancel",
            selectedIds: [...selected],
            activeTab: TABS[tabIndex]!.id,
            hoveredId: currentRows[cursor]?.id,
          });
        }
      },
      render(width: number) {
        const currentRows = visibleRows();
        clampCursor();
        const lines: string[] = [];
        lines.push(truncateToWidth(theme.fg("accent", theme.bold("Skills Manager")), width));
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              "←/→ or Tab tabs • ↑/↓ move • Space select • a actions • r refresh • Esc cancel",
            ),
            width,
          ),
        );
        lines.push("");
        lines.push(
          truncateToWidth(
            TABS.map((tab, index) =>
              index === tabIndex
                ? theme.fg("accent", theme.bold(`[${tab.label}]`))
                : theme.fg("dim", `[${tab.label}]`),
            ).join(" "),
            width,
          ),
        );
        lines.push("");

        if (currentRows.length === 0) {
          lines.push(truncateToWidth(theme.fg("warning", "Nothing here."), width));
          return lines;
        }

        for (let i = 0; i < currentRows.length; i++) {
          const row = currentRows[i]!;
          const isCurrent = i === cursor;
          const marker = isCurrent ? theme.fg("accent", "❯") : " ";
          const checkbox = selected.has(row.id)
            ? theme.fg("success", "[x]")
            : theme.fg("dim", "[ ]");
          const symlink = row.kind === "skill" && row.isSymlink ? theme.fg("dim", "↺") : "";
          const dependent =
            row.kind === "skill" && row.hasManagedDependents ? theme.fg("dim", "⇠") : "";
          const icons = symlink || dependent ? `${symlink}${dependent} ` : "";
          const name = isCurrent
            ? theme.fg("accent", rowLabel(row))
            : theme.fg("text", rowLabel(row));
          const meta =
            row.kind === "deleted-operation"
              ? theme.fg("warning", `[${row.entries.length} paths]`)
              : theme.fg("dim", `[${row.scope}]`);
          lines.push(
            truncateToWidth(
              `${marker} ${checkbox} ${meta} ${icons}${name} ${theme.fg("dim", `(${rowPath(row)})`)}`,
              width,
            ),
          );
        }

        return lines;
      },
      invalidate() {},
    };
  });
}

export async function runPicker<T extends string>(
  ctx: ExtensionContext,
  title: string,
  options: PickerOption<T>[],
): Promise<T | undefined> {
  return ctx.ui.custom<T | undefined>((tui, theme, _kb, done) => {
    let cursor = 0;
    return {
      handleInput(data: string) {
        if (matchesKey(data, Key.up)) {
          cursor = Math.max(0, cursor - 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down)) {
          cursor = Math.min(options.length - 1, cursor + 1);
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          done(options[cursor]?.id);
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(undefined);
      },
      render(width: number) {
        const lines = [
          truncateToWidth(theme.fg("accent", theme.bold(title)), width),
          truncateToWidth(theme.fg("dim", "↑/↓ move • Enter choose • Esc cancel"), width),
          "",
        ];
        for (let i = 0; i < options.length; i++) {
          const option = options[i]!;
          const marker = i === cursor ? theme.fg("accent", "❯") : " ";
          lines.push(
            truncateToWidth(
              `${marker} ${i === cursor ? theme.fg("accent", option.label) : option.label}`,
              width,
            ),
          );
          if (option.detail)
            lines.push(truncateToWidth(`  ${theme.fg("dim", option.detail)}`, width));
        }
        return lines;
      },
      invalidate() {},
    };
  });
}

export async function chooseDestinationScope(
  ctx: ExtensionContext,
  title: string,
  preferred: SkillScope,
): Promise<SkillScope | undefined> {
  const options: PickerOption<SkillScope>[] =
    preferred === "project"
      ? [
          { id: "project", label: "Project" },
          { id: "global", label: "Global" },
        ]
      : [
          { id: "global", label: "Global" },
          { id: "project", label: "Project" },
        ];
  return runPicker(ctx, title, options);
}

export async function confirmNoDefault(
  ctx: ExtensionContext,
  title: string,
  bodyLines: string[],
): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
    let choice: "no" | "yes" = "no";
    return {
      handleInput(data: string) {
        if (
          matchesKey(data, Key.left) ||
          matchesKey(data, Key.right) ||
          matchesKey(data, Key.tab)
        ) {
          choice = choice === "no" ? "yes" : "no";
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          done(choice === "yes");
          return;
        }
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) done(false);
      },
      render(width: number) {
        const no =
          choice === "no" ? theme.fg("accent", theme.bold("[ No ]")) : theme.fg("dim", "[ No ]");
        const yes =
          choice === "yes" ? theme.fg("accent", theme.bold("[ Yes ]")) : theme.fg("dim", "[ Yes ]");
        return [
          truncateToWidth(theme.fg("warning", theme.bold(title)), width),
          "",
          ...bodyLines.map((line) => truncateToWidth(theme.fg("text", line), width)),
          "",
          truncateToWidth(`${no} ${yes}`, width),
          truncateToWidth(theme.fg("dim", "←/→ or Tab switch • Enter confirm • Esc cancel"), width),
        ];
      },
      invalidate() {},
    };
  });
}

export async function showTextScreen(
  ctx: ExtensionContext,
  title: string,
  bodyLines: string[],
): Promise<void> {
  await ctx.ui.custom<void>((tui, theme, _kb, done) => ({
    handleInput(data: string) {
      if (
        matchesKey(data, Key.enter) ||
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.ctrl("c"))
      )
        done();
    },
    render(width: number) {
      return [
        truncateToWidth(theme.fg("accent", theme.bold(title)), width),
        "",
        ...bodyLines.map((line) => truncateToWidth(theme.fg("text", line), width)),
        "",
        truncateToWidth(theme.fg("dim", "Enter or Esc close"), width),
      ];
    },
    invalidate() {},
  }));
}

export function describeSkill(skill: SkillRecord): string[] {
  return [
    `Name: ${skill.name}`,
    `Store: ${skill.store}`,
    `Scope: ${skill.scope}`,
    `Path: ${skill.path}`,
    `Symlink: ${skill.isSymlink ? "yes" : "no"}`,
    ...(skill.resolvedTarget ? [`Target: ${skill.resolvedTarget}`] : []),
  ];
}

export function describeDeletedOperation(operation: DeletedOperation): string[] {
  return [
    `Deleted: ${operation.deletedAt}`,
    ...operation.entries.flatMap((entry) => [
      `• ${entry.name}`,
      `  from ${entry.originalPath}`,
      `  trash ${entry.trashPath}`,
    ]),
  ];
}
