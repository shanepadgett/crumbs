/**
 * QnA Ledger Extension
 *
 * What it does: adds a `/qna` command that reconciles branch-local transcript
 * content into a hidden QnA ledger, then starts a scoped manual QnA loop when
 * unresolved questions remain.
 *
 * How to use it: run `/qna` in an interactive session after new user or
 * assistant chat. The command refreshes hidden branch-local QnA state, starts
 * the loop-scoped `qna` tool when needed, and exits cleanly when nothing
 * remains.
 *
 * Example:
 * 1) Chat until open questions or decisions appear.
 * 2) Run `/qna`.
 * 3) Use chat or the scoped `qna` tool to review unresolved items.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerQnaCommand } from "./qna/command.js";
import { getAttachedInterviewSessionIdFromBranch } from "./qna/interview-attachment.js";
import { QnaLoopController, registerQnaLoopLifecycle } from "./qna/loop-controller.js";
import { registerQnaTool } from "./qna/tool.js";

export default function qnaExtension(pi: ExtensionAPI): void {
  const loopController = new QnaLoopController(pi);
  loopController.handleSessionReset();

  registerQnaCommand(pi, {
    loopController,
    getAttachedInterviewSessionId: getAttachedInterviewSessionIdFromBranch,
  });
  registerQnaTool(pi, { loopController });
  registerQnaLoopLifecycle(pi, loopController);
}
