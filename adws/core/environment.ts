/**
 * Provider secret accessors live here rather than in config.ts so that
 * model-routing and retry constants can be imported without side-effects.
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Repo root derived from this file's location (adws/core/environment.ts → ../../).
// Independent of process.cwd() so paths stay correct even if a trigger is launched
// from a subdirectory.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Asserts that the current process's cwd matches the repo root. Long-running
 * triggers (cron, webhook) spawn orchestrators with relative script paths and
 * derive several constants (LOGS_DIR, SPECS_DIR, …) from process.cwd(), so a
 * wrong cwd silently produces broken paths and crashing spawns. Call this at
 * the entry point of every trigger script.
 */
export function assertCwdIsRepoRoot(): void {
  const cwd = path.resolve(process.cwd());
  if (cwd !== REPO_ROOT) {
    // Write directly to stderr — `log` writes to logs/<dir>/, which is itself
    // cwd-derived and would be wrong here.
    process.stderr.write(
      `\nFATAL: must be launched from the repo root.\n  expected cwd: ${REPO_ROOT}\n  actual   cwd: ${cwd}\n  fix: cd to the repo root and re-run.\n\n`,
    );
    process.exit(1);
  }
}

dotenv.config();

/** Path to the Claude CLI executable, snapshotted at process start (diagnostics only). */
export const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || 'claude';

let cachedClaudeCodePath: string | null = null;
let cachedFromConfiguredPath: string | null = null;

/**
 * The result is cached for performance, keyed on the live CLAUDE_CODE_PATH env var rather
 * than the module-load-time CLAUDE_CODE_PATH constant — if the env var changes mid-process
 * (e.g. test mock setup/teardown toggling it), the cache is invalidated and re-resolved
 * automatically. Use {@link clearClaudeCodePathCache} to force re-resolution even when the
 * configured value is unchanged (e.g. after an ENOENT).
 */
export function resolveClaudeCodePath(): string {
  const configuredPath = process.env.CLAUDE_CODE_PATH || 'claude';
  if (cachedClaudeCodePath && cachedFromConfiguredPath === configuredPath) {
    return cachedClaudeCodePath;
  }

  if (configuredPath.startsWith('/') && fs.existsSync(configuredPath)) {
    cachedClaudeCodePath = configuredPath;
    cachedFromConfiguredPath = configuredPath;
    return cachedClaudeCodePath;
  }

  try {
    const resolved = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (resolved) {
      cachedClaudeCodePath = resolved;
      cachedFromConfiguredPath = configuredPath;
      return cachedClaudeCodePath;
    }
  } catch {
    // falls through to the throw below
  }

  throw new Error("Claude CLI not found. Set CLAUDE_CODE_PATH in .env or ensure 'claude' is in your PATH.");
}

/** Used after ENOENT errors to pick up path changes. */
export function clearClaudeCodePathCache(): void {
  cachedClaudeCodePath = null;
  cachedFromConfiguredPath = null;
}

/** GitHub Personal Access Token (optional, gh CLI handles auth). */
export const GITHUB_PAT = process.env.GITHUB_PAT;

export const JIRA_BASE_URL = process.env.JIRA_BASE_URL || '';

/** Email for Jira Cloud basic auth. */
export const JIRA_EMAIL = process.env.JIRA_EMAIL || '';

/** API token for Jira Cloud. */
export const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';

/** Personal access token for Jira Data Center/Server. */
export const JIRA_PAT = process.env.JIRA_PAT || '';

export const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || '';

/** GitLab personal access token (needs api scope). */
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN || '';

/** GitLab instance URL (default: https://gitlab.com, set for self-hosted). */
export const GITLAB_INSTANCE_URL = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';

export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';

export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';

export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

/** Empty string disables D1 writes. */
export const COST_API_URL = process.env.COST_API_URL || '';

export const COST_API_TOKEN = process.env.COST_API_TOKEN || '';

export const LOGS_DIR = path.join(process.cwd(), 'logs');

export const SPECS_DIR = path.join(process.cwd(), 'specs');

export const AGENTS_STATE_DIR = path.join(process.cwd(), 'agents');

export const WORKTREES_DIR = path.join(process.cwd(), '.worktrees');

export const TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos');

/** Allowlist of environment variable names safe to pass to Claude CLI subprocesses. */
const SAFE_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'GITHUB_PAT',
  'GH_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
  'CLAUDE_CODE_PATH',
  'HOME',
  'USER',
  'PATH',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'NODE_PATH',
  'NODE_ENV',
  'PWD',
  'PORT',
  'ADW_WORKTREE_PATH',
  'ADW_MAIN_REPO_PATH',
  'ADW_UNIT_TEST_REPORT_PATH',
];

/** Prevents leaking secrets (DB credentials, AWS keys, etc.) to Claude CLI subprocesses. */
export function getSafeSubprocessEnv(): NodeJS.ProcessEnv {
  const safeEnv: Record<string, string | undefined> = {};
  for (const key of SAFE_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      safeEnv[key] = value;
    }
  }
  return safeEnv as NodeJS.ProcessEnv;
}
