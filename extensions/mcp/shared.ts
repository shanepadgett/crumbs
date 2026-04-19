import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CavemanEnhancement } from "../caveman/src/system-prompt.js";

export type LifecycleMode = "lazy" | "eager";
export type TransportMode = "stdio" | "http";

export interface ToolPolicyConfig {
  enabled?: boolean;
}

export interface RawServerConfig {
  enabled?: boolean;
  requiresCavemanPower?: CavemanEnhancement;
  lifecycle?: "lazy" | "eager";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  serverUrl?: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  bearerTokenEnv?: string;
  tools?: Record<string, ToolPolicyConfig>;
}

export type ServerSourceKind = "global" | "project" | "crumbs-root" | "crumbs-extension";

export interface ServerConfigRecord {
  name: string;
  filePath: string;
  sourceKind: ServerSourceKind;
  raw: RawServerConfig;
  config: ServerConfig | null;
}

export interface ServerConfig {
  mode: TransportMode;
  lifecycle: LifecycleMode;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  bearerTokenEnv?: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpClient {
  connect(name: string, config: ServerConfig): Promise<void>;
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
  readonly connected: boolean;
}

export interface ServerState {
  client: McpClient;
  config: ServerConfig;
  tools: McpTool[];
  lastError?: string;
}

export interface CavemanGateState {
  enabled: boolean;
  enhancements: CavemanEnhancement[];
}

export const LOG_PREFIX = "[mcp]";

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isServerAllowedByCaveman(raw: RawServerConfig, caveman: CavemanGateState): boolean {
  return (
    !raw.requiresCavemanPower ||
    (caveman.enabled && caveman.enhancements.includes(raw.requiresCavemanPower))
  );
}

export function resolveTemplate(input: string): string {
  return input.replace(/\$\{(\w+)\}/g, (_m, key) => process.env[key] ?? "");
}

export function resolveRecord(input?: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    output[key] = resolveTemplate(value);
  }
  return output;
}
