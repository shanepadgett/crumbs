import { Type } from "@sinclair/typebox";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  buildRuntimeRequestPaths,
  ensureRequestDirectory,
  resolveProjectRoot,
} from "./request-paths.js";
import type { QuestionRuntimeRequestStore } from "./request-store.js";

const EMPTY_PARAMS = Type.Object({});

function nextRequestId(existing: string[]): string {
  let max = 0;
  for (const requestId of existing) {
    const match = requestId.match(/^qr_(\d{4,})$/);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) max = Math.max(max, parsed);
  }
  return `qr_${String(max + 1).padStart(4, "0")}`;
}

function buildTemplate(): Record<string, unknown> {
  return {
    questions: [
      {
        questionId: "q_scope_01",
        kind: "freeform",
        prompt: "What scope do you want to lock first?",
        justification: "The runtime requires a justification block for every surfaced question.",
        suggestedAnswer: "Lock the smallest high-confidence slice that can be reviewed end to end.",
      },
    ],
  };
}

export function registerQuestionRuntimeRequestTool(
  pi: ExtensionAPI,
  store: QuestionRuntimeRequestStore,
  onRequestCreated: () => void,
): void {
  pi.registerTool({
    name: "question_runtime_request",
    label: "Question Runtime Request",
    description: "Issue an authorized question-runtime request ticket and path.",
    parameters: EMPTY_PARAMS,
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("question_runtime_request")), 0, 0);
    },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx: ExtensionContext) {
      const projectRoot = await resolveProjectRoot(pi.exec, ctx.cwd);
      await ensureRequestDirectory(projectRoot);
      const existingIds = store.getAllRecords().map((record) => record.requestId);
      const requestId = nextRequestId(existingIds);
      const paths = buildRuntimeRequestPaths(projectRoot, requestId);

      store.addPendingRequest({
        requestId,
        path: paths.absolutePath,
        projectRelativePath: paths.projectRelativePath,
      });

      onRequestCreated();

      const template = buildTemplate();
      return {
        content: [
          {
            type: "text",
            text: [
              `requestId: ${requestId}`,
              `path: ${paths.path}`,
              `projectRelativePath: ${paths.projectRelativePath}`,
            ].join("\n"),
          },
        ],
        details: {
          requestId,
          path: paths.path,
          projectRelativePath: paths.projectRelativePath,
          template,
        },
      };
    },
  });
}
