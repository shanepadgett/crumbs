import { getKeybindings } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface MultiSelectItem {
  value: string;
  label: string;
  description?: string;
}

export interface MultiSelectListTheme {
  selectedText: (text: string) => string;
  description: (text: string) => string;
  scrollInfo: (text: string) => string;
  noMatch: (text: string) => string;
}

export class MultiSelectList implements Component {
  private items: MultiSelectItem[];
  private selectedIndex = 0;
  private checkedValues = new Set<string>();

  public onConfirm?: (values: string[]) => void;
  public onCancel?: () => void;
  public onSelectionChange?: (item: MultiSelectItem) => void;
  public onToggle?: (values: string[], item: MultiSelectItem) => void;

  constructor(
    items: MultiSelectItem[],
    private maxVisible: number,
    private theme: MultiSelectListTheme,
  ) {
    this.items = items;
  }

  setItems(items: MultiSelectItem[]): void {
    this.items = items;
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.items.length - 1));
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, this.items.length - 1));
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  getCursorItem(): MultiSelectItem | null {
    return this.items[this.selectedIndex] || null;
  }

  setCheckedValues(values: string[]): void {
    this.checkedValues = new Set(values);
  }

  getCheckedValues(): string[] {
    return this.items.map((item) => item.value).filter((value) => this.checkedValues.has(value));
  }

  isChecked(value: string): boolean {
    return this.checkedValues.has(value);
  }

  toggleChecked(value: string): void {
    if (this.checkedValues.has(value)) this.checkedValues.delete(value);
    else this.checkedValues.add(value);
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.items.length === 0) return [this.theme.noMatch("  No items")];

    const lines: string[] = [];
    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(this.maxVisible / 2),
        this.items.length - this.maxVisible,
      ),
    );
    const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = this.items[index];
      if (!item) continue;
      const isSelected = index === this.selectedIndex;
      const prefix = isSelected ? "→ " : "  ";
      const check = this.isChecked(item.value) ? "[x] " : "[ ] ";
      const contentWidth = Math.max(1, width - visibleWidth(prefix));
      const label = truncateToWidth(`${prefix}${check}${item.label}`, width);
      lines.push(isSelected ? this.theme.selectedText(label) : label);
      if (item.description) {
        const descriptionPrefix = "    ";
        const description = truncateToWidth(item.description, Math.max(1, contentWidth - 2));
        lines.push(this.theme.description(`${descriptionPrefix}${description}`));
      }
    }

    if (startIndex > 0 || endIndex < this.items.length) {
      lines.push(
        this.theme.scrollInfo(
          truncateToWidth(`  (${this.selectedIndex + 1}/${this.items.length})`, width, ""),
        ),
      );
    }

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.up")) {
      this.selectedIndex =
        this.selectedIndex === 0 ? this.items.length - 1 : this.selectedIndex - 1;
      this.notifySelectionChange();
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      this.selectedIndex =
        this.selectedIndex === this.items.length - 1 ? 0 : this.selectedIndex + 1;
      this.notifySelectionChange();
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      this.onConfirm?.(this.getCheckedValues());
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) {
      this.onCancel?.();
      return;
    }
    if (data === " ") {
      const item = this.getCursorItem();
      if (!item) return;
      this.toggleChecked(item.value);
      this.onToggle?.(this.getCheckedValues(), item);
    }
  }

  private notifySelectionChange(): void {
    const item = this.getCursorItem();
    if (item) this.onSelectionChange?.(item);
  }
}
