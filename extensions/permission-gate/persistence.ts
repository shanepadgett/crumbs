/**
 * Shared Crumbs permission gate persistence and review logging helpers.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_ON_NO_UI,
  DEFAULT_POLICY,
  isDefaultPolicy,
  isObject,
  isOnNoUiPolicy,
} from "./policy.js";
import type { ApprovalAction, ApprovalResult, ApprovalReviewRecord } from "./types.js";

const PROJECT_POLICY_PATH = ".pi/crumbs.json";
const USER_POLICY_PATH = ".pi/agent/crumbs.json";
const SETTINGS_PATH = ".pi/agent/settings.json";
const REVIEW_LOG_PATH = ".pi/permission-review.ndjson";
const PROJECT_SCHEMA_REF = "../schemas/crumbs.schema.json";
const SCHEMA_FILE_RELATIVE_PATH = "schemas/crumbs.schema.json";

export function projectPolicyPath(cwd: string): string {
  return resolve(cwd, PROJECT_POLICY_PATH);
}

export function userPolicyPath(): string {
  return resolve(homedir(), USER_POLICY_PATH);
}

function settingsPath(): string {
  return resolve(homedir(), SETTINGS_PATH);
}

function reviewLogPath(cwd: string): string {
  return resolve(cwd, REVIEW_LOG_PATH);
}

let cachedInstalledSchemaRef: string | null | undefined;

async function schemaRefFromSettingsPackages(): Promise<string | null> {
  if (cachedInstalledSchemaRef !== undefined) {
    return cachedInstalledSchemaRef;
  }

  try {
    const rawSettings = await readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(rawSettings) as unknown;
    if (!isObject(parsed) || !Array.isArray(parsed.packages)) {
      cachedInstalledSchemaRef = null;
      return cachedInstalledSchemaRef;
    }

    const baseDir = dirname(settingsPath());

    for (const pkg of parsed.packages) {
      if (typeof pkg !== "string" || pkg.trim().length === 0) continue;
      const packageRoot = resolve(baseDir, pkg);
      const schemaPath = resolve(packageRoot, SCHEMA_FILE_RELATIVE_PATH);

      try {
        await readFile(schemaPath, "utf8");
        cachedInstalledSchemaRef = pathToFileURL(schemaPath).href;
        return cachedInstalledSchemaRef;
      } catch {
        // Ignore package entries that don't contain the schema file.
      }
    }
  } catch {
    // Ignore unreadable/malformed settings and fall back.
  }

  cachedInstalledSchemaRef = null;
  return cachedInstalledSchemaRef;
}

export async function resolveSchemaRefForPersistence(
  action: ApprovalAction,
  cwd: string,
): Promise<string> {
  const fromSettings = await schemaRefFromSettingsPackages();
  if (fromSettings) return fromSettings;

  if (action === "always-project") return PROJECT_SCHEMA_REF;
  return pathToFileURL(resolve(cwd, SCHEMA_FILE_RELATIVE_PATH)).href;
}

export async function ensurePolicyFileWithAllowRule(
  path: string,
  command: string,
  schemaRef: string,
): Promise<void> {
  let base: Record<string, unknown> = {};

  try {
    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (isObject(parsed)) {
      base = parsed;
    }
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      // Invalid/malformed existing file: replace with a valid policy document.
      base = {};
    }
  }

  const existingAllow = Array.isArray(base.allow) ? [...base.allow] : [];

  const hasDuplicate = existingAllow.some(
    (entry) => isObject(entry) && entry.match === "exact" && entry.value === command,
  );
  if (!hasDuplicate) {
    existingAllow.push({ match: "exact", value: command });
  }

  const next: Record<string, unknown> = {
    ...base,
    $schema: typeof base.$schema === "string" ? base.$schema : schemaRef,
    defaultPolicy: isDefaultPolicy(base.defaultPolicy) ? base.defaultPolicy : DEFAULT_POLICY,
    onNoUi: isOnNoUiPolicy(base.onNoUi) ? base.onNoUi : DEFAULT_ON_NO_UI,
    allow: existingAllow,
    deny: Array.isArray(base.deny) ? base.deny : [],
  };

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

async function appendApprovalReviewRecord(
  path: string,
  record: ApprovalReviewRecord,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function persistMarkedReviewRecord(
  cwd: string,
  command: string,
  approval: ApprovalResult,
  failedSegments: string[],
): Promise<void> {
  if (!approval.markedForReview) return;

  const reviewRecord: ApprovalReviewRecord = {
    command,
    action: approval.action,
    approvalReason: approval.approvalReason,
    ...(failedSegments.length > 0 ? { failedSegments: uniqueStrings(failedSegments) } : {}),
    ...(approval.note ? { note: approval.note } : {}),
  };

  try {
    await appendApprovalReviewRecord(reviewLogPath(cwd), reviewRecord);
  } catch {
    // Review logging is best-effort and should never block command flow.
  }
}
