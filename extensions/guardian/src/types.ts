import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

export type ToolKind = "read_only" | "bash" | "file_mutation" | "unknown";
export type ConfigAction = "allow" | "block" | "prompt" | "autoApprove";
export type DecisionAction = "allow" | "block" | "prompt" | "guardian";
export type MutationOperation = "add" | "update" | "delete" | "replace" | "move";

export interface CompiledPattern {
  source: string;
  regex: RegExp;
}

export interface BashRule extends CompiledPattern {
  action: ConfigAction;
}

export interface MutationRule {
  paths: string[];
  pathRules: CompiledPattern[];
  action: ConfigAction;
}

export interface GuardianModelRef {
  provider: string;
  id: string;
  raw: string;
}

export interface GuardianConfig {
  mode: "off" | "gate";
  ignoreTools: string[];
  ignoreToolSet: ReadonlySet<string>;
  bash: {
    defaultAction: ConfigAction;
    rules: BashRule[];
  };
  mutation: {
    defaultAction: ConfigAction;
    rules: MutationRule[];
    blockPathRules: CompiledPattern[];
    allowOutsideWorkspace: boolean;
    maxBytes?: number;
  };
  unknownToolAction: ConfigAction;
  autoApprove: {
    enabled: boolean;
    model?: GuardianModelRef;
    reviewBash: boolean;
    reviewMutations: boolean;
    timeoutMs: number;
    maxTokens: number;
  };
}

export interface ClassifierResult {
  action: DecisionAction;
  reason: string;
  overridable: boolean;
}

export interface ResolvedTargetPath {
  raw: string;
  absolute: string;
  canonical: string;
  insideWorkspace: boolean;
  isProtected: boolean;
  operation?: MutationOperation;
  byteSize?: number;
}

export interface GateRequest {
  toolName: string;
  toolCallId: string;
  kind: ToolKind;
  cwd: string;
  command?: string;
  paths?: ResolvedTargetPath[];
  inputSummary: string;
  unparseablePatch?: boolean;
}

export type GuardianOutcome =
  | { outcome: "allow"; reason: string }
  | { outcome: "deny"; reason: string }
  | { outcome: "error"; reason: string };

export type ResolvedRequestAuth =
  | { ok: true; apiKey?: string; headers?: Record<string, string> }
  | { ok: false; error: string };

export type GuardianComplete = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface GuardianDeps {
  resolveModel: () => Promise<Model<Api> | undefined>;
  resolveAuth: (model: Model<Api>) => Promise<ResolvedRequestAuth>;
  complete: GuardianComplete;
  signal: AbortSignal | undefined;
}
