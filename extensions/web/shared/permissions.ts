interface WebPermissionsConfig {
  activeMode: {
    networkMode: "open" | "restricted";
  };
  network: {
    allowedDomains: string[];
  };
}

async function loadPermissionsConfigSafe(cwd: string): Promise<WebPermissionsConfig> {
  try {
    const mod = (await import("../../permissions/config.js" as string)) as {
      loadPermissionsConfig?: (cwd: string) => Promise<WebPermissionsConfig>;
    };
    if (typeof mod.loadPermissionsConfig === "function") {
      return await mod.loadPermissionsConfig(cwd);
    }
  } catch {
    // Permissions extension is optional in this repo state.
  }

  return {
    activeMode: { networkMode: "open" },
    network: { allowedDomains: [] },
  };
}

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
  const config = await loadPermissionsConfigSafe(cwd);
  if (config.activeMode.networkMode === "open") return;

  const hostname = hostnameFromUrl(url);
  if (!hostname) {
    throw new Error(`Blocked by permissions: invalid URL (${url})`);
  }

  if (!isDomainAllowed(hostname, config.network.allowedDomains)) {
    throw new Error(`Blocked by permissions: domain is not allowed (${hostname})`);
  }
}
