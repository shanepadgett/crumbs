import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { RuntimeStatus } from "./types.js";

export function renderStatus(runtime: RuntimeStatus): string {
  return `perm: ${runtime.modeLabel} · net: ${runtime.networkMode} · sbx: ${runtime.sandboxState}`;
}

export function syncStatus(ctx: ExtensionContext, runtime: RuntimeStatus, enabled: boolean) {
  if (!enabled) {
    ctx.ui.setStatus("permissions", "");
    return;
  }

  ctx.ui.setStatus("permissions", renderStatus(runtime));
}
