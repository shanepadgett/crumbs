import { describe, expect, test } from "bun:test";
import { buildValidationSignature, diffSnapshots } from "./snapshots.js";
import type { Snapshot } from "./types.js";

function snapshot(entries: Array<[string, string]>): Snapshot {
  return new Map(entries);
}

describe("quiet validator snapshots", () => {
  test("diffSnapshots detects added, deleted, and changed files in sorted order", () => {
    const before = snapshot([
      ["b.ts", "1:100"],
      ["deleted.ts", "2:100"],
      ["same.ts", "3:100"],
    ]);
    const after = snapshot([
      ["added.ts", "4:100"],
      ["b.ts", "1:200"],
      ["same.ts", "3:100"],
    ]);

    expect(diffSnapshots(before, after)).toEqual(["added.ts", "b.ts", "deleted.ts"]);
  });

  test("buildValidationSignature includes deleted marker", () => {
    const current = snapshot([["changed.ts", "5:200"]]);

    expect(buildValidationSignature(current, ["changed.ts", "deleted.ts"])).toBe(
      "changed.ts:5:200|deleted.ts:<deleted>",
    );
  });
});
