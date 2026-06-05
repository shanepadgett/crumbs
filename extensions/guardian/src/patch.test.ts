import { describe, expect, test } from "bun:test";
import { parseApplyPatchTargets } from "./patch.js";

describe("parseApplyPatchTargets", () => {
  test("extracts paths from all patch header kinds", () => {
    const parsed = parseApplyPatchTargets(`*** Begin Patch
*** Add File: added.ts
+new
*** Update File: updated.ts
-old
+new
*** Replace File: replaced.ts
+all new
*** Delete File: deleted.ts
*** End Patch`);

    expect(parsed.unparseable).toBe(false);
    expect(
      parsed.targets.map((target) => ({ path: target.path, operation: target.operation })),
    ).toEqual([
      { path: "added.ts", operation: "add" },
      { path: "updated.ts", operation: "update" },
      { path: "replaced.ts", operation: "replace" },
      { path: "deleted.ts", operation: "delete" },
    ]);
  });

  test("extracts move targets from update sections", () => {
    const parsed = parseApplyPatchTargets(`*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
-old
+new
*** End Patch`);

    expect(
      parsed.targets.map((target) => ({ path: target.path, operation: target.operation })),
    ).toEqual([
      { path: "old.ts", operation: "update" },
      { path: "new.ts", operation: "move" },
    ]);
  });

  test("counts added bytes", () => {
    const parsed = parseApplyPatchTargets(`*** Begin Patch
*** Add File: added.ts
+one
+two
*** End Patch`);

    expect(parsed.targets[0]?.byteSize).toBe(Buffer.byteLength("one\ntwo\n", "utf8"));
  });

  test("marks patches with no file headers as unparseable", () => {
    const parsed = parseApplyPatchTargets("not a patch");

    expect(parsed.unparseable).toBe(true);
    expect(parsed.targets).toEqual([]);
  });
});
