/**
 * Skills Manager Extension
 *
 * What it does: adds `/skills-manager` for managing Pi skills.
 * How to use it: run `/skills-manager` to inspect or change skill state.
 * Example: `/skills-manager`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSkillsManagerCommand } from "./src/command.js";

export default function skillsManagerExtension(pi: ExtensionAPI): void {
  registerSkillsManagerCommand(pi);
}
