import { keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { truncateMultilineText, truncateText } from "./text.js";

export interface RenderCollapsibleTextResultOptions {
  expanded: boolean;
  collapsedText: string;
  expandedText?: string;
  footer?: string;
  bodyColor?: "error" | "toolOutput";
  footerColor?: "error" | "toolOutput";
}

export interface RenderCollapsibleStyledTextResultOptions {
  expanded: boolean;
  collapsedText: string;
  expandedText?: string;
  footer?: string;
}

export function renderCollapsibleStyledTextResult(
  theme: { fg(color: "muted", text: string): string },
  options: RenderCollapsibleStyledTextResultOptions,
): Text {
  const body = options.expanded
    ? (options.expandedText ?? options.collapsedText)
    : options.collapsedText;
  const isExpandable = options.expandedText !== undefined;
  const footer = options.footer;
  const hint = isExpandable
    ? theme.fg("muted", keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand"))
    : "";
  const footerLine = footer ? (hint ? `${footer}  ${hint}` : footer) : hint;
  const separator = options.expanded ? "\n\n" : "\n";
  const content =
    body && footerLine
      ? `${body}${separator}${footerLine}`
      : [body, footerLine].filter(Boolean).join("\n");
  return new Text(content, 0, 0);
}

export function renderCollapsibleTextResult(
  theme: { fg(color: "muted" | "error" | "toolOutput", text: string): string },
  options: RenderCollapsibleTextResultOptions,
): Text {
  const body = options.expanded
    ? (options.expandedText ?? options.collapsedText)
    : options.collapsedText;
  const isExpandable = options.expandedText !== undefined;
  const hint = isExpandable
    ? keyHint("app.tools.expand", options.expanded ? "to collapse" : "to expand")
    : "";
  const bodyColor = options.bodyColor ?? "toolOutput";
  const footerColor = options.footerColor ?? bodyColor;
  const footer = options.footer?.trim();
  const footerLine = footer
    ? hint
      ? `${theme.fg(footerColor, footer)}  ${theme.fg("muted", hint)}`
      : theme.fg(footerColor, footer)
    : hint
      ? theme.fg("muted", hint)
      : "";
  const bodyText = theme.fg(bodyColor, body);
  const separator = options.expanded ? "\n\n" : "\n";
  const content =
    bodyText && footerLine
      ? `${bodyText}${separator}${footerLine}`
      : [bodyText, footerLine].filter(Boolean).join("\n");

  return new Text(content, 0, 0);
}

export { truncateMultilineText, truncateText };
