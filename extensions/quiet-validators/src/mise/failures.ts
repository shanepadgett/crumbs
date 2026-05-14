import { createFallbackFailureGroups } from "../core/failure-groups.js";

function normalizeMessageStem(message: string): string {
  return message
    .replace(/^[-*•]\s*/, "")
    .replace(/^[^:]+:\d+:\d+:\s*/, "")
    .replace(/^[^:]+:\d+:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseMiseFailureGroups(output: string) {
  const groups = new Map<
    string,
    { key: string; title: string; count: number; examples: string[] }
  >();
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const swiftLintMatch = line.match(
      /^(.+?):(\d+):(\d+):\s+(warning|error):\s+(.+?)\s+\(([A-Za-z0-9_]+)\)$/,
    );
    if (swiftLintMatch) {
      const ruleId = swiftLintMatch[6];
      const key = `swiftlint:${ruleId}`;
      const title = `SwiftLint · ${ruleId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set(key, { key, title, count: 1, examples: [line] });
      }
      continue;
    }

    if (/swiftformat/i.test(line) || /is not formatted correctly/i.test(line)) {
      const existing = groups.get("swiftformat");
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set("swiftformat", {
          key: "swiftformat",
          title: "SwiftFormat",
          count: 1,
          examples: [line],
        });
      }
      continue;
    }

    if (
      /error:/i.test(line) ||
      /warning:/i.test(line) ||
      /failed/i.test(line) ||
      /not formatted/i.test(line)
    ) {
      const normalized = normalizeMessageStem(line);
      const key = `message:${normalized.toLowerCase()}`;
      const title = titleCase(normalized);
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.examples.length < 5 && !existing.examples.includes(line))
          existing.examples.push(line);
      } else {
        groups.set(key, { key, title, count: 1, examples: [line] });
      }
    }
  }

  return groups.size > 0 ? [...groups.values()] : createFallbackFailureGroups("Mise Task", output);
}
