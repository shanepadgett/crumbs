import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type Snapshot = Map<string, string>;

export type FailureGroup = {
  key: string;
  title: string;
  count: number;
  examples: string[];
};

export type ValidationRunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type QuietCheck = {
  id: string;
  title: string;
  isSupported(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean>;
  scanInputs(cwd: string): Promise<Snapshot>;
  run(pi: ExtensionAPI, ctx: ExtensionContext): Promise<ValidationRunResult>;
  parseFailureGroups(output: string): FailureGroup[];
};

export type QuietCheckProvider = {
  loadChecks(cwd: string): Promise<QuietCheck[]>;
};
