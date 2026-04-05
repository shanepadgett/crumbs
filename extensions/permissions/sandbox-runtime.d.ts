declare module "@anthropic-ai/sandbox-runtime" {
  export interface SandboxRuntimeConfig {
    network?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
    filesystem?: {
      denyRead?: string[];
      allowWrite?: string[];
      denyWrite?: string[];
    };
    ignoreViolations?: Record<string, string[]>;
    enableWeakerNestedSandbox?: boolean;
  }

  export const SandboxManager: {
    initialize(config: SandboxRuntimeConfig): Promise<void>;
    reset(): Promise<void>;
    wrapWithSandbox(command: string): Promise<string>;
  };

  export function getDefaultWritePaths(): string[];
}
