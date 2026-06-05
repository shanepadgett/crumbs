import { homedir } from "node:os";
import { join } from "node:path";

export function getDefaultGlobalSubagentsDir(): string {
  return join(homedir(), ".agents", "crumbs", "agents");
}

export function getLegacyGlobalSubagentsDir(): string {
  return join(homedir(), ".pi", "crumbs", "agents");
}

export function getDefaultProjectSubagentsDir(projectRoot: string): string {
  return join(projectRoot, ".agents", "crumbs", "agents");
}

export function getLegacyProjectSubagentsDir(projectRoot: string): string {
  return join(projectRoot, ".pi", "crumbs", "agents");
}

export function getDefaultGlobalMcpPath(): string {
  return join(homedir(), ".agents", "crumbs", "mcp.json");
}

export function getLegacyGlobalMcpPath(): string {
  return join(homedir(), ".pi", "agent", "mcp.json");
}

export function getDefaultProjectMcpPath(projectRoot: string): string {
  return join(projectRoot, ".agents", "crumbs", "mcp.json");
}

export function getLegacyProjectMcpPath(projectRoot: string): string {
  return join(projectRoot, ".pi", "mcp.json");
}

export function getDefaultMcpToolCachePath(): string {
  return join(homedir(), ".agents", "crumbs", "cache", "mcp-tools-cache.json");
}
