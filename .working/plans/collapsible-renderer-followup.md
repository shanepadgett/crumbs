# Collapsible renderer follow-up

- `extensions/shared/ui/collapsible-text-result.ts` now exposes both `renderCollapsibleTextResult` and `renderCollapsibleStyledTextResult`.
- `apply_patch` uses styled text variant to preserve mixed inline colors while keeping `Text`-based rendering stable in tool rows.
- Shared collapse/expand behavior still lives in two APIs with overlapping purpose.

## Follow-up

- Decide whether both helpers should remain public or whether one should wrap shared lower-level formatting logic.
- Migrate only callers that need preserved inline styling to `renderCollapsibleStyledTextResult`.
- Reduce duplicate collapse/hint assembly logic once usage patterns settle.
