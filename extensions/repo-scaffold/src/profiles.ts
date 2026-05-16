import type { Profile, ScaffoldOptions, ToolSpec } from "./types.js";

const taskLib = `#!/usr/bin/env bash
set -euo pipefail

run_step() {
  local label="$1"
  shift
  echo "==> $label"
  "$@"
}

run_filtered() {
  local label="$1"
  local failure_label="$2"
  shift 2

  local show_warnings="\${SHOW_WARNINGS:-1}"
  local raw_file
  local filtered_file
  raw_file="$(mktemp)"
  filtered_file="$(mktemp)"

  echo "==> $label"
  if "$@" >"$raw_file" 2>&1; then
    cmd_status=0
  else
    cmd_status=$?
  fi

  awk 'NF > 0' "$raw_file" \
    | awk '!seen[$0]++' \
    | awk '
        /Found [0-9]+ warning/ { next }
        /Found [0-9]+ error/ { next }
        /Finished in [0-9.]+/ { next }
        /:[0-9]+:[0-9]+: .*\\b(error|warning)\\b/ { print; next }
        /\\([0-9]+,[0-9]+\\): error TS[0-9]+:/ { print; next }
        /^error[: ]/ { print; next }
        /^warning[: ]/ { print; next }
        tolower($0) ~ /failed/ { print; next }
        tolower($0) ~ /not formatted/ { print; next }
      ' >"$filtered_file"

  if [[ "$show_warnings" == "0" ]]; then
    awk 'tolower($0) !~ /warning/' "$filtered_file" >"$filtered_file.tmp"
    mv "$filtered_file.tmp" "$filtered_file"
  fi

  if [[ -s "$filtered_file" ]]; then
    cat "$filtered_file"
    rm -f "$raw_file" "$filtered_file"
    exit 1
  fi

  if [[ $cmd_status -ne 0 ]]; then
    echo "$failure_label"
    awk 'NF > 0' "$raw_file" | awk '!seen[$0]++'
    rm -f "$raw_file" "$filtered_file"
    exit "$cmd_status"
  fi

  rm -f "$raw_file" "$filtered_file"
}
`;

const nodeTool: ToolSpec = {
  id: "node",
  label: "Node",
  miseKey: "node",
  source: { kind: "mise", tool: "node" },
};

function task(content: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"
while [[ "$ROOT" != "/" && ! -f "$ROOT/.mise/tasks/lib/scaffold.sh" ]]; do
  ROOT="$(dirname "$ROOT")"
done
source "$ROOT/.mise/tasks/lib/scaffold.sh"

${content.trim()}
`;
}

const agentPythonTools: ToolSpec[] = [
  { id: "python", label: "Python", miseKey: "python", source: { kind: "mise", tool: "python" } },
  { id: "uv", label: "uv", miseKey: "uv", source: { kind: "mise", tool: "uv" } },
];

const tsTools: ToolSpec[] = [
  { id: "bun", label: "Bun", miseKey: "bun", source: { kind: "mise", tool: "bun" } },
  nodeTool,
  {
    id: "typescript",
    label: "TypeScript",
    packageDevDependency: "typescript",
    source: { kind: "npm", packageName: "typescript" },
  },
  {
    id: "vitest",
    label: "Vitest",
    packageDevDependency: "vitest",
    source: { kind: "npm", packageName: "vitest" },
  },
  {
    id: "oxlint",
    label: "oxlint",
    miseKey: "npm:oxlint",
    source: { kind: "npm", packageName: "oxlint" },
  },
  {
    id: "oxfmt",
    label: "oxfmt",
    miseKey: "npm:oxfmt",
    source: { kind: "npm", packageName: "oxfmt" },
  },
  {
    id: "biome",
    label: "Biome",
    miseKey: "npm:@biomejs/biome",
    source: { kind: "npm", packageName: "@biomejs/biome" },
  },
];

const markdownTools: ToolSpec[] = [
  nodeTool,
  {
    id: "markdownlint-cli2",
    label: "markdownlint-cli2",
    miseKey: "npm:markdownlint-cli2",
    source: { kind: "npm", packageName: "markdownlint-cli2" },
  },
  {
    id: "mdformat",
    label: "mdformat",
    miseKey: "pipx:mdformat",
    miseValue: (version, versions) => ({
      version,
      uvx_args: `--with mdformat-gfm==${versions["mdformat-gfm"]} --with mdformat-frontmatter==${versions["mdformat-frontmatter"]} --with mdformat-footnote==${versions["mdformat-footnote"]} --with mdformat-gfm-alerts==${versions["mdformat-gfm-alerts"]}`,
    }),
    source: { kind: "pypi", packageName: "mdformat", requiresPython: true },
    maxVersionExclusive: "0.8.0",
  },
  {
    id: "mdformat-gfm",
    label: "mdformat-gfm",
    source: { kind: "pypi", packageName: "mdformat-gfm", requiresPython: true },
  },
  {
    id: "mdformat-frontmatter",
    label: "mdformat-frontmatter",
    source: { kind: "pypi", packageName: "mdformat-frontmatter", requiresPython: true },
  },
  {
    id: "mdformat-footnote",
    label: "mdformat-footnote",
    source: { kind: "pypi", packageName: "mdformat-footnote", requiresPython: true },
  },
  {
    id: "mdformat-gfm-alerts",
    label: "mdformat-gfm-alerts",
    source: { kind: "pypi", packageName: "mdformat-gfm-alerts", requiresPython: true },
  },
];

export const PROFILES: Profile[] = [
  {
    id: "agent-python",
    label: "Agent Python baseline",
    description: "Python and uv for agent file manipulation helpers.",
    defaultOn: true,
    tools: agentPythonTools,
    files: () => [],
    quietValidators: [],
  },
  {
    id: "ts",
    label: "JS/TS",
    description: "JS/TS formatting, linting, typecheck, tests, and quiet validators.",
    defaultOn: false,
    tools: tsTools,
    files: (_versions, options) => {
      const useBiome = options.jsQualityStack === "biome";
      const testCommand =
        options.primaryJsRuntime === "bun"
          ? 'echo "==> test ts"\nif find . -type f \\( -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts" -o -name "*.spec.tsx" \\) | grep -q .; then bun test; else echo "no tests found"; fi'
          : "npx vitest run --passWithNoTests";
      return [
        { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
        ...(useBiome
          ? []
          : [
              {
                path: ".oxfmtrc.json",
                content: `${JSON.stringify({ ignorePatterns: ["external/**", "node_modules/**", ".working/**", ".pi/git/**"] }, null, 2)}\n`,
              },
              {
                path: ".oxlintrc.json",
                content: `${JSON.stringify({ ignorePatterns: ["external/**", "node_modules/**", ".working/**", ".pi/git/**"] }, null, 2)}\n`,
              },
            ]),
        {
          path: ".mise/tasks/format/ts",
          executable: true,
          content: task(
            useBiome
              ? 'run_filtered "format ts" "format failed" biome format --write .'
              : 'run_filtered "format ts" "format failed" oxfmt --write .',
          ),
        },
        {
          path: ".mise/tasks/lint/ts",
          executable: true,
          content: task(
            useBiome
              ? 'run_filtered "lint ts" "lint failed" biome check --write .'
              : 'run_filtered "lint ts" "lint failed" oxlint --fix .',
          ),
        },
        {
          path: ".mise/tasks/typecheck/ts",
          executable: true,
          content: task(
            'run_filtered "typecheck ts" "typecheck failed" ./node_modules/.bin/tsc --noEmit',
          ),
        },
        {
          path: ".mise/tasks/test/ts",
          executable: true,
          content: task(
            options.primaryJsRuntime === "bun" ? testCommand : `run_step "test ts" ${testCommand}`,
          ),
        },
        {
          path: ".mise/tasks/check/ts",
          executable: true,
          content: task(
            'run_step "format ts" mise run format:ts\nrun_step "lint ts" mise run lint:ts\nrun_step "typecheck ts" mise run typecheck:ts\nrun_step "test ts" mise run test:ts',
          ),
        },
        {
          path: "tsconfig.json",
          content: `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" }, include: ["**/*.ts", "**/*.tsx"] }, null, 2)}\n`,
        },
      ];
    },
    quietValidators: [
      {
        name: "ts",
        task: "check:ts",
        trackedExtensions: [".js", ".jsx", ".ts", ".tsx"],
        excludeGlobs: ["node_modules/**", "dist/**", "build/**"],
      },
    ],
  },
  {
    id: "markdown",
    label: "Markdown",
    description: "Markdown formatting, linting, and quiet validators.",
    defaultOn: false,
    tools: markdownTools,
    files: () => [
      { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
      {
        path: ".markdownlint-cli2.mjs",
        content:
          'export default {\n  config: {\n    default: true,\n    MD013: false,\n    MD033: false,\n    MD041: false,\n    MD055: false,\n    MD056: false,\n    MD060: false,\n  },\n  globs: ["**/*.md"],\n  ignores: ["**/node_modules/**", "external/**", ".working/**", ".pi/local/**", ".pi/git/**"],\n};\n',
      },
      {
        path: ".mise/tasks/format/markdown",
        executable: true,
        content: task(
          `MDFORMAT_ARGS=(.)
while IFS= read -r pattern; do
  MDFORMAT_ARGS+=(--exclude "$pattern")
done < <(
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const config = (await import(pathToFileURL(\`\${process.cwd()}/.markdownlint-cli2.mjs\`).href)).default;
    for (const pattern of config.ignores ?? []) console.log(pattern);
  '
)

run_filtered "format markdown" "format markdown failed" mdformat "\${MDFORMAT_ARGS[@]}"`,
        ),
      },
      {
        path: ".mise/tasks/lint/markdown",
        executable: true,
        content: task('run_filtered "lint markdown" "lint markdown failed" markdownlint-cli2'),
      },
      {
        path: ".mise/tasks/check/markdown",
        executable: true,
        content: task(
          'run_step "format markdown" mise run format:markdown\nrun_step "lint markdown" mise run lint:markdown',
        ),
      },
    ],
    quietValidators: [
      {
        name: "markdown",
        task: "check:markdown",
        trackedExtensions: [".md"],
        excludeGlobs: ["node_modules/**"],
      },
    ],
  },
  {
    id: "yaml",
    label: "YAML",
    description: "YAML linting and quiet validators.",
    defaultOn: false,
    tools: [
      {
        id: "yamllint",
        label: "yamllint",
        miseKey: "pipx:yamllint",
        source: { kind: "pypi", packageName: "yamllint", requiresPython: true },
      },
    ],
    files: () => [
      { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
      {
        path: ".yamllint",
        content:
          "---\nignore: |\n  external/**\n  node_modules/**\n  .working/**\n  .pi/local/**\n  .pi/git/**\n",
      },
      {
        path: ".mise/tasks/lint/yaml",
        executable: true,
        content: task('run_filtered "lint yaml" "lint yaml failed" yamllint .'),
      },
      {
        path: ".mise/tasks/check/yaml",
        executable: true,
        content: task('run_step "lint yaml" mise run lint:yaml'),
      },
    ],
    quietValidators: [
      {
        name: "yaml",
        task: "check:yaml",
        trackedExtensions: [".yml", ".yaml"],
        excludeGlobs: ["node_modules/**"],
      },
    ],
  },
  {
    id: "go",
    label: "Go",
    description: "Go format, vet, lint, test, build, and quiet validators.",
    defaultOn: false,
    tools: [
      { id: "go", label: "Go", miseKey: "go", source: { kind: "mise", tool: "go" } },
      {
        id: "golangci-lint",
        label: "golangci-lint",
        miseKey: "golangci-lint",
        source: { kind: "mise", tool: "golangci-lint" },
      },
    ],
    files: () => [
      { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
      {
        path: ".mise/tasks/format/go",
        executable: true,
        content: task(
          'echo "==> format go"\nfind . -name "*.go" -not -path "*/vendor/*" -print0 | xargs -0 gofmt -w',
        ),
      },
      {
        path: ".mise/tasks/lint/go",
        executable: true,
        content: task('run_step "vet go" go vet ./...\nrun_step "lint go" golangci-lint run'),
      },
      {
        path: ".mise/tasks/test/go",
        executable: true,
        content: task('run_step "test go" go test ./...'),
      },
      {
        path: ".mise/tasks/build/go",
        executable: true,
        content: task('run_step "build go" go build ./...'),
      },
      {
        path: ".mise/tasks/check/go",
        executable: true,
        content: task(
          'run_step "format go" mise run format:go\nrun_step "lint go" mise run lint:go\nrun_step "test go" mise run test:go\nrun_step "build go" mise run build:go',
        ),
      },
    ],
    quietValidators: [{ name: "go", task: "check:go", trackedExtensions: [".go"] }],
  },
  {
    id: "swift",
    label: "Swift",
    description: "SwiftFormat, SwiftLint, SwiftPM build/test, and quiet validators.",
    defaultOn: false,
    tools: [
      {
        id: "swiftformat",
        label: "SwiftFormat",
        miseKey: "swiftformat",
        source: { kind: "github", repo: "nicklockwood/SwiftFormat" },
      },
      {
        id: "swiftlint",
        label: "SwiftLint",
        miseKey: "swiftlint",
        source: { kind: "github", repo: "realm/SwiftLint" },
      },
    ],
    files: () => [
      { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
      {
        path: ".mise/tasks/format/swift",
        executable: true,
        content: task('run_step "format swift" swiftformat .'),
      },
      {
        path: ".mise/tasks/lint/swift",
        executable: true,
        content: task(
          'run_step "lint swift" swiftlint lint --fix\nrun_step "lint swift verify" swiftlint lint',
        ),
      },
      {
        path: ".mise/tasks/test/swift",
        executable: true,
        content: task('run_step "test swift" swift test'),
      },
      {
        path: ".mise/tasks/build/swift",
        executable: true,
        content: task('run_step "build swift" swift build'),
      },
      {
        path: ".mise/tasks/check/swift",
        executable: true,
        content: task(
          'run_step "format swift" mise run format:swift\nrun_step "lint swift" mise run lint:swift\nrun_step "test swift" mise run test:swift\nrun_step "build swift" mise run build:swift',
        ),
      },
    ],
    quietValidators: [{ name: "swift", task: "check:swift", trackedExtensions: [".swift"] }],
  },
  {
    id: "xcode",
    label: "Xcode",
    description: "Editable Xcode build/test placeholder tasks.",
    defaultOn: false,
    tools: [],
    files: () => [
      { path: ".mise/tasks/lib/scaffold.sh", content: taskLib, executable: true },
      {
        path: ".mise/tasks/build/xcode",
        executable: true,
        content: task(
          'echo "TODO(scaffold-refine): set XCODE_PROJECT_OR_WORKSPACE, SCHEME, DESTINATION"\nexit 1',
        ),
      },
      {
        path: ".mise/tasks/test/xcode",
        executable: true,
        content: task(
          'echo "TODO(scaffold-refine): set XCODE_PROJECT_OR_WORKSPACE, SCHEME, DESTINATION"\nexit 1',
        ),
      },
      {
        path: ".mise/tasks/check/xcode",
        executable: true,
        content: task(
          'run_step "build xcode" mise run build:xcode\nrun_step "test xcode" mise run test:xcode',
        ),
      },
    ],
    quietValidators: [
      { name: "xcode", enabled: false, task: "check:xcode", trackedExtensions: [".swift"] },
    ],
  },
];

export function getProfile(id: string): Profile | null {
  return PROFILES.find((profile) => profile.id === id) ?? null;
}

export function activeToolsForProfile(profile: Profile, options: ScaffoldOptions): ToolSpec[] {
  if (profile.id !== "ts") return profile.tools;
  return profile.tools.filter((tool) => {
    if (tool.id === "bun") return options.primaryJsRuntime === "bun";
    if (tool.id === "node") return true;
    if (tool.id === "vitest") return options.primaryJsRuntime === "node";
    if (tool.id === "oxlint" || tool.id === "oxfmt") return options.jsQualityStack === "ox";
    if (tool.id === "biome") return options.jsQualityStack === "biome";
    return true;
  });
}
