import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  globToRegExp,
  matchesProtectedPath,
  resolveCanonicalWorkspace,
  resolveTargetPath,
} from "./paths.js";
import type { CompiledPattern } from "./types.js";

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "guardian-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export {};\n", "utf8");
  return root;
}

async function removeRoots(roots: string[]): Promise<void> {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

function rule(source: string): CompiledPattern {
  return { source, regex: globToRegExp(source) };
}

describe("path policy", () => {
  test("canonicalizes existing and non-existing workspace paths", async () => {
    const root = await tempRepo();
    try {
      const canonical = await resolveCanonicalWorkspace(root);

      const existing = await resolveTargetPath(root, canonical, "src/app.ts", []);
      const created = await resolveTargetPath(root, canonical, "src/new.ts", []);

      expect(existing.insideWorkspace).toBe(true);
      expect(existing.canonical.endsWith("/src/app.ts")).toBe(true);
      expect(created.insideWorkspace).toBe(true);
      expect(created.canonical.endsWith("/src/new.ts")).toBe(true);
    } finally {
      await removeRoots([root]);
    }
  });

  test("detects outside-workspace targets", async () => {
    const root = await tempRepo();
    const outside = await mkdtemp(join(tmpdir(), "guardian-outside-"));
    try {
      const canonical = await resolveCanonicalWorkspace(root);

      const target = await resolveTargetPath(root, canonical, join(outside, "file.txt"), []);

      expect(target.insideWorkspace).toBe(false);
    } finally {
      await removeRoots([root, outside]);
    }
  });

  test("matches protected globs", () => {
    const rules = [rule(".git"), rule(".git/**"), rule("*.env"), rule("nested/**")];

    expect(matchesProtectedPath(".git", rules)).toBe(true);
    expect(matchesProtectedPath(".git/config", rules)).toBe(true);
    expect(matchesProtectedPath(".env", rules)).toBe(true);
    expect(matchesProtectedPath("src/.env", rules)).toBe(false);
    expect(matchesProtectedPath("nested/deep/file.txt", rules)).toBe(true);
    expect(matchesProtectedPath("src/app.ts", rules)).toBe(false);
  });

  test("supports double-star across zero or more segments", () => {
    const envRule = rule("**/*.env");
    const testRule = rule("src/**/config.ts");

    expect(matchesProtectedPath(".env", [envRule])).toBe(true);
    expect(matchesProtectedPath("src/.env", [envRule])).toBe(true);
    expect(matchesProtectedPath("src/config.ts", [testRule])).toBe(true);
    expect(matchesProtectedPath("src/deep/config.ts", [testRule])).toBe(true);
  });
});
