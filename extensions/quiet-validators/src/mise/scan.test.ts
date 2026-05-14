import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { MiseTaskConfig } from "./config.js";
import { scanMiseInputs, shouldSkipDirectory, shouldTrackPath } from "./scan.js";

function config(overrides: Partial<MiseTaskConfig> = {}): MiseTaskConfig {
  return {
    enabled: true,
    name: null,
    task: "check",
    trackedExtensions: [".ts"],
    excludeGlobs: [],
    ...overrides,
  };
}

describe("mise input scanning", () => {
  test("shouldTrackPath respects tracked extensions and exclude globs", () => {
    const taskConfig = config({ trackedExtensions: [".ts", ".tsx"], excludeGlobs: ["dist/**"] });

    expect(shouldTrackPath("src/app.ts", taskConfig)).toBe(true);
    expect(shouldTrackPath("src/app.swift", taskConfig)).toBe(false);
    expect(shouldTrackPath("dist/app.ts", taskConfig)).toBe(false);
  });

  test("shouldSkipDirectory probes exclude globs", () => {
    expect(shouldSkipDirectory("dist", config({ excludeGlobs: ["dist/**"] }))).toBe(true);
    expect(shouldSkipDirectory("src", config({ excludeGlobs: ["dist/**"] }))).toBe(false);
  });

  test("scanMiseInputs captures only matching files", async () => {
    const root = await mkdtemp(join(tmpdir(), "quiet-mise-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "dist"), { recursive: true });
      await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(root, "src", "app.ts"), "app");
      await writeFile(join(root, "src", "app.swift"), "app");
      await writeFile(join(root, "dist", "built.ts"), "built");
      await writeFile(join(root, "node_modules", "pkg", "index.ts"), "pkg");

      const snapshot = await scanMiseInputs(
        root,
        config({ trackedExtensions: [".ts"], excludeGlobs: ["dist/**"] }),
      );

      expect([...snapshot.keys()]).toEqual(["src/app.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
