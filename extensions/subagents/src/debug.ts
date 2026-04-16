let subagentDebugEnabled = false;

export function isSubagentDebugEnabled(): boolean {
  if (subagentDebugEnabled) return true;
  const value = process.env.CRUMBS_SUBAGENT_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function setSubagentDebugEnabled(enabled: boolean): void {
  subagentDebugEnabled = enabled;
}
