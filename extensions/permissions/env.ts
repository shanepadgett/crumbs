const ALLOWED_ENV_KEYS = new Set([
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PWD",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
]);

const STRIP_PREFIXES = [
  "ANTHROPIC_",
  "AWS_",
  "AZURE_",
  "DATABASE_",
  "GCP_",
  "GH_",
  "GITHUB_",
  "GOOGLE_",
  "KUBE",
  "MONGO_",
  "MYSQL_",
  "OPENAI_",
  "PG",
  "REDIS_",
  "SSH_",
  "TF_",
];

const STRIP_EXACT = new Set([
  "DATABASE_URL",
  "KUBECONFIG",
  "SSH_AUTH_SOCK",
  "AWS_PROFILE",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
]);

export function scrubEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (STRIP_EXACT.has(key)) continue;
    if (STRIP_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (!ALLOWED_ENV_KEYS.has(key)) continue;
    next[key] = value;
  }

  return next;
}
