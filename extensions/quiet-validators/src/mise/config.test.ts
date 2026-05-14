import { describe, expect, test } from "bun:test";
import { asTrackedExtensions, parseMiseTaskConfigs } from "./config.js";

describe("mise task config parsing", () => {
  test("missing config returns legacy default with no tracked extensions", () => {
    expect(parseMiseTaskConfigs(undefined)).toEqual([
      { enabled: true, name: null, task: "check", trackedExtensions: [], excludeGlobs: [] },
    ]);
  });

  test("legacy object creates one config", () => {
    expect(
      parseMiseTaskConfigs({
        enabled: false,
        task: "check:swift",
        trackedExtensions: ["swift", ".SWIFT", ""],
        excludeGlobs: ["Generated/**", ""],
      }),
    ).toEqual([
      {
        enabled: false,
        name: null,
        task: "check:swift",
        trackedExtensions: [".swift"],
        excludeGlobs: ["Generated/**"],
      },
    ]);
  });

  test("configs array wins over legacy fields", () => {
    expect(
      parseMiseTaskConfigs({
        task: "legacy",
        trackedExtensions: [".legacy"],
        configs: [
          { name: "swift", task: "check:swift", trackedExtensions: [".swift"] },
          { task: "check:web", trackedExtensions: ["ts", "tsx"] },
        ],
      }),
    ).toEqual([
      {
        enabled: true,
        name: "swift",
        task: "check:swift",
        trackedExtensions: [".swift"],
        excludeGlobs: [],
      },
      {
        enabled: true,
        name: null,
        task: "check:web",
        trackedExtensions: [".ts", ".tsx"],
        excludeGlobs: [],
      },
    ]);
  });

  test("top-level enabled false disables configs array entries", () => {
    expect(
      parseMiseTaskConfigs({
        enabled: false,
        configs: [{ task: "check:web", trackedExtensions: ["ts"] }],
      }),
    ).toEqual([
      {
        enabled: false,
        name: null,
        task: "check:web",
        trackedExtensions: [".ts"],
        excludeGlobs: [],
      },
    ]);
  });

  test("asTrackedExtensions normalizes and dedupes", () => {
    expect(asTrackedExtensions(["ts", ".TS", "tsx", 1, ""])).toEqual([".ts", ".tsx"]);
  });
});
