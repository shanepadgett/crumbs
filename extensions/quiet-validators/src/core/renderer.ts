import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { buildExpandedOutput } from "./messages.js";
import type { FailureGroup } from "./types.js";

export const MISE_TASK_MESSAGE_TYPE = "automation.mise-task";

export function registerQuietValidationRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<{
    changedFiles?: string[];
    exitCode?: number;
    failureGroups?: FailureGroup[];
    output?: string;
    title?: string;
  }>(MISE_TASK_MESSAGE_TYPE, (message, options, theme) => {
    const details = message.details ?? {};
    const title = typeof details.title === "string" ? details.title : "mise task";
    const exitCode =
      typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
        ? details.exitCode
        : undefined;
    const failureGroups = Array.isArray(details.failureGroups) ? details.failureGroups : [];
    const status = [
      theme.fg("warning", "failed"),
      exitCode !== undefined ? theme.fg("muted", `(exit ${exitCode})`) : "",
      theme.fg("muted", `${failureGroups.length} group(s)`),
      !options.expanded
        ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
        : theme.fg("muted", `(${keyHint("app.tools.expand", "to collapse")})`),
    ]
      .filter(Boolean)
      .join(" ");

    const root = new Container();
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    root.addChild(box);

    const label = theme.fg("customMessageLabel", `\x1b[1m[${message.customType}]\x1b[22m`);
    box.addChild(new Text(label, 0, 0));
    box.addChild(new Spacer(1));
    box.addChild(new Text([theme.fg("toolTitle", theme.bold(title)), status].join(" "), 0, 0));

    for (const group of failureGroups) {
      box.addChild(new Text(theme.fg("toolOutput", `- ${group.title}: ${group.count}`), 0, 0));
    }

    if (!options.expanded) return root;

    const changedFiles = Array.isArray(details.changedFiles) ? details.changedFiles : [];
    const output = typeof details.output === "string" ? details.output : "";
    const expandedOutput = buildExpandedOutput(changedFiles, failureGroups, output);
    if (expandedOutput) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(theme.fg("toolOutput", expandedOutput), 0, 0));
    }

    return root;
  });
}
