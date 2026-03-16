/**
 * Configuration constants for ADW Plan & Build workflow.
 */

import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SlashCommand } from '../types/issueTypes';

// Load environment variables from .env file at project root
dotenv.config();

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

/** Directory for storing workflow logs. */
export const LOGS_DIR = path.join(process.cwd(), 'logs');

/** Directory for storing implementation plans. */
export const SPECS_DIR = path.join(process.cwd(), 'specs');

/** Directory for storing agent state files. */
export const AGENTS_STATE_DIR = path.join(process.cwd(), 'agents');

/** Maximum number of retry attempts for test resolution. */
export const MAX_TEST_RETRY_ATTEMPTS = parseInt(process.env.MAX_TEST_RETRY_ATTEMPTS || '5', 10);

/** Maximum number of retry attempts for review-patch resolution. */
export const MAX_REVIEW_RETRY_ATTEMPTS = parseInt(process.env.MAX_REVIEW_RETRY_ATTEMPTS || '3', 10);

/** Maximum number of retry attempts for plan validation resolution. */
export const MAX_VALIDATION_RETRY_ATTEMPTS = parseInt(process.env.MAX_VALIDATION_RETRY_ATTEMPTS || '3', 10);

/** Directory for storing git worktrees. */
export const WORKTREES_DIR = path.join(process.cwd(), '.worktrees');

/** Directory for storing cloned target repository workspaces. */
export const TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos');

/** Currencies to include in cost reports (comma-separated env var, default: EUR). */
export const COST_REPORT_CURRENCIES: readonly string[] = (process.env.COST_REPORT_CURRENCIES || 'EUR')
  .split(',')
  .map(c => c.trim())
  .filter(Boolean);

/** Maximum number of concurrently in-progress issues per repository (default: 5). */
export const MAX_CONCURRENT_PER_REPO = parseInt(process.env.MAX_CONCURRENT_PER_REPO || '5', 10);

/** Grace period (ms) for cron to avoid racing with webhook processing (default: 5 minutes). */
export const GRACE_PERIOD_MS = 300_000;

/** Maximum token budget per agent session (default: 63,999). */
export const MAX_THINKING_TOKENS = Math.max(0, parseInt(process.env.MAX_THINKING_TOKENS || '63999', 10)) || 63999;

/** Fraction of MAX_THINKING_TOKENS at which to trigger recovery (default: 0.9). */
export const TOKEN_LIMIT_THRESHOLD = parseFloat(process.env.TOKEN_LIMIT_THRESHOLD || '0.9') || 0.9;

/** Maximum number of continuation attempts before failing (default: 3). */
export const MAX_TOKEN_CONTINUATIONS = Math.max(1, parseInt(process.env.MAX_TOKEN_CONTINUATIONS || '3', 10)) || 3;

/** Whether to include running token totals in issue/PR comments. */
export const RUNNING_TOKENS = Boolean(process.env.RUNNING_TOKENS);

/** Allowlist of environment variable names safe to pass to Claude CLI subprocesses. */
const SAFE_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'GITHUB_PAT',
  'GH_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
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

/** Model type for slash command routing. */
type ModelTier = 'opus' | 'sonnet' | 'haiku';

/** Centralized model routing map. Maps every slash command to its model. */
export const SLASH_COMMAND_MODEL_MAP: Record<SlashCommand, ModelTier> = {
  // Classification
  '/classify_issue': 'sonnet',
  // Planning (complex reasoning)
  '/feature': 'opus',
  '/bug': 'opus',
  '/chore': 'opus',
  '/pr_review': 'opus',
  // Implementation (plan execution)
  '/implement': 'sonnet',
  '/patch': 'opus',
  // Review (complex reasoning)
  '/review': 'opus',
  // Test running (structured, cheap)
  '/test': 'haiku',
  // Test resolution (complex reasoning)
  '/resolve_failed_test': 'opus',
  '/resolve_failed_e2e_test': 'opus',
  // Git operations (structured, cheap)
  '/generate_branch_name': 'sonnet',
  '/commit': 'sonnet',
  '/pull_request': 'sonnet',
  // Documentation
  '/document': 'sonnet',
  // Cost tracking
  '/commit_cost': 'haiku',
  // KPI tracking
  '/track_agentic_kpis': 'haiku',
  // Utility
  '/find_plan_file': 'sonnet',
  // Dependency checking
  '/find_issue_dependencies': 'sonnet',
  // ADW initialization
  '/adw_init': 'sonnet',
  // Scenario writing
  '/scenario_writer': 'sonnet',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
};

/** Cost-optimized model map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_MODEL_MAP_FAST: Record<SlashCommand, ModelTier> = {
  '/classify_issue': 'haiku',
  '/feature': 'sonnet',
  '/bug': 'sonnet',
  '/chore': 'sonnet',
  '/pr_review': 'sonnet',
  '/implement': 'sonnet',
  '/patch': 'opus',
  '/review': 'sonnet',
  '/test': 'haiku',
  '/resolve_failed_test': 'opus',
  '/resolve_failed_e2e_test': 'opus',
  '/generate_branch_name': 'haiku',
  '/commit': 'haiku',
  '/pull_request': 'haiku',
  '/document': 'sonnet',
  '/commit_cost': 'haiku',
  '/track_agentic_kpis': 'haiku',
  '/find_plan_file': 'haiku',
  '/find_issue_dependencies': 'haiku',
  '/adw_init': 'haiku',
  // Scenario writing
  '/scenario_writer': 'haiku',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
};

/**
 * Detects whether `/fast` or `/cheap` keywords appear in text.
 * Returns true if the text contains either keyword.
 */
export function isFastMode(issueBody?: string): boolean {
  if (!issueBody) return false;
  return /\/fast\b|\/cheap\b/i.test(issueBody);
}

/**
 * Returns the model for a given slash command, selecting the fast/cheap map
 * when the issue body contains `/fast` or `/cheap` keywords.
 */
export function getModelForCommand(
  command: SlashCommand,
  issueBody?: string,
): ModelTier {
  const map = isFastMode(issueBody)
    ? SLASH_COMMAND_MODEL_MAP_FAST
    : SLASH_COMMAND_MODEL_MAP;
  return map[command];
}

/** Reasoning effort level for Claude CLI `--effort` flag. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

/** Default reasoning effort per slash command. `undefined` means no flag is passed. */
export const SLASH_COMMAND_EFFORT_MAP: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': 'low',
  '/feature': 'high',
  '/bug': 'high',
  '/chore': 'high',
  '/pr_review': 'high',
  '/implement': 'high',
  '/patch': 'high',
  '/review': 'high',
  '/test': undefined,
  '/resolve_failed_test': 'high',
  '/resolve_failed_e2e_test': 'high',
  '/generate_branch_name': 'low',
  '/commit': 'medium',
  '/pull_request': 'medium',
  '/document': 'medium',
  '/commit_cost': undefined,
  '/track_agentic_kpis': 'medium',
  '/find_plan_file': 'low',
  '/find_issue_dependencies': 'low',
  '/adw_init': 'medium',
  // Scenario writing
  '/scenario_writer': 'high',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'high',
};

/** Cost-optimized reasoning effort map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_EFFORT_MAP_FAST: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': 'low',
  '/feature': 'medium',
  '/bug': 'medium',
  '/chore': 'medium',
  '/pr_review': 'medium',
  '/implement': 'high',
  '/patch': 'high',
  '/review': 'high',
  '/test': undefined,
  '/resolve_failed_test': 'medium',
  '/resolve_failed_e2e_test': 'medium',
  '/generate_branch_name': 'low',
  '/commit': 'low',
  '/pull_request': 'medium',
  '/document': 'medium',
  '/commit_cost': undefined,
  '/track_agentic_kpis': 'low',
  '/find_plan_file': 'low',
  '/find_issue_dependencies': 'low',
  '/adw_init': 'medium',
  // Scenario writing
  '/scenario_writer': 'medium',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'high',
};

/**
 * Returns the reasoning effort for a given slash command, selecting the fast/cheap map
 * when the issue body contains `/fast` or `/cheap` keywords.
 */
export function getEffortForCommand(
  command: SlashCommand,
  issueBody?: string,
): ReasoningEffort | undefined {
  const map = isFastMode(issueBody)
    ? SLASH_COMMAND_EFFORT_MAP_FAST
    : SLASH_COMMAND_EFFORT_MAP;
  return map[command];
}
