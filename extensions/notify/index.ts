/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * How to use it: install this package with `pi install .` and keep the extension enabled.
 * Example: finish an agent run in Ghostty, Kitty, iTerm2, or Windows Terminal and
 * the terminal will show a "Pi" notification with "Ready for input".
 *
 * Supports multiple notification backends:
 * - AppleScript (`osascript`): macOS Ghostty only, native Notification Center + bundled sound
 * - OSC 777: Ghostty, iTerm2, WezTerm, rxvt-unicode
 * - OSC 99: Kitty
 * - Windows toast: Windows Terminal (WSL)
 *
 * macOS sound config:
 * - Plays `extensions/notify/assets/notification.mp3` with `afplay`
 * - CRUMBS_NOTIFY_SOUND=none disables the bundled sound
 */

import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CRUMBS_EVENT_USER_INPUT_REQUIRED } from "../shared/events.js";

const TITLE = "Pi";
const MAC_SOUND_FILE = fileURLToPath(new URL("./assets/notification.mp3", import.meta.url));

function isGhosttyTerminal(): boolean {
  if (process.env.TERM_PROGRAM?.toLowerCase() !== "ghostty") return false;

  const term = process.env.TERM?.toLowerCase() ?? "";
  if (term.includes("tmux") || term.includes("screen")) return false;

  if (process.env.TMUX) return false;
  if (process.env.STY) return false;
  if (process.env.ZELLIJ) return false;
  if (process.env.CMUX || process.env.CMUX_SESSION) return false;
  if (Object.keys(process.env).some((key) => key.startsWith("CMUX_"))) return false;

  return true;
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  // Kitty OSC 99: i=notification id, d=0 means not done yet, p=body for second part
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
  const type = "Windows.UI.Notifications";
  const script = [
    `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime] > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent([${type}.ToastTemplateType]::ToastText01)`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show([${type}.ToastNotification]::new($xml))`,
  ].join("; ");

  execFile("powershell.exe", ["-NoProfile", "-Command", script]);
}

function escapeAppleScriptString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

function playMacSound(): void {
  if (process.env.CRUMBS_NOTIFY_SOUND?.trim().toLowerCase() === "none") return;
  execFile("afplay", [MAC_SOUND_FILE]);
}

function notifyMac(title: string, body: string): void {
  execFile(
    "osascript",
    [
      "-e",
      `display notification "${escapeAppleScriptString(body)}" with title "${escapeAppleScriptString(title)}"`,
    ],
    (error) => {
      if (error) notifyOSC777(title, body);
    },
  );

  playMacSound();
}

function notify(title: string, body: string): void {
  if (process.platform === "darwin" && isGhosttyTerminal()) return notifyMac(title, body);
  if (process.env.WT_SESSION) return notifyWindows(title, body);
  if (process.env.KITTY_WINDOW_ID) return notifyOSC99(title, body);
  notifyOSC777(title, body);
}

export default function (pi: ExtensionAPI) {
  pi.events.on(CRUMBS_EVENT_USER_INPUT_REQUIRED, () => notify(TITLE, "Approval required"));
  pi.on("agent_end", () => notify(TITLE, "Ready for input"));
}
