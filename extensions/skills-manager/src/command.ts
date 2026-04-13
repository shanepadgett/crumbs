import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadManagerSnapshot } from "./discovery.js";
import { getDeletionLogPath, getRepoRoot, getSkillRoots } from "./paths.js";
import type {
  DeletedOperation,
  ManagerAction,
  ManagerRow,
  SkillRecord,
  SkillScope,
  SkillTab,
} from "./types.js";
import {
  actionAvailability,
  executeDelete,
  executeLinkToClaude,
  executeMoveToAgents,
  executeRestore,
  resolveSelection,
} from "./actions.js";
import {
  chooseDestinationScope,
  confirmNoDefault,
  describeDeletedOperation,
  describeSkill,
  runBrowser,
  runPicker,
  showTextScreen,
} from "./ui.js";

function preferredScopeFromTab(tab: SkillTab): SkillScope {
  return tab.endsWith("project") ? "project" : "global";
}

function availableActions(
  rows: ManagerRow[],
  selectedIds: Set<string>,
  hoveredId?: string,
): Array<{ id: ManagerAction; label: string }> {
  const selectedRows = resolveSelection(rows, selectedIds, hoveredId);
  const skills = selectedRows.filter((row): row is SkillRecord => row.kind === "skill");
  const deleted = selectedRows.filter(
    (row): row is DeletedOperation => row.kind === "deleted-operation",
  );

  if (deleted.length > 0 && skills.length > 0) {
    return [
      { id: "show-details", label: "Show details" },
      { id: "refresh", label: "Refresh" },
    ];
  }

  if (deleted.length > 0 && skills.length === 0) {
    return [
      { id: "restore", label: "Restore" },
      { id: "show-details", label: "Show details" },
      { id: "refresh", label: "Refresh" },
    ];
  }

  if (skills.length === 0) return [{ id: "refresh", label: "Refresh" }];

  const hoveredSkill = hoveredId
    ? rows.find((row): row is SkillRecord => row.kind === "skill" && row.id === hoveredId)
    : undefined;
  return [
    { id: "delete", label: "Delete" },
    ...(actionAvailability("link-to-claude", skills, hoveredSkill)
      ? [{ id: "link-to-claude" as const, label: "Link to Claude..." }]
      : []),
    ...(actionAvailability("move-to-agents", skills, hoveredSkill)
      ? [{ id: "move-to-agents" as const, label: "Move to Agents..." }]
      : []),
    { id: "show-details", label: "Show details" },
    ...(actionAvailability("reveal-target", skills, hoveredSkill)
      ? [{ id: "reveal-target" as const, label: "Reveal target" }]
      : []),
    { id: "refresh", label: "Refresh" },
  ];
}

async function chooseAction(
  ctx: ExtensionContext,
  rows: ManagerRow[],
  selectedIds: Set<string>,
  hoveredId?: string,
): Promise<ManagerAction | undefined> {
  const actions = availableActions(rows, selectedIds, hoveredId);
  return runPicker(
    ctx,
    "Actions",
    actions.map((action) => ({ id: action.id, label: action.label })),
  );
}

async function handleDelete(
  ctx: ExtensionContext,
  skills: SkillRecord[],
  allSkills: SkillRecord[],
  logPath: string,
): Promise<void> {
  const selectedPaths = new Set(skills.map((skill) => skill.path));
  const counterparts = new Map<string, SkillRecord>();

  for (const skill of skills) {
    for (const candidate of allSkills) {
      if (candidate.path === skill.path) continue;
      if (selectedPaths.has(candidate.path)) continue;

      const candidateTargetsSkill = candidate.isSymlink && candidate.resolvedTarget === skill.path;
      const skillTargetsCandidate = skill.isSymlink && skill.resolvedTarget === candidate.path;
      if (!candidateTargetsSkill && !skillTargetsCandidate) continue;

      counterparts.set(candidate.path, candidate);
    }
  }

  let includeCounterparts = false;
  const linkedSkills = [...counterparts.values()];
  if (linkedSkills.length > 0) {
    includeCounterparts = await confirmNoDefault(ctx, "Trash linked skills too?", [
      `${linkedSkills.length} linked skill${linkedSkills.length === 1 ? "" : "s"} detected.`,
      ...linkedSkills.slice(0, 8).map((skill) => `• [${skill.store} ${skill.scope}] ${skill.name}`),
      ...(linkedSkills.length > 8 ? [`• ... and ${linkedSkills.length - 8} more`] : []),
    ]);
  }

  const plannedSkills = new Map<string, SkillRecord>();
  for (const skill of skills) plannedSkills.set(skill.path, skill);
  if (includeCounterparts) {
    for (const skill of linkedSkills) plannedSkills.set(skill.path, skill);
  }
  const finalSkills = [...plannedSkills.values()];

  const summary = [
    `Trash ${finalSkills.length} skill path${finalSkills.length === 1 ? "" : "s"}?`,
    ...finalSkills.slice(0, 12).map((skill) => `• [${skill.store} ${skill.scope}] ${skill.name}`),
    ...(finalSkills.length > 12 ? [`• ... and ${finalSkills.length - 12} more`] : []),
  ];
  const confirmed = await confirmNoDefault(ctx, "Confirm trash", summary);
  if (!confirmed) return;

  const result = await executeDelete(finalSkills, logPath);
  ctx.ui.notify(result.message, "info");
}

async function handleLinkToClaude(
  ctx: ExtensionContext,
  skills: SkillRecord[],
  activeTab: SkillTab,
  roots: ReturnType<typeof getSkillRoots>,
): Promise<void> {
  const scope = await chooseDestinationScope(
    ctx,
    "Link to Claude destination",
    preferredScopeFromTab(activeTab),
  );
  if (!scope) return;
  const result = await executeLinkToClaude(skills, roots, scope);
  ctx.ui.notify(result.message, "info");
}

async function handleMoveToAgents(
  ctx: ExtensionContext,
  skills: SkillRecord[],
  activeTab: SkillTab,
  roots: ReturnType<typeof getSkillRoots>,
): Promise<void> {
  const scope = await chooseDestinationScope(
    ctx,
    "Move to Agents destination",
    preferredScopeFromTab(activeTab),
  );
  if (!scope) return;
  const result = await executeMoveToAgents(skills, roots, scope);
  ctx.ui.notify(result.message, "info");
}

async function handleShowDetails(ctx: ExtensionContext, rows: ManagerRow[]): Promise<void> {
  if (rows.length === 0) return;
  const row = rows[0]!;
  await showTextScreen(
    ctx,
    row.kind === "skill" ? "Skill details" : "Deleted operation details",
    row.kind === "skill" ? describeSkill(row) : describeDeletedOperation(row),
  );
}

async function handleRevealTarget(ctx: ExtensionContext, rows: ManagerRow[]): Promise<void> {
  const row = rows[0];
  if (!row || row.kind !== "skill" || !row.resolvedTarget) return;
  await showTextScreen(ctx, "Symlink target", [row.resolvedTarget]);
}

async function handleRestore(ctx: ExtensionContext, rows: ManagerRow[]): Promise<void> {
  const operations = rows.filter(
    (row): row is DeletedOperation => row.kind === "deleted-operation",
  );
  if (operations.length === 0) return;
  const confirmed = await confirmNoDefault(ctx, "Restore deleted skills", [
    `Restore ${operations.length} deleted operation${operations.length === 1 ? "" : "s"}?`,
    ...operations
      .slice(0, 8)
      .map((operation) => `• ${operation.entries.map((entry) => entry.name).join(", ")}`),
  ]);
  if (!confirmed) return;
  for (const operation of operations) {
    const result = await executeRestore(operation);
    ctx.ui.notify(result.message, "info");
  }
}

export function registerSkillsManagerCommand(pi: ExtensionAPI): void {
  pi.registerCommand("skills-manager", {
    description: "Manage skills across Agents and Claude roots",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/skills-manager requires interactive mode", "error");
        return;
      }

      const repoRoot = await getRepoRoot(pi, ctx.cwd);
      const roots = getSkillRoots(repoRoot);
      const logPath = getDeletionLogPath();
      let activeTab: SkillTab = "agents-global";
      let selectedIds = new Set<string>();

      while (true) {
        const snapshot = await loadManagerSnapshot(roots, logPath);
        const rows: ManagerRow[] = [...snapshot.skills, ...snapshot.deletedOperations];
        const browser = await runBrowser(ctx, rows, activeTab, selectedIds);
        activeTab = browser.activeTab;
        selectedIds = new Set(browser.selectedIds);

        if (browser.kind === "cancel") return;
        if (browser.kind === "refresh") continue;

        const action = await chooseAction(ctx, rows, selectedIds, browser.hoveredId);
        if (!action || action === "refresh") continue;

        const selectedRows = resolveSelection(rows, selectedIds, browser.hoveredId);
        const skillRows = selectedRows.filter((row): row is SkillRecord => row.kind === "skill");

        try {
          if (action === "delete") await handleDelete(ctx, skillRows, snapshot.skills, logPath);
          else if (action === "link-to-claude")
            await handleLinkToClaude(ctx, skillRows, activeTab, roots);
          else if (action === "move-to-agents")
            await handleMoveToAgents(ctx, skillRows, activeTab, roots);
          else if (action === "show-details") await handleShowDetails(ctx, selectedRows);
          else if (action === "reveal-target") await handleRevealTarget(ctx, selectedRows);
          else if (action === "restore") await handleRestore(ctx, selectedRows);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, "error");
        }
      }
    },
  });
}
