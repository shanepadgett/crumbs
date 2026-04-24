import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { withTempDir } from "../../test-support/temp-dir.js";
import { applyPatch } from "./patch-executor.js";

describe("applyPatch", () => {
  test("applies add, update, delete, and move operations in a temp directory", async () => {
    await withTempDir("crumbs-apply-patch-", async (dir) => {
      await writeFile(join(dir, "existing.md"), "alpha\nold\nomega\n", "utf8");
      await writeFile(join(dir, "remove.md"), "remove me\n", "utf8");
      await writeFile(join(dir, "old-name.md"), "title\nold body\n", "utf8");

      const summary = await applyPatch(
        dir,
        `*** Begin Patch
*** Add File: added.md
+fresh
*** Update File: existing.md
@@
 alpha
-old
+new
 omega
*** Delete File: remove.md
*** Update File: old-name.md
*** Move to: new-name.md
@@
 title
-old body
+new body
*** End Patch`,
      );

      expect(summary.status).toBe("completed");
      expect(summary.added).toEqual(["added.md"]);
      expect(summary.updated).toEqual(["existing.md", "old-name.md"]);
      expect(summary.deleted).toEqual(["remove.md"]);
      expect(summary.moved).toEqual([{ from: "old-name.md", to: "new-name.md" }]);
      expect(await readFile(join(dir, "added.md"), "utf8")).toBe("fresh\n");
      expect(await readFile(join(dir, "existing.md"), "utf8")).toBe("alpha\nnew\nomega\n");
      expect(await readFile(join(dir, "new-name.md"), "utf8")).toBe("title\nnew body\n");
    });
  });

  test("reports failed update context without mutating unmatched file", async () => {
    await withTempDir("crumbs-apply-patch-", async (dir) => {
      await writeFile(join(dir, "existing.md"), "alpha\nold\nomega\n", "utf8");

      const summary = await applyPatch(
        dir,
        `*** Begin Patch
*** Update File: existing.md
@@
-missing
+new
*** End Patch`,
      );

      expect(summary.status).toBe("failed");
      expect(summary.failures.map((failure) => failure.message)).toEqual(["could not match"]);
      expect(await readFile(join(dir, "existing.md"), "utf8")).toBe("alpha\nold\nomega\n");
    });
  });
});
