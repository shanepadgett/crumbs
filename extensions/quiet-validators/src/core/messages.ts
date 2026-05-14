import type { FailureGroup } from "./types.js";

export type ValidationFailureDetails = {
  changedFiles: string[];
  exitCode: number;
  failureGroups: FailureGroup[];
  output: string;
  title: string;
};

export function buildFailureContent(
  title: string,
  changedFiles: string[],
  failureGroups: FailureGroup[],
  output: string,
): string {
  const fileLines = changedFiles
    .slice(0, 12)
    .map((file) => `- ${file}`)
    .join("\n");
  const extraCount = Math.max(0, changedFiles.length - 12);
  const extraLine = extraCount > 0 ? `\n- ... and ${extraCount} more` : "";
  const groupLines = failureGroups
    .map((group) => {
      const headline = `- ${group.title}: ${group.count}`;
      const example = group.examples.find((line) => line.trim().length > 0);
      if (!example) return headline;
      return `${headline}\n  • ${example}`;
    })
    .join("\n");

  const excerptLines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);

  const excerpt = excerptLines.length > 0 ? excerptLines.join("\n") : "(no captured output)";

  return [
    `${title} failed after validator-relevant file changes.`,
    "Fix the reported failures before continuing.",
    "",
    "Changed files:",
    fileLines + extraLine,
    "",
    "Failure groups:",
    groupLines || "- Validation: 1",
    "",
    "Failure excerpt:",
    excerpt,
  ].join("\n");
}

export function buildFailureDetails(
  title: string,
  changedFiles: string[],
  exitCode: number,
  failureGroups: FailureGroup[],
  output: string,
): ValidationFailureDetails {
  return { changedFiles, exitCode, failureGroups, output, title };
}

export function buildExpandedOutput(
  changedFiles: string[],
  failureGroups: FailureGroup[],
  output: string,
): string {
  const lines: string[] = [];

  if (changedFiles.length > 0) {
    lines.push("Changed files:");
    lines.push(...changedFiles.map((file) => `- ${file}`));
  }

  if (failureGroups.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Failure groups:");
    for (const group of failureGroups) {
      lines.push(`- ${group.title} (${group.count})`);
      for (const example of group.examples) {
        lines.push(`  • ${example}`);
      }
    }
  }

  if (output.trim()) {
    if (lines.length > 0) lines.push("");
    lines.push("Raw output:");
    lines.push(output.trimEnd());
  }

  return lines.join("\n");
}
