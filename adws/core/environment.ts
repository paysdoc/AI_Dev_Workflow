/**
 * Environment configuration for ADW.
 *
 * Loads environment variables from .env, resolves the Claude CLI path,
 * and exports all path/directory constants derived from environment state.
 * Provider secret accessors live here rather than in config.ts so that
 * model-routing and retry constants can be imported without side-effects.
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Load environment variables from .env file at project root
dotenv.config();

// ---------------------------------------------------------------------------
// Claude CLI resolution
// ---------------------------------------------------------------------------

/** Path to the Claude CLI executable. */
export const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || 'claude';

/** Cached resolved Claude CLI path. */
let cachedClaudeCodePath: string | null = null;

/**
 * Resolves and validates the Claude CLI executable path.
 * Checks the configured CLAUDE_CODE_PATH first, then falls back to PATH lookup via `which`.
 * The result is cached for performance; use {@link clearClaudeCodePathCache} to force re-resolution.
 */
export function resolveClaudeCodePath(): string {
  if (cachedClaudeCodePath) return cachedClaudeCodePath;

  // If configured path is absolute and exists, use it directly
  if (CLAUDE_CODE_PATH.startsWith('/') && fs.existsSync(CLAUDE_CODE_PATH)) {
    cachedClaudeCodePath = CLAUDE_CODE_PATH;
    return cachedClaudeCodePath;
  }

  // Fall back to PATH-based resolution via `which`
  try {
    const resolved = execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (resolved) {
      cachedClaudeCodePath = resolved;
      return cachedClaudeCodePath;
    }
  } catch {
    // which failed — claude not in PATH
  }

  throw new Error("Claude CLI not found. Set CLAUDE_CODE_PATH in .env or ensure 'claude' is in your PATH.");
}

/**
 * Clears the cached Claude CLI path so the next call to {@link resolveClaudeCodePath}
 * performs a fresh resolution. Used after ENOENT errors to pick up path changes.
 */
export function clearClaudeCodePathCache(): void {
  cachedClaudeCodePath = null;
}

// ---------------------------------------------------------------------------
// Provider secret accessors
// ---------------------------------------------------------------------------

/** GitHub Personal Access Token (optional, gh CLI handles auth). */
export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

/** Jira instance URL (e.g., https://your-domain.atlassian.net). */
export const JIRA_BASE_URL = process.env.JIRA_BASE_URL || '';

/** Email for Jira Cloud basic auth. */
export const JIRA_EMAIL = process.env.JIRA_EMAIL || '';

/** API token for Jira Cloud. */
export const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN || '';

/** Personal access token for Jira Data Center/Server. */
export const JIRA_PAT = process.env.JIRA_PAT || '';

/** Default Jira project key (e.g., PROJ). */
export const JIRA_PROJECT_KEY = process.env.JIRA_PROJECT_KEY || '';

/** GitLab personal access token (needs api scope). */
export const GITLAB_TOKEN = process.env.GITLAB_TOKEN || '';

/** GitLab instance URL (default: https://gitlab.com, set for self-hosted). */
export const GITLAB_INSTANCE_URL = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';

/** Cloudflare account ID for R2 storage access. */
export const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';

/** R2 S3-compatible API access key ID. */
export const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';

/** R2 S3-compatible API secret access key. */
export const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';

// ---------------------------------------------------------------------------
// Path / directory constants
// ---------------------------------------------------------------------------

/** Directory for storing workflow logs. */
export const LOGS_DIR = path.join(process.cwd(), 'logs');

/** Directory for storing implementation plans. */
export const SPECS_DIR = path.join(process.cwd(), 'specs');

/** Directory for storing agent state files. */
export const AGENTS_STATE_DIR = path.join(process.cwd(), 'agents');

/** Directory for storing git worktrees. */
export const WORKTREES_DIR = path.join(process.cwd(), '.worktrees');

/** Directory for storing cloned target repository workspaces. */
export const TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos');

// ---------------------------------------------------------------------------
// Subprocess environment
// ---------------------------------------------------------------------------

/** Allowlist of environment variable names safe to pass to Claude CLI subprocesses. */
const SAFE_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'GITHUB_PAT',
  'GH_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
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
];

/**
 * Builds a filtered environment object containing only whitelisted variables.
 * Prevents leaking secrets (DB credentials, AWS keys, etc.) to Claude CLI subprocesses.
 */
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
