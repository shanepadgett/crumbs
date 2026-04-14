/**
 * Status Table Extension
 *
 * What it does:
 * - Replaces Pi's built-in footer with a status widget below the editor.
 * - Supports `full` and `minimal` display modes.
 * - Adds `/status-table` to toggle the widget or switch modes.
 *
 * How to use it:
 * - Run `/status-table` to toggle it on or off.
 * - Run `/status-table full` or `/status-table minimal` to switch modes.
 * - Reload Pi with `/reload` after editing this extension.
 *
 * Example:
 * - `/status-table minimal`
 * - `/status-table`
 */

export { default } from "./src/extension.js";
