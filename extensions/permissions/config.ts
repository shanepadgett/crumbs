import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  BasePermissionMode,
  DestructivePolicy,
  DirectMutationPolicy,
  NetworkMode,
  PermissionModeDefinition,
  PermissionsConfig,
  ResolvedPermissionMode,
} from "./types.js";

const DEFAULT_ALLOWED_DOMAINS = [
  "github.com",
  "*.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "registry.npmjs.org",
  "npmjs.org",
  "*.npmjs.org",
  "mcp.exa.ai",
];

const DEFAULT_MODES: Record<string, PermissionModeDefinition> = {
  "read-only": {
    label: "read-only",
    base: "read-only",
  },
  "read-only-open": {
    label: "read-only",
    base: "read-only",
    networkMode: "open",
  },
  workspace: {
    label: "workspace",
    base: "workspace",
  },
  "workspace-open": {
    label: "workspace",
    base: "workspace",
    networkMode: "open",
  },
  "full-access": {
    label: "full-access",
    base: "full-access",
  },
};

const BASE_MODE_DEFAULTS: Record<
  BasePermissionMode,
  Omit<ResolvedPermissionMode, "key" | "label">
> = {
  "read-only": {
    base: "read-only",
    sandbox: true,
    networkMode: "restricted",
    directMutationPolicy: "none",
    directMutationPaths: [],
    shellWriteRoots: ["/tmp"],
    destructivePolicy: "block",
  },
  workspace: {
    base: "workspace",
    sandbox: true,
    networkMode: "restricted",
    directMutationPolicy: "workspace",
    directMutationPaths: [],
    shellWriteRoots: [".", "/tmp"],
    destructivePolicy: "prompt",
  },
  "full-access": {
    base: "full-access",
    sandbox: false,
    networkMode: "open",
    directMutationPolicy: "any",
    directMutationPaths: [],
    shellWriteRoots: [".", "/tmp"],
    destructivePolicy: "allow",
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );
}

function isBasePermissionMode(value: unknown): value is BasePermissionMode {
  return value === "read-only" || value === "workspace" || value === "full-access";
}

function isNetworkMode(value: unknown): value is NetworkMode {
  return value === "restricted" || value === "open";
}

function isDirectMutationPolicy(value: unknown): value is DirectMutationPolicy {
  return value === "none" || value === "workspace" || value === "any" || value === "paths";
}

function isDestructivePolicy(value: unknown): value is DestructivePolicy {
  return value === "block" || value === "prompt" || value === "allow";
}

function parseModeDefinition(value: unknown): PermissionModeDefinition | null {
  if (!isObject(value) || !isBasePermissionMode(value.base)) return null;

  const definition: PermissionModeDefinition = {
    base: value.base,
  };

  if (typeof value.label === "string" && value.label.trim()) {
    definition.label = value.label.trim();
  }

  if (typeof value.sandbox === "boolean") {
    definition.sandbox = value.sandbox;
  }

  if (isNetworkMode(value.networkMode)) {
    definition.networkMode = value.networkMode;
  }

  if (isObject(value.direct)) {
    definition.direct = {};

    if (isDirectMutationPolicy(value.direct.mutation)) {
      definition.direct.mutation = value.direct.mutation;
    }

    if (Array.isArray(value.direct.allowPaths)) {
      definition.direct.allowPaths = stringArray(value.direct.allowPaths);
    }
  }

  if (isObject(value.shell) && Array.isArray(value.shell.writeRoots)) {
    definition.shell = {
      writeRoots: stringArray(value.shell.writeRoots),
    };
  }

  if (isDestructivePolicy(value.destructive)) {
    definition.destructive = value.destructive;
  }

  return definition;
}

function resolveModeDefinition(
  key: string,
  definition: PermissionModeDefinition,
): ResolvedPermissionMode {
  const base = BASE_MODE_DEFAULTS[definition.base];
  const directMutationPaths = definition.direct?.allowPaths ?? base.directMutationPaths;

  let directMutationPolicy = base.directMutationPolicy;
  if (definition.direct?.mutation) {
    directMutationPolicy = definition.direct.mutation;
  } else if (definition.direct?.allowPaths) {
    directMutationPolicy = "paths";
  }

  return {
    key,
    label: definition.label ?? key,
    base: definition.base,
    sandbox: definition.sandbox ?? base.sandbox,
    networkMode: definition.networkMode ?? base.networkMode,
    directMutationPolicy,
    directMutationPaths,
    shellWriteRoots: definition.shell?.writeRoots ?? base.shellWriteRoots,
    destructivePolicy: definition.destructive ?? base.destructivePolicy,
  };
}

function resolveSelectedMode(
  configuredMode: unknown,
  resolvedModes: Record<string, ResolvedPermissionMode>,
): string {
  const envMode = process.env.CRUMBS_PERMISSIONS_MODE?.trim();
  if (envMode && resolvedModes[envMode]) return envMode;
  if (typeof configuredMode === "string" && resolvedModes[configuredMode]) return configuredMode;
  return resolvedModes.workspace ? "workspace" : Object.keys(resolvedModes)[0];
}

function buildModes(permissions: Record<string, unknown> | null): {
  modes: Record<string, ResolvedPermissionMode>;
  modeOrder: string[];
} {
  const customDefinitions = new Map<string, PermissionModeDefinition>();

  if (permissions && isObject(permissions.modes)) {
    for (const [key, rawDefinition] of Object.entries(permissions.modes)) {
      const parsed = parseModeDefinition(rawDefinition);
      if (!parsed) continue;
      customDefinitions.set(key, parsed);
    }
  }

  const builtinOrder = [
    "read-only",
    "read-only-open",
    "workspace",
    "workspace-open",
    "full-access",
  ];

  const customModeOrder = Array.from(customDefinitions.keys()).filter(
    (key) => !builtinOrder.includes(key),
  );
  const modeOrder = [...customModeOrder, ...builtinOrder];

  const modes = Object.fromEntries(
    modeOrder.map((key) => {
      const definition = customDefinitions.get(key) ?? DEFAULT_MODES[key];
      return [key, resolveModeDefinition(key, definition)];
    }),
  ) as Record<string, ResolvedPermissionMode>;

  return { modes, modeOrder };
}

export function resolveConfiguredPath(cwd: string, inputPath: string): string {
  if (inputPath.startsWith("~/")) return resolve(homedir(), inputPath.slice(2));
  if (inputPath.startsWith("/")) return resolve(inputPath);
  return resolve(cwd, inputPath);
}

export function withSelectedMode(config: PermissionsConfig, mode: string): PermissionsConfig {
  const activeMode = config.modes[mode] ?? config.activeMode;
  return {
    ...config,
    mode: activeMode.key,
    activeMode,
  };
}

export async function loadPermissionsConfig(cwd: string): Promise<PermissionsConfig> {
  try {
    const raw = await readFile(resolve(cwd, ".pi/crumbs.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const permissions =
      isObject(parsed) && isObject(parsed.permissions) ? parsed.permissions : null;
    const { modes, modeOrder } = buildModes(permissions);
    const mode = resolveSelectedMode(permissions?.mode, modes);

    return {
      mode,
      activeMode: modes[mode],
      modeOrder,
      modes,
      blockedPaths:
        permissions && stringArray(permissions.blockedPaths).length
          ? stringArray(permissions.blockedPaths)
          : [".env", ".env.*", "~/.ssh/", "~/.aws/", "~/.gnupg/"],
      protectedMutationPaths:
        permissions && stringArray(permissions.protectedMutationPaths).length
          ? stringArray(permissions.protectedMutationPaths)
          : [".pi/crumbs.json"],
      network: {
        allowedDomains:
          permissions &&
          isObject(permissions.network) &&
          stringArray(permissions.network.allowedDomains).length
            ? stringArray(permissions.network.allowedDomains)
            : DEFAULT_ALLOWED_DOMAINS,
      },
      ui: {
        showFooterStatus:
          permissions &&
          isObject(permissions.ui) &&
          typeof permissions.ui.showFooterStatus === "boolean"
            ? permissions.ui.showFooterStatus
            : true,
      },
      destructive: {
        onNoUi:
          permissions &&
          isObject(permissions.destructive) &&
          permissions.destructive.onNoUi === "allow"
            ? "allow"
            : "deny",
      },
    };
  } catch {
    const { modes, modeOrder } = buildModes(null);
    return {
      mode: "workspace",
      activeMode: modes.workspace,
      modeOrder,
      modes,
      blockedPaths: [".env", ".env.*", "~/.ssh/", "~/.aws/", "~/.gnupg/"],
      protectedMutationPaths: [".pi/crumbs.json"],
      network: {
        allowedDomains: DEFAULT_ALLOWED_DOMAINS,
      },
      ui: {
        showFooterStatus: true,
      },
      destructive: {
        onNoUi: "deny",
      },
    };
  }
}
