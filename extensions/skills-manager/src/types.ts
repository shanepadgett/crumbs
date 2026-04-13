export type SkillStore = "agents" | "claude";
export type SkillScope = "global" | "project";
export type SkillTab =
  | "agents-global"
  | "agents-project"
  | "claude-global"
  | "claude-project"
  | "recently-deleted";

export interface SkillRoot {
  store: SkillStore;
  scope: SkillScope;
  tab: Exclude<SkillTab, "recently-deleted">;
  root: string;
}

export interface SkillRecord {
  id: string;
  kind: "skill";
  name: string;
  path: string;
  store: SkillStore;
  scope: SkillScope;
  tab: Exclude<SkillTab, "recently-deleted">;
  isSymlink: boolean;
  resolvedTarget?: string;
  hasManagedDependents: boolean;
}

export interface DeletedEntry {
  entryId: string;
  name: string;
  originalPath: string;
  trashPath: string;
  store?: SkillStore;
  scope?: SkillScope;
  tab?: Exclude<SkillTab, "recently-deleted">;
  isSymlink: boolean;
  symlinkTarget?: string;
  deletedRole: "selected-entry" | "symlink-target" | "replaced-destination";
}

export interface DeletedOperation {
  id: string;
  kind: "deleted-operation";
  deletedAt: string;
  entries: DeletedEntry[];
}

export type ManagerRow = SkillRecord | DeletedOperation;

export type ManagerAction =
  | "delete"
  | "link-to-claude"
  | "move-to-agents"
  | "restore"
  | "show-details"
  | "reveal-target"
  | "refresh";

export interface PickerOption<T extends string> {
  id: T;
  label: string;
  detail?: string;
}

export interface ManagerSnapshot {
  skills: SkillRecord[];
  deletedOperations: DeletedOperation[];
}
