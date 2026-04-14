import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@mariozechner/pi-tui";

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

type ValidatorSummaryStatus = "passed" | "failed";

type ValidatorSummaryEntry = {
  title: string;
  status: ValidatorSummaryStatus;
};

type ValidationBatch = {
  expected: Set<string>;
  completed: Set<string>;
  ran: ValidatorSummaryEntry[];
};

export type QuietValidatorDefinition<TConfig> = {
  id: string;
  customMessageType: string;
  title: string;
  loadConfig(cwd: string): Promise<TConfig>;
  isSupported(pi: ExtensionAPI, ctx: ExtensionContext, config: TConfig): Promise<boolean>;
  scanInputs(cwd: string, config: TConfig): Promise<Snapshot>;
  run(pi: ExtensionAPI, ctx: ExtensionContext, config: TConfig): Promise<ValidationRunResult>;
  getValidatingMessage(config: TConfig): string;
  getPassedMessage(changedCount: number, config: TConfig): string;
  parseFailureGroups(output: string, config: TConfig): FailureGroup[];
};

const registeredValidatorIds = new Set<string>();
const validationBatches = new Map<string, ValidationBatch>();

function getBatchKey(cwd: string, scope: string): string {
  return `${cwd}::${scope}`;
}

function beginValidationBatch(cwd: string, scope: string): void {
  const key = getBatchKey(cwd, scope);
  if (validationBatches.has(key)) return;

  validationBatches.set(key, {
    expected: new Set(registeredValidatorIds),
    completed: new Set(),
    ran: [],
  });
}

function renderValidationSummary(entries: ValidatorSummaryEntry[]): string {
  const lines = ["Validation:", "", ...entries.map((entry) => `${entry.title} - ${entry.status}`)];
  return lines.join("\n");
}

function finishValidationBatch(
  cwd: string,
  scope: string,
  validatorId: string,
  entry: ValidatorSummaryEntry | null,
  ctx: ExtensionContext,
): void {
  const key = getBatchKey(cwd, scope);
  const batch = validationBatches.get(key);
  if (!batch) return;

  batch.completed.add(validatorId);
  if (entry) batch.ran.push(entry);
  if (batch.completed.size < batch.expected.size) return;

  validationBatches.delete(key);
  if (!ctx.hasUI || batch.ran.length === 0) return;
  ctx.ui.notify(renderValidationSummary(batch.ran), "info");
}

function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changed = new Set<string>();

  for (const [file, signature] of before) {
    if (after.get(file) !== signature) changed.add(file);
  }

  for (const file of after.keys()) {
    if (!before.has(file)) changed.add(file);
  }

  return [...changed].sort();
}

function buildValidationSignature(snapshot: Snapshot, changedFiles: string[]): string {
  return changedFiles.map((file) => `${file}:${snapshot.get(file) ?? "<deleted>"}`).join("|");
}

function buildFailureContent(
  title: string,
  changedFiles: string[],
  failureGroups: FailureGroup[],
  output: string,
): string {
  const fileLines = changedFiles
    .slice(0, 12)
    .map((file) => `- ${file}`)
    .join("\n");
  const extraCount = Math.max(0, changedFiles.length - 12);
  const extraLine = extraCount > 0 ? `\n- ... and ${extraCount} more` : "";
  const groupLines = failureGroups
    .map((group) => {
      const headline = `- ${group.title}: ${group.count}`;
      const example = group.examples.find((line) => line.trim().length > 0);
      if (!example) return headline;
      return `${headline}\n  • ${example}`;
    })
    .join("\n");

  const excerptLines = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);

  const excerpt = excerptLines.length > 0 ? excerptLines.join("\n") : "(no captured output)";

  return [
    `${title} failed after validator-relevant file changes.`,
    "Fix the reported failures before continuing.",
    "",
    "Changed files:",
    fileLines + extraLine,
    "",
    "Failure groups:",
    groupLines || "- Validation: 1",
    "",
    "Failure excerpt:",
    excerpt,
  ].join("\n");
}

function buildExpandedOutput(
  changedFiles: string[],
  failureGroups: FailureGroup[],
  output: string,
): string {
  const lines: string[] = [];

  if (changedFiles.length > 0) {
    lines.push("Changed files:");
    lines.push(...changedFiles.map((file) => `- ${file}`));
  }

  if (failureGroups.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Failure groups:");
    for (const group of failureGroups) {
      lines.push(`- ${group.title} (${group.count})`);
      for (const example of group.examples) {
        lines.push(`  • ${example}`);
      }
    }
  }

  if (output.trim()) {
    if (lines.length > 0) lines.push("");
    lines.push("Raw output:");
    lines.push(output.trimEnd());
  }

  return lines.join("\n");
}

export function createFallbackFailureGroups(title: string, output: string): FailureGroup[] {
  if (!output.trim()) {
    return [{ key: title.toLowerCase(), title, count: 1, examples: [] }];
  }

  return [
    {
      key: title.toLowerCase(),
      title,
      count: 1,
      examples: [output.trim().split(/\r?\n/)[0] ?? title],
    },
  ];
}

export function registerQuietValidator<TConfig>(
  pi: ExtensionAPI,
  definition: QuietValidatorDefinition<TConfig>,
): void {
  registeredValidatorIds.add(definition.id);

  let config: TConfig | null = null;
  let isSupported = false;
  let validationBaseline: Snapshot = new Map();
  let turnStartSnapshot: Snapshot = new Map();
  let validationInFlight = false;
  let dirty = false;
  let lastAttemptedSignature: string | null = null;

  async function runValidation(ctx: ExtensionContext, scope: string): Promise<void> {
    if (!isSupported || !config || validationInFlight || !dirty) {
      finishValidationBatch(ctx.cwd, scope, definition.id, null, ctx);
      return;
    }

    const current = await definition.scanInputs(ctx.cwd, config);
    const changedFiles = diffSnapshots(validationBaseline, current);
    if (changedFiles.length === 0) {
      validationBaseline = current;
      dirty = false;
      lastAttemptedSignature = null;
      finishValidationBatch(ctx.cwd, scope, definition.id, null, ctx);
      return;
    }

    const validationSignature = buildValidationSignature(current, changedFiles);
    if (validationSignature === lastAttemptedSignature) {
      finishValidationBatch(ctx.cwd, scope, definition.id, null, ctx);
      return;
    }

    validationInFlight = true;
    lastAttemptedSignature = validationSignature;
    if (ctx.hasUI) ctx.ui.notify(definition.getValidatingMessage(config), "info");

    try {
      const result = await definition.run(pi, ctx, config);
      if (result.code === 0) {
        validationBaseline = current;
        dirty = false;
        lastAttemptedSignature = null;
        finishValidationBatch(
          ctx.cwd,
          scope,
          definition.id,
          { title: definition.title, status: "passed" },
          ctx,
        );
        return;
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const failureGroups = definition.parseFailureGroups(output, config);
      const message = {
        customType: definition.customMessageType,
        content: buildFailureContent(definition.title, changedFiles, failureGroups, output),
        display: true,
        details: {
          changedFiles,
          exitCode: result.code,
          failureGroups,
          output,
          title: definition.title,
        },
      };

      if (ctx.isIdle()) {
        pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true });
      } else {
        pi.sendMessage(message, { deliverAs: "steer" });
      }

      finishValidationBatch(
        ctx.cwd,
        scope,
        definition.id,
        { title: definition.title, status: "failed" },
        ctx,
      );
    } finally {
      validationInFlight = false;
    }
  }

  pi.registerMessageRenderer<{
    changedFiles?: string[];
    exitCode?: number;
    failureGroups?: FailureGroup[];
    output?: string;
    title?: string;
  }>(definition.customMessageType, (message, options, theme) => {
    const details = message.details ?? {};
    const exitCode =
      typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
        ? details.exitCode
        : undefined;
    const failureGroups = Array.isArray(details.failureGroups) ? details.failureGroups : [];
    const status = [
      theme.fg("warning", "failed"),
      exitCode !== undefined ? theme.fg("muted", `(exit ${exitCode})`) : "",
      theme.fg("muted", `${failureGroups.length} group(s)`),
      !options.expanded
        ? theme.fg("muted", `(${keyHint("app.tools.expand", "to expand")})`)
        : theme.fg("muted", `(${keyHint("app.tools.expand", "to collapse")})`),
    ]
      .filter(Boolean)
      .join(" ");

    const root = new Container();
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    root.addChild(box);

    const label = theme.fg("customMessageLabel", `\x1b[1m[${message.customType}]\x1b[22m`);
    box.addChild(new Text(label, 0, 0));
    box.addChild(new Spacer(1));
    box.addChild(
      new Text([theme.fg("toolTitle", theme.bold(definition.title)), status].join(" "), 0, 0),
    );

    for (const group of failureGroups) {
      box.addChild(new Text(theme.fg("toolOutput", `- ${group.title}: ${group.count}`), 0, 0));
    }

    if (!options.expanded) return root;

    const changedFiles = Array.isArray(details.changedFiles) ? details.changedFiles : [];
    const output = typeof details.output === "string" ? details.output : "";
    const expandedOutput = buildExpandedOutput(changedFiles, failureGroups, output);
    if (expandedOutput) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(theme.fg("toolOutput", expandedOutput), 0, 0));
    }

    return root;
  });

  pi.on("agent_start", async (_event, ctx) => {
    config = await definition.loadConfig(ctx.cwd);
    isSupported = !!config && (await definition.isSupported(pi, ctx, config));
    validationInFlight = false;
    dirty = false;
    lastAttemptedSignature = null;

    if (!isSupported || !config) {
      validationBaseline = new Map();
      turnStartSnapshot = new Map();
      return;
    }

    validationBaseline = await definition.scanInputs(ctx.cwd, config);
    turnStartSnapshot = validationBaseline;
  });

  pi.on("turn_start", async (_event, ctx) => {
    if (!isSupported || !config) return;
    turnStartSnapshot = await definition.scanInputs(ctx.cwd, config);
  });

  pi.on("turn_end", async (event, ctx) => {
    beginValidationBatch(ctx.cwd, "turn_end");

    if (!isSupported || !config) {
      finishValidationBatch(ctx.cwd, "turn_end", definition.id, null, ctx);
      return;
    }

    const current = await definition.scanInputs(ctx.cwd, config);
    if (diffSnapshots(turnStartSnapshot, current).length > 0) dirty = true;

    if (event.toolResults.length > 0) {
      finishValidationBatch(ctx.cwd, "turn_end", definition.id, null, ctx);
      return;
    }

    await runValidation(ctx, "turn_end");
  });

  pi.on("agent_end", async (_event, ctx) => {
    beginValidationBatch(ctx.cwd, "agent_end");

    if (!isSupported || !config) {
      finishValidationBatch(ctx.cwd, "agent_end", definition.id, null, ctx);
      return;
    }

    await runValidation(ctx, "agent_end");
  });
}
