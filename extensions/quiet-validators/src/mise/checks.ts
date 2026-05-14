import type { QuietCheck, QuietCheckProvider } from "../core/types.js";
import { loadMiseTaskConfigs, type MiseTaskConfig } from "./config.js";
import { parseMiseFailureGroups } from "./failures.js";
import { canRunMiseTask, runMiseTask } from "./run.js";
import { scanMiseInputs } from "./scan.js";

function labelForConfig(config: MiseTaskConfig): string {
  return config.name ?? config.task;
}

function safeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-");
}

export function buildMiseCheck(config: MiseTaskConfig, index: number): QuietCheck {
  const label = labelForConfig(config);
  const id = `quiet-mise-task:${index}:${safeIdPart(label) || "task"}`;
  const title = `mise task: ${label}`;

  return {
    id,
    title,
    async isSupported(pi, ctx) {
      return (
        config.enabled &&
        config.trackedExtensions.length > 0 &&
        (await canRunMiseTask(pi, config.task, ctx.signal))
      );
    },
    async scanInputs(cwd) {
      return scanMiseInputs(cwd, config);
    },
    async run(pi, ctx) {
      return runMiseTask(pi, ctx, config.task);
    },
    parseFailureGroups(output) {
      return parseMiseFailureGroups(output);
    },
  };
}

export const miseTaskProvider: QuietCheckProvider = {
  async loadChecks(cwd) {
    const configs = await loadMiseTaskConfigs(cwd);
    return configs.map((config, index) => buildMiseCheck(config, index));
  },
};
