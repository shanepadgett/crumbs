import { describe, expect, test } from "bun:test";
import { mergeCrumbsConfigs } from "./crumbs-merge.js";

describe("crumbs config merge", () => {
  test("legacy quietMiseTask arrays merge by union", () => {
    expect(
      mergeCrumbsConfigs(
        {
          extensions: {
            quietMiseTask: {
              trackedExtensions: ["swift"],
              excludeGlobs: ["Generated/**"],
            },
          },
        },
        {
          extensions: {
            quietMiseTask: {
              trackedExtensions: [".ts", ".swift"],
              excludeGlobs: ["dist/**"],
            },
          },
        },
      ),
    ).toEqual({
      extensions: {
        quietMiseTask: {
          trackedExtensions: [".swift", ".ts"],
          excludeGlobs: ["Generated/**", "dist/**"],
        },
      },
    });
  });

  test("project quietMiseTask configs replace global configs", () => {
    expect(
      mergeCrumbsConfigs(
        {
          extensions: {
            quietMiseTask: {
              configs: [{ name: "global", task: "check:global", trackedExtensions: [".swift"] }],
            },
          },
        },
        {
          extensions: {
            quietMiseTask: {
              configs: [{ name: "project", task: "check:project", trackedExtensions: [".ts"] }],
            },
          },
        },
      ),
    ).toEqual({
      extensions: {
        quietMiseTask: {
          configs: [{ name: "project", task: "check:project", trackedExtensions: [".ts"] }],
        },
      },
    });
  });

  test("project quietMiseTask configs replace global legacy fields", () => {
    expect(
      mergeCrumbsConfigs(
        {
          extensions: {
            quietMiseTask: {
              enabled: false,
              task: "check:global",
              trackedExtensions: [".swift"],
            },
          },
        },
        {
          extensions: {
            quietMiseTask: {
              configs: [{ name: "project", task: "check:project", trackedExtensions: [".ts"] }],
            },
          },
        },
      ),
    ).toEqual({
      extensions: {
        quietMiseTask: {
          configs: [{ name: "project", task: "check:project", trackedExtensions: [".ts"] }],
        },
      },
    });
  });

  test("project legacy quietMiseTask replaces global configs", () => {
    expect(
      mergeCrumbsConfigs(
        {
          extensions: {
            quietMiseTask: {
              configs: [{ name: "global", task: "check:global", trackedExtensions: [".swift"] }],
            },
          },
        },
        {
          extensions: {
            quietMiseTask: {
              task: "check:project",
              trackedExtensions: [".ts"],
            },
          },
        },
      ),
    ).toEqual({
      extensions: {
        quietMiseTask: {
          task: "check:project",
          trackedExtensions: [".ts"],
        },
      },
    });
  });
});
