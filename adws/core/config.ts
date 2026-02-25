/**
 * Configuration constants for ADW Plan & Build workflow.
 */

import * as dotenv from 'dotenv';
import * as os from 'os';
import * as path from 'path';
import type { SlashCommand } from './issueTypes';

// Load environment variables from .env file at project root
dotenv.config();

/** Path to the Claude CLI executable. */
export const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH || '/usr/local/bin/claude';

/** GitHub Personal Access Token (optional, gh CLI handles auth). */
export const GITHUB_PAT = process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

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

/** Directory for storing git worktrees. */
export const WORKTREES_DIR = path.join(process.cwd(), '.worktrees');

/** Directory for storing cloned target repository workspaces. */
export const TARGET_REPOS_DIR = process.env.TARGET_REPOS_DIR || path.join(os.homedir(), '.adw', 'repos');

/** Currencies to include in cost reports (comma-separated env var, default: EUR). */
export const COST_REPORT_CURRENCIES: readonly string[] = (process.env.COST_REPORT_CURRENCIES || 'EUR')
  .split(',')
  .map(c => c.trim())
  .filter(Boolean);

/** Maximum token budget per agent session (default: 200,000). */
export const MAX_THINKING_TOKENS = Math.max(0, parseInt(process.env.MAX_THINKING_TOKENS || '200000', 10)) || 200000;

/** Fraction of MAX_THINKING_TOKENS at which to trigger recovery (default: 0.9). */
export const TOKEN_LIMIT_THRESHOLD = parseFloat(process.env.TOKEN_LIMIT_THRESHOLD || '0.9') || 0.9;

/** Maximum number of continuation attempts before failing (default: 3). */
export const MAX_TOKEN_CONTINUATIONS = Math.max(1, parseInt(process.env.MAX_TOKEN_CONTINUATIONS || '3', 10)) || 3;

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
  '/classify_adw': 'haiku',
  '/classify_issue': 'sonnet',
  // Planning (complex reasoning)
  '/feature': 'opus',
  '/bug': 'opus',
  '/chore': 'opus',
  '/pr_review': 'opus',
  // Implementation (complex reasoning)
  '/implement': 'opus',
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
  // Utility
  '/find_plan_file': 'sonnet',
};

/** Cost-optimized model map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_MODEL_MAP_FAST: Record<SlashCommand, ModelTier> = {
  '/classify_adw': 'haiku',
  '/classify_issue': 'haiku',
  '/feature': 'opus',
  '/bug': 'opus',
  '/chore': 'opus',
  '/pr_review': 'opus',
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
  '/find_plan_file': 'haiku',
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
