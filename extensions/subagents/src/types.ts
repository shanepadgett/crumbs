export type AgentSource = "builtin" | "user" | "project" | "path";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentSpec {
  name: string;
  description: string;
  promptText: string;
  filePath: string;
  source: AgentSource;
  sourceDir: string;
  model?: string;
  thinkingLevel?: AgentThinkingLevel;
  tools?: string[];
}

export interface AgentIssue {
  level: "error" | "warning" | "info";
  message: string;
  filePath?: string;
  agentName?: string;
}

export interface AgentRegistry {
  agents: AgentSpec[];
  diagnostics: AgentIssue[];
  builtinDir: string;
  userDir: string;
  projectDir: string | null;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface ToolActivity {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  args?: string;
  preview?: string;
}

export interface RunResult {
  agent: string;
  source: AgentSource | "unknown";
  prompt: string;
  receivedHandoff?: string;
  task: string;
  cwd: string;
  output: string;
  stderr: string;
  exitCode: number;
  usage: Usage;
  model?: string;
  stopReason?: string;
  error?: string;
  done: boolean;
  activeTools: ToolActivity[];
  events: ToolActivity[];
  liveText?: string;
  durationMs?: number;
  debug?: Record<string, unknown>;
}

export interface WorkflowTask {
  agent: string;
  task: string;
  cwd?: string;
}

export type Workflow =
  | { mode: "single"; agent: string; task: string; cwd?: string }
  | { mode: "chain"; chain: WorkflowTask[] }
  | { mode: "parallel"; tasks: WorkflowTask[]; concurrency?: number };

export interface WorkflowResult {
  mode: Workflow["mode"];
  items: Array<{ agent: string; prompt: string }>;
  runs: RunResult[];
  output: string;
  usage: Usage;
  done?: number;
  total?: number;
  durationMs?: number;
  debug?: Record<string, unknown>;
}
