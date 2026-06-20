import { describe, expect, test } from "bun:test";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import { resolveExtensionPathsForTools } from "./run.js";

function tool(name: string, path: string, source = "local"): ToolInfo {
  return {
    name,
    description: "",
    parameters: {} as ToolInfo["parameters"],
    sourceInfo: { path, source, scope: "user", origin: "top-level" },
  };
}

describe("resolveExtensionPathsForTools", () => {
  test("returns only reloadable extension paths for requested tools", () => {
    expect(
      resolveExtensionPathsForTools(
        ["read", "websearch", "webfetch", "custom"],
        [
          tool("read", "<builtin:read>", "builtin"),
          tool("websearch", "/extensions/web/index.ts"),
          tool("webfetch", "/extensions/web/index.ts"),
          tool("custom", "<sdk:custom>", "sdk"),
          tool("unrequested", "/extensions/other/index.ts"),
        ],
      ),
    ).toEqual(["/extensions/web/index.ts"]);
  });

  test("returns no paths when requested tools or parent tool inventory are absent", () => {
    expect(resolveExtensionPathsForTools(undefined, [tool("websearch", "/web.ts")])).toEqual([]);
    expect(resolveExtensionPathsForTools(["websearch"], undefined)).toEqual([]);
  });
});
