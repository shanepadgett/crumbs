import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fixturePath(importMetaUrl: string, relativePath: string): string {
  return fileURLToPath(new URL(relativePath, importMetaUrl));
}

export function readFixture(importMetaUrl: string, relativePath: string): string {
  return readFileSync(fixturePath(importMetaUrl, relativePath), "utf8").replace(/\r\n/g, "\n");
}
