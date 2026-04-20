/**
 * Configuration constants for ADW workflows.
 *
 * Contains only retry limits, token budget constants, and comment-display flags.
 * Environment-specific concerns (paths, secrets, CLI resolution) live in environment.ts.
 * Model and effort routing lives in modelRouting.ts.
 *
 * All previously exported symbols are re-exported below for backward compatibility.
 */

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------
export {
  CLAUDE_CODE_PATH,
  resolveClaudeCodePath,
  clearClaudeCodePathCache,
  GITHUB_PAT,
  JIRA_BASE_URL,
  JIRA_EMAIL,
  JIRA_API_TOKEN,
  JIRA_PAT,
  JIRA_PROJECT_KEY,
  GITLAB_TOKEN,
  GITLAB_INSTANCE_URL,
  CLOUDFLARE_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  COST_API_URL,
  COST_API_TOKEN,
  LOGS_DIR,
  SPECS_DIR,
  AGENTS_STATE_DIR,
  WORKTREES_DIR,
  TARGET_REPOS_DIR,
  getSafeSubprocessEnv,
} from './environment';

export {
  SLASH_COMMAND_MODEL_MAP,
  SLASH_COMMAND_MODEL_MAP_FAST,
  SLASH_COMMAND_EFFORT_MAP,
  SLASH_COMMAND_EFFORT_MAP_FAST,
  isFastMode,
  getModelForCommand,
  getEffortForCommand,
  type ReasoningEffort,
} from './modelRouting';

// ---------------------------------------------------------------------------
// Retry constants
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for test resolution. */
export const MAX_TEST_RETRY_ATTEMPTS = parseInt(process.env.MAX_TEST_RETRY_ATTEMPTS || '5', 10);

/** Maximum number of retry attempts for review-patch resolution. */
export const MAX_REVIEW_RETRY_ATTEMPTS = parseInt(process.env.MAX_REVIEW_RETRY_ATTEMPTS || '3', 10);

/** Maximum number of retry attempts for plan validation resolution. */
export const MAX_VALIDATION_RETRY_ATTEMPTS = parseInt(process.env.MAX_VALIDATION_RETRY_ATTEMPTS || '3', 10);

// ---------------------------------------------------------------------------
// Concurrency / timing constants
// ---------------------------------------------------------------------------

/** Currencies to include in cost reports (comma-separated env var, default: EUR). */
export const COST_REPORT_CURRENCIES: readonly string[] = (process.env.COST_REPORT_CURRENCIES || 'EUR')
  .split(',')
  .map(c => c.trim())
  .filter(Boolean);

/** Maximum number of concurrently in-progress issues per repository (default: 5). */
export const MAX_CONCURRENT_PER_REPO = parseInt(process.env.MAX_CONCURRENT_PER_REPO || '5', 10);

/** Grace period (ms) for cron to avoid racing with webhook processing (default: 5 minutes). */
export const GRACE_PERIOD_MS = 300_000;

// Heartbeat constants
/** Heartbeat tick interval in milliseconds (default: 30s per PRD). */
export const HEARTBEAT_TICK_INTERVAL_MS = 30_000;

/** Stale-threshold for the hung-orchestrator detector — six missed ticks (default: 180s per PRD). */
export const HEARTBEAT_STALE_THRESHOLD_MS = 180_000;

// ---------------------------------------------------------------------------
// Token budget constants
// ---------------------------------------------------------------------------

/** Maximum output token budget per agent session (default: 63,999). */
export const MAX_THINKING_TOKENS = Math.max(0, parseInt(process.env.MAX_THINKING_TOKENS || '63999', 10)) || 63999;

/** Fraction of MAX_THINKING_TOKENS at which to trigger recovery (default: 0.9). */
export const TOKEN_LIMIT_THRESHOLD = parseFloat(process.env.TOKEN_LIMIT_THRESHOLD || '0.9') || 0.9;

/** Maximum number of context reset attempts before failing (default: 3). */
export const MAX_CONTEXT_RESETS = Math.max(1, parseInt(process.env.MAX_CONTEXT_RESETS || '3', 10)) || 3;

// ---------------------------------------------------------------------------
// Comment display flags
// ---------------------------------------------------------------------------

/** Whether to include running token totals in issue/PR comments. */
export const RUNNING_TOKENS = Boolean(process.env.RUNNING_TOKENS);

/** Whether to include cost breakdowns in GitHub issue/PR comments. */
export const SHOW_COST_IN_COMMENTS = Boolean(process.env.SHOW_COST_IN_COMMENTS);

// ---------------------------------------------------------------------------
// Pause/resume constants
// ---------------------------------------------------------------------------

/** Number of cron poll cycles between pause-queue probe attempts (default: 15 ≈ 5 min at 20s poll). */
export const PROBE_INTERVAL_CYCLES = parseInt(process.env.PROBE_INTERVAL_CYCLES || '15', 10);

/** Max consecutive non-rate-limit probe failures before removing a paused entry (default: 3). */
export const MAX_UNKNOWN_PROBE_FAILURES = parseInt(process.env.MAX_UNKNOWN_PROBE_FAILURES || '3', 10);

/** Number of cron poll cycles between janitor passes (default: 15 ≈ 5 min at 20s poll). */
export const JANITOR_INTERVAL_CYCLES = parseInt(process.env.JANITOR_INTERVAL_CYCLES || '15', 10);
