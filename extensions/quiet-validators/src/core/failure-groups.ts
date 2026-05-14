import type { FailureGroup } from "./types.js";

export function createFallbackFailureGroups(title: string, output: string): FailureGroup[] {
  if (!output.trim()) {
    return [{ key: title.toLowerCase(), title, count: 1, examples: [] }];
  }

  return [
    {
      key: title.toLowerCase(),
      title,
      count: 1,
      examples: [output.trim().split(/\r?\n/)[0] ?? title],
    },
  ];
}
