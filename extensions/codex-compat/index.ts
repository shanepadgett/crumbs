/**
 * Codex Compat Extension
 *
 * What it does: adds Codex-style patch/image tools and `/fast` priority toggle.
 * How to use it: select supported Codex-family model; use `apply_patch`, `view_image`, or `/fast`.
 * Example: `apply_patch({ input: "*** Begin Patch\n...\n*** End Patch" })`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import applyPatchExtension from "./src/apply-patch.js";
import fastExtension from "./src/fast.js";
import viewImageExtension from "./src/view-image.js";

export default function codexCompatExtension(pi: ExtensionAPI): void {
  applyPatchExtension(pi);
  viewImageExtension(pi);
  fastExtension(pi);
}
