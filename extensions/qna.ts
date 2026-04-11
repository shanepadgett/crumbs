/**
 * QnA Ledger Extension
 *
 * What it does: adds a `/qna` command that reconciles new branch-local chat
 * transcript content into a hidden QnA ledger with a durable scan boundary.
 *
 * How to use it: run `/qna` in an interactive session after new user or
 * assistant chat. The command updates hidden branch-local QnA state and shows a
 * short summary notification.
 *
 * Example:
 * 1) Chat until open questions or decisions appear.
 * 2) Run `/qna`.
 * 3) Run `/qna` again later to reconcile only newer transcript content.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerQnaCommand } from "./qna/command.js";

export default function qnaExtension(pi: ExtensionAPI): void {
  registerQnaCommand(pi);
}
