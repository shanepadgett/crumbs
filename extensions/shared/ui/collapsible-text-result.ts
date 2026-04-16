import { keyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { truncateMultilineText, truncateText } from "./text.js";

export interface RenderCollapsibleTextResultOptions {
  expanded: boolean;
  collapsedText: string;
  expandedText?: string;
  footer?: string;
}

export function renderCollapsibleTextResult(
  theme: { fg(color: "muted" | "toolOutput", text: string): string },
  options: RenderCollapsibleTextResultOptions,
): Text {
  const body = options.expanded
    ? (options.expandedText ?? options.collapsedText)
    : options.collapsedText;
  const isExpandable = options.expandedText !== undefined;
  const hint = isExpandable
    ? keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")
    : "";
  const footer = options.footer?.trim();
  const footerLine = footer
    ? hint
      ? `${theme.fg("toolOutput", footer)}  ${theme.fg("muted", hint)}`
      : theme.fg("toolOutput", footer)
    : hint
      ? theme.fg("muted", hint)
      : "";
  const bodyText = theme.fg("toolOutput", body);
  const separator = options.expanded ? "\n\n" : "\n";
  const content =
    bodyText && footerLine
      ? `${bodyText}${separator}${footerLine}`
      : [bodyText, footerLine].filter(Boolean).join("\n");

  return new Text(content, 0, 0);
}

export { truncateMultilineText, truncateText };
