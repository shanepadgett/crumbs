import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const QUIET_VALIDATORS_PROMPT = [
  "Quiet mise tasks run automatically in background after relevant file changes.",
  "Do not manually run validation or checker commands unless user explicitly asks in current turn.",
  "This includes tests, lint, typecheck, build verification, formatting checks, and similar repo validation commands.",
  "Do not announce that you are skipping manual checks unless user asks.",
  "Assume quiet validators report failures separately. Only react when failure output appears in conversation or user explicitly requests manual validation.",
].join("\n");

export function registerPromptGuidance(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${QUIET_VALIDATORS_PROMPT}`,
    };
  });
}
