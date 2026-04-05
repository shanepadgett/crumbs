import { loadPermissionsConfig } from "../../permissions/config.js";

export function hostnameFromUrl(input: string): string | null {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  const host = hostname.toLowerCase();

  for (const pattern of allowedDomains) {
    const normalized = pattern.trim().toLowerCase();
    if (!normalized) continue;

    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(2);
      if (host === suffix || host.endsWith(`.${suffix}`)) return true;
      continue;
    }

    if (host === normalized) return true;
  }

  return false;
}

export async function assertUrlAllowed(cwd: string, url: string): Promise<void> {
  const config = await loadPermissionsConfig(cwd);
  if (config.activeMode.networkMode === "open") return;

  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    throw new Error(`Blocked by permissions: invalid URL (${url})`);
  }

  if (!isDomainAllowed(hostname, config.network.allowedDomains)) {
    throw new Error(`Blocked by permissions: domain is not allowed (${hostname})`);
  }
}
