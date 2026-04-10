import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

interface PermissionScratchSpace {
  root: string;
  home: string;
  tmp: string;
  cache: string;
  state: string;
  data: string;
}

const DEFAULT_SANDBOX_TMPDIR = "/tmp/claude";

function trimTrailingSlash(value: string): string {
  if (value === "/") return value;
  return value.replace(/\/+$/, "");
}

export function getSandboxTempDir(): string {
  const configured = process.env.CLAUDE_TMPDIR?.trim();
  if (!configured) return DEFAULT_SANDBOX_TMPDIR;
  return trimTrailingSlash(configured);
}

function scopeHash(scopeKey: string): string {
  return createHash("sha1").update(scopeKey).digest("hex").slice(0, 12);
}

export function getSandboxScratchSpace(scopeKey = "default"): PermissionScratchSpace {
  const root = join(getSandboxTempDir(), "permissions", scopeHash(scopeKey));

  return {
    root,
    home: join(root, "home"),
    tmp: join(root, "tmp"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    data: join(root, "data"),
  };
}

export function getPackageManagerEnvironment(scopeKey?: string): Record<string, string> {
  const scratch = getSandboxScratchSpace(scopeKey);
  const npmCacheDir = join(scratch.cache, "npm-cache");

  return {
    HOME: scratch.home,
    TMPDIR: scratch.tmp,
    XDG_CACHE_HOME: scratch.cache,
    XDG_STATE_HOME: scratch.state,
    XDG_DATA_HOME: scratch.data,
    BUN_INSTALL_CACHE_DIR: join(scratch.cache, "bun-install-cache"),
    NPM_CONFIG_CACHE: npmCacheDir,
    npm_config_cache: npmCacheDir,
  };
}

export function ensurePackageManagerDirectories(scopeKey?: string): void {
  const scratch = getSandboxScratchSpace(scopeKey);
  const directories = new Set([
    scratch.root,
    scratch.home,
    scratch.tmp,
    scratch.cache,
    scratch.state,
    scratch.data,
    ...Object.values(getPackageManagerEnvironment(scopeKey)),
  ]);

  for (const directory of directories) {
    try {
      mkdirSync(directory, { recursive: true });
    } catch {
      // Best effort only. Commands can still create nested paths later.
    }
  }
}

export function wrapCommandWithPackageManagerEnvironment(command: string, args: string[]) {
  const env = getPackageManagerEnvironment();
  return {
    command: "env",
    args: [...Object.entries(env).map(([key, value]) => `${key}=${value}`), command, ...args],
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function formatCommandForDisplay(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}
