import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerQuietValidationEngine } from "./core/engine.js";
import { miseTaskProvider } from "./mise/checks.js";
import { registerPromptGuidance } from "./prompt-guidance.js";

// Runs configured mise tasks after relevant file changes and reports failures quietly.
export default function quietValidatorsExtension(pi: ExtensionAPI): void {
  registerQuietValidationEngine(pi, miseTaskProvider);
  registerPromptGuidance(pi);
}
