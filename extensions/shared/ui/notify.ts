import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export type NotifyLevel = "info" | "warning" | "error";

export function notifyDeferred(
  ctx: Pick<ExtensionCommandContext, "ui">,
  message: string,
  level: NotifyLevel,
  delayMs = 0,
): void {
  if (delayMs <= 0) {
    ctx.ui.notify(message, level);
    return;
  }

  setTimeout(() => ctx.ui.notify(message, level), delayMs);
}

export function notifyForSessionStart(
  ctx: Pick<ExtensionCommandContext, "ui">,
  reason: string,
  message: string,
  level: NotifyLevel,
  reloadDelayMs = 50,
): void {
  notifyDeferred(ctx, message, level, reason === "reload" ? reloadDelayMs : 0);
}
