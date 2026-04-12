# Outputs

## Minimum setup

Create:

- `.gitignore` if missing or patch if needed
- `AGENTS.md`
- `mise.toml` if missing and user wants runtime/task setup

## Root AGENTS.md should cover

- repo purpose
- core rules
- decision rules
- language/framework conventions for active stack
- runtime/tooling assumptions
- high-risk paths
- anti-bloat rules
- testing / validation notes if known

## .gitignore behavior

- Keep if already sane for stack and tools
- Add only missing entries needed for chosen languages, runtimes, editors, and outputs
- Avoid giant kitchen-sink templates

## mise.toml behavior

- Pin latest stable versions for chosen runtimes and CLI tools user wants
- Add `lint` task for language tooling
- Add `check` task that depends on needed checks
- Add format or dead-code tasks only if repo wants them
- Do not add markdown lint task

## check task shape

- `check` should depend on `lint`
- Add `format:check` only if formatter supports check mode and user wants it
- Add dead-code task only if tool chosen
- Keep names simple and obvious

## Final report

Include:

- files created or changed
- chosen runtimes and pinned tools
- why `.gitignore` changes were needed or why none were needed
- `AGENTS.md` themes
- task names added to `mise.toml`
- assumptions
- non-goals
