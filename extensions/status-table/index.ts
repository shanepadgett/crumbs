/**
 * Status Table Extension
 *
 * What it does:
 * - Replaces Pi's built-in footer with a status widget below the editor.
 * - Shows git, model, path, flags, context, and token status in single compact layout.
 * - Adds `/status-table` to toggle widget and `/status-table config` to pick visible blocks.
 *
 * How to use it:
 * - Run `/status-table` to toggle it on or off.
 * - Run `/status-table config` to choose visible blocks.
 * - Reload Pi with `/reload` after editing this extension.
 */

export { default } from "./src/extension.js";
