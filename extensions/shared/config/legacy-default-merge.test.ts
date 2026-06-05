import { describe, expect, test } from "bun:test";
import { mergeLegacyWithDefault } from "./legacy-default-merge.js";

describe("legacy/default config merge", () => {
  test("default config deep-overrides legacy config without unioning arrays", () => {
    expect(
      mergeLegacyWithDefault(
        {
          extensions: {
            quietMiseTask: {
              trackedExtensions: [".swift"],
              enabled: false,
            },
          },
        },
        {
          extensions: {
            quietMiseTask: {
              trackedExtensions: [".ts"],
            },
          },
        },
      ),
    ).toEqual({
      extensions: {
        quietMiseTask: {
          trackedExtensions: [".ts"],
          enabled: false,
        },
      },
    });
  });
});
