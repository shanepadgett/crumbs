# Validator enhancements to build later

Not for current implementation. Parking lot for future `quiet-validators` additions.

## quiet-tests

- **What it would do**
  - Run targeted Swift test target(s) after validator-relevant source changes.
  - Prefer unit tests first. Optionally support target filters or path-to-target mapping later.
- **When it would trigger**
  - Changes to Swift source files.
  - Changes to Swift test files.
  - Optional later: only trigger for paths mapped to testable modules or domains.
- **Why it is useful**
  - Build success only proves code compiles.
  - Tests catch behavior regressions, broken assumptions, and logic drift.
  - Higher-value signal than another compile step.
- **Notes**
  - Needs careful scoping so it does not feel too heavy.
  - Best if config can choose test command, scheme, destination, and optional include/exclude globs.

## quiet-xcassets

- **What it would do**
  - Validate asset catalog changes.
  - Catch malformed asset catalog contents, missing referenced files, bad app icon sets, duplicate asset issues, or other catalog integrity problems.
- **When it would trigger**
  - Any change under `*.xcassets/**`.
  - Maybe also changes to image/color asset metadata files like `Contents.json`.
- **Why it is useful**
  - Asset errors are common and annoying.
  - They often fail late in build or show up only at runtime.
  - Very focused validator with low noise and cheap trigger conditions.
- **Notes**
  - Could be implemented via a lightweight validation script or a narrow build/compile check for asset catalogs only.

## quiet-plist-check

- **What it would do**
  - Validate plist and signing-adjacent configuration integrity.
  - Focus on `Info.plist`, entitlements, bundle identifiers, capability-related project settings, and maybe required usage-description keys.
- **When it would trigger**
  - Changes to `.plist` files.
  - Changes to `.entitlements` files.
  - Changes to relevant `.xcodeproj` or `.xcconfig` settings.
- **Why it is useful**
  - These changes can compile cleanly but fail at launch, install, permissions flow, or signing time.
  - Catches high-friction config regressions early.
- **Notes**
  - Good candidate for structured failure groups because plist/config errors are often parseable.
  - Likely needs repo config for expected keys or expected bundle/capability invariants.

## quiet-localization-check

- **What it would do**
  - Validate localization resource integrity.
  - Check `.strings`, `.stringsdict`, `.xcstrings`, and related localized resources for malformed content and missing key consistency.
- **When it would trigger**
  - Changes to localization resource files.
  - Changes under `*.lproj/**`.
  - Changes to string catalog files.
- **Why it is useful**
  - Localization mistakes often slip past compile checks.
  - Broken resources can produce missing text, fallback behavior, or runtime parsing issues.
  - Focused validator with clear ownership and low false-positive risk.
- **Notes**
  - Could start with syntax/integrity only.
  - Later could support stronger cross-locale completeness checks.

## quiet-package-resolve-check

- **What it would do**
  - Validate package resolution and dependency buildability.
  - Run only when dependency manifests change.
- **When it would trigger**
  - Changes to `Package.swift`.
  - Changes to `Package.resolved`.
  - Maybe changes to project package references inside `.xcodeproj`.
- **Why it is useful**
  - Dependency breakage is a distinct failure mode.
  - No reason to run package validation on unrelated edits.
  - Good signal when package config changes.
- **Notes**
  - Lower priority than the validators above.
  - Keep as optional future enhancement.

## Recommended order

1. `quiet-tests`
1. `quiet-xcassets`
1. `quiet-plist-check`
1. `quiet-localization-check`
1. `quiet-package-resolve-check`

## Shared backbone expectations

If these are built later, they should follow the current shared `quiet-validators` model:

- trigger only from validator-relevant file changes
- stay silent when unsupported or unconfigured
- avoid no-op UI chatter
- use dirty-until-success semantics
- report grouped failures with expandable detail
- support config in `crumbs.json` only where needed
