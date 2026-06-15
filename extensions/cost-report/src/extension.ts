import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { COST_REPORT_USAGE, parseCostReportArgs } from "./args.js";
import { buildCostReport } from "./analyze.js";
import { renderCostReportHtml } from "./html.js";
import type { CostReportCommandOptions } from "./args.js";

const COMMAND = "cost-report";
const COMMAND_DESCRIPTION = "Generate static HTML cost report from Pi sessions";

export default function costReportExtension(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND, {
    description: COMMAND_DESCRIPTION,
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      let options: CostReportCommandOptions;
      try {
        options = parseCostReportArgs(args);
      } catch (error) {
        ctx.ui.notify(errorMessage(error), "error");
        return;
      }

      if (options.help) {
        ctx.ui.notify(COST_REPORT_USAGE, "info");
        return;
      }

      ctx.ui.setStatus(COMMAND, "scanning sessions…");
      ctx.ui.setWorkingMessage("Building cost report…");

      try {
        const report = await buildCostReport({
          cwd: ctx.cwd,
          includePrompts: options.includePrompts,
          onProgress: (loaded, total) => {
            ctx.ui.setStatus(COMMAND, `sessions ${loaded}/${total}`);
          },
          range: options.range,
          scope: options.scope,
        });
        const outputPath = outputReportPath(options);
        await writeReport(outputPath, renderCostReportHtml(report));

        if (options.open) await openReport(pi, ctx, outputPath);

        ctx.ui.notify(
          `Cost report written: ${outputPath}\n${report.summary.includedSessions} sessions · ${report.summary.turns} turns · ${formatCost(report.summary.usage.cost.total)}`,
          "info",
        );
      } catch (error) {
        ctx.ui.notify(`Unable to build cost report: ${errorMessage(error)}`, "error");
      } finally {
        ctx.ui.setStatus(COMMAND, undefined);
        ctx.ui.setWorkingMessage();
      }
    },
  });
}

async function writeReport(path: string, html: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, html, "utf8");
}

function outputReportPath(options: CostReportCommandOptions): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(
    homedir(),
    ".pi",
    "agent",
    "reports",
    "cost-report",
    `pi-cost-${options.range.slug}-${options.scope}-${timestamp}.html`,
  );
}

async function openReport(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  path: string,
): Promise<void> {
  const command = openCommand(path);
  const result = await pi.exec(command.command, command.args, {
    signal: ctx.signal,
    timeout: 5_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `open command failed with exit ${result.code}`);
  }
}

function openCommand(path: string): { args: string[]; command: string } {
  if (process.platform === "darwin") return { command: "open", args: [path] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", path] };
  return { command: "xdg-open", args: [path] };
}

function formatCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
