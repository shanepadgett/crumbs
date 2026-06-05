import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { asObject, readJsonObject } from "../../shared/io/json-file.js";
import type { Scope } from "./types.js";

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function walk(cwd: string, limit = 500): Promise<string[]> {
  const found: string[] = [];
  async function visit(relative: string): Promise<void> {
    if (found.length >= limit) return;
    const dir = join(cwd, relative);
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if ([".git", "node_modules", "dist", "build", ".pi"].includes(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      found.push(next);
      if (entry.isDirectory()) await visit(next);
    }
  }
  await visit("");
  return found;
}

export async function detectPrimaryJsRuntime(cwd: string): Promise<"bun" | "node"> {
  const packageJson = asObject(await readJsonObject(join(cwd, "package.json")));
  const packageManager =
    typeof packageJson?.packageManager === "string" ? packageJson.packageManager : "";
  if (packageManager.startsWith("bun@")) return "bun";
  if ((await exists(join(cwd, "bun.lock"))) || (await exists(join(cwd, "bun.lockb")))) return "bun";
  return "node";
}

export async function detectScopes(cwd: string): Promise<Set<Scope>> {
  const files = await walk(cwd);
  const scopes = new Set<Scope>();
  if (
    (await exists(join(cwd, "package.json"))) ||
    (await exists(join(cwd, "tsconfig.json"))) ||
    (await exists(join(cwd, ".config/tsconfig.json"))) ||
    files.some((file) => [".js", ".jsx", ".ts", ".tsx"].includes(extname(file)))
  )
    scopes.add("ts");
  if (files.some((file) => extname(file) === ".md")) scopes.add("markdown");
  if (files.some((file) => [".yml", ".yaml"].includes(extname(file)))) scopes.add("yaml");
  if ((await exists(join(cwd, "go.mod"))) || files.some((file) => extname(file) === ".go"))
    scopes.add("go");
  if (
    (await exists(join(cwd, "Package.swift"))) ||
    files.some((file) => extname(file) === ".swift")
  )
    scopes.add("swift");
  if (files.some((file) => file.includes(".xcodeproj") || file.includes(".xcworkspace")))
    scopes.add("xcode");
  return scopes;
}
