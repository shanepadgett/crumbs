import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function gitLines(args: string[]): string[] {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(): string[] {
  return Array.from(
    new Set([
      ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
      ...gitLines(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ).sort();
}

function isTestFile(path: string): boolean {
  return path.endsWith(".test.ts") || path.endsWith(".spec.ts");
}

function isFullSuiteTrigger(path: string): boolean {
  return (
    path === "package.json" ||
    path === "bun.lock" ||
    path === "tsconfig.json" ||
    path === ".mise/tasks/test" ||
    path === ".mise/tasks/test_targeted" ||
    path === "scripts/targeted-tests.ts" ||
    path.startsWith("extensions/test-support/") ||
    path.startsWith("extensions/shared/")
  );
}

function extensionRoot(path: string): string | undefined {
  const parts = path.split("/");
  if (parts[0] !== "extensions" || !parts[1]) return undefined;
  if (parts[1] === "test-support" || parts[1] === "shared") return undefined;
  return `${parts[0]}/${parts[1]}`;
}

function colocatedTests(path: string): string[] {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts") || isTestFile(path)) return [];
  const base = path.slice(0, -".ts".length);
  return [`${base}.test.ts`, `${base}.spec.ts`].filter((candidate) => existsSync(candidate));
}

function chooseTargets(files: string[]): string[] | undefined {
  if (files.length === 0) return undefined;
  if (files.some(isFullSuiteTrigger)) return undefined;

  const targets = new Set<string>();

  for (const file of files) {
    if (isTestFile(file)) {
      targets.add(file);
      continue;
    }

    const colocated = colocatedTests(file);
    if (colocated.length > 0) {
      for (const testPath of colocated) targets.add(testPath);
      continue;
    }

    const root = extensionRoot(file);
    if (root) targets.add(root);
  }

  return targets.size > 0 ? Array.from(targets).sort() : undefined;
}

const files = changedFiles();
const targets = chooseTargets(files);
const args = targets ? ["test", ...targets] : ["test"];

console.log(targets ? `Targeted tests: ${targets.join(" ")}` : "Targeted tests: full suite");

const result = spawnSync("bun", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
