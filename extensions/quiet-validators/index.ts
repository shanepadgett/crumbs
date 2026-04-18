import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerQuietValidator } from "./core.js";
import { markdownlintValidator } from "./markdownlint.js";
import { miseTaskValidator } from "./mise-task.js";
import { xcodeBuildValidator } from "./xcode-build.js";

const QUIET_VALIDATORS_PROMPT = [
  "Quiet validators run automatically in background for supported checks after relevant file changes.",
  "Do not manually run validation or checker commands unless user explicitly asks in current turn.",
  "This includes tests, lint, typecheck, build verification, formatting checks, markdownlint, and similar repo validation commands.",
  "Do not announce that you are skipping manual checks unless user asks.",
  "Assume quiet validators report failures separately. Only react when failure output appears in conversation or user explicitly requests manual validation.",
].join("\n");

// Runs background validators and tells agent to avoid duplicate manual checks.
export default function quietValidatorsExtension(pi: ExtensionAPI): void {
  registerQuietValidator(pi, markdownlintValidator);
  registerQuietValidator(pi, miseTaskValidator);
  registerQuietValidator(pi, xcodeBuildValidator);

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${QUIET_VALIDATORS_PROMPT}`,
    };
  });
}
