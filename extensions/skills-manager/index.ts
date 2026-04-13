import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSkillsManagerCommand } from "./src/command.js";

export default function skillsManagerExtension(pi: ExtensionAPI): void {
  registerSkillsManagerCommand(pi);
}
