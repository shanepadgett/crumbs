import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

type PermissionModeSetter = (mode: string, ctx: ExtensionContext) => Promise<boolean>;

let currentSetter: PermissionModeSetter | undefined;

export function registerPermissionsModeSetter(setter: PermissionModeSetter): void {
  currentSetter = setter;
}

export function clearPermissionsModeSetter(setter?: PermissionModeSetter): void {
  if (!setter || currentSetter === setter) {
    currentSetter = undefined;
  }
}

export async function setPermissionsMode(mode: string, ctx: ExtensionContext): Promise<boolean> {
  if (!currentSetter) return false;
  return currentSetter(mode, ctx);
}
