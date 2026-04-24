import { describe, expect, test } from "bun:test";
import { readFixture } from "../../test-support/fixtures.js";
import { parsePatch } from "./patch-parser.js";

describe("parsePatch", () => {
  test("parses add file sections from fixtures", () => {
    const parsed = parsePatch(readFixture(import.meta.url, "__fixtures__/patches/add-file.patch"));

    expect(parsed.parseFailures).toEqual([]);
    expect(parsed.operations).toEqual([
      {
        type: "add",
        path: "notes/new.md",
        content: "# New note\n\nbody\n",
        linesAdded: 3,
      },
    ]);
  });

  test("parses replace file sections", () => {
    const parsed = parsePatch(
      readFixture(import.meta.url, "__fixtures__/patches/replace-file.patch"),
    );

    expect(parsed.parseFailures).toEqual([]);
    expect(parsed.operations).toEqual([
      {
        type: "replace",
        path: "notes/existing.md",
        content: "replacement line 1\nreplacement line 2\n",
        linesAdded: 2,
      },
    ]);
  });

  test("parses move update sections", () => {
    const parsed = parsePatch(readFixture(import.meta.url, "__fixtures__/patches/move-file.patch"));

    expect(parsed.parseFailures).toEqual([]);
    expect(parsed.operations).toEqual([
      {
        type: "update",
        path: "notes/old.md",
        movePath: "notes/new.md",
        chunks: [
          {
            changeContext: "heading",
            oldLines: ["old heading", "old body"],
            newLines: ["old heading", "new body"],
            isEndOfFile: false,
          },
        ],
        linesAdded: 1,
        linesRemoved: 1,
      },
    ]);
  });

  test("parses multi-file patches", () => {
    const parsed = parsePatch(
      readFixture(import.meta.url, "__fixtures__/patches/multi-file.patch"),
    );

    expect(parsed.parseFailures).toEqual([]);
    expect(parsed.operations).toEqual([
      { type: "add", path: "notes/new.md", content: "created\n", linesAdded: 1 },
      {
        type: "update",
        path: "notes/existing.md",
        chunks: [
          {
            changeContext: undefined,
            oldLines: ["keep", "old"],
            newLines: ["keep", "new"],
            isEndOfFile: false,
          },
        ],
        linesAdded: 1,
        linesRemoved: 1,
      },
      { type: "delete", path: "notes/remove.md" },
    ]);
  });

  test("reports malformed sections without throwing", () => {
    const parsed = parsePatch(readFixture(import.meta.url, "__fixtures__/patches/malformed.patch"));

    expect(parsed.operations).toEqual([]);
    expect(parsed.parseFailures.map((failure) => failure.message)).toEqual([
      "Update file patch is missing chunk content: notes/missing-chunk.md",
    ]);
  });
});
