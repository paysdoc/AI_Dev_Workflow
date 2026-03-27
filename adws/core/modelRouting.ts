/**
 * Model and effort routing for ADW slash commands.
 *
 * Contains all model-tier and reasoning-effort maps, plus helpers to
 * select the right values based on whether fast/cheap mode is active.
 * Extracted from config.ts to keep the god module under 300 lines and
 * to give this routing logic a dedicated home with a single responsibility.
 */

import type { SlashCommand } from '../types/issueTypes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Model tier identifiers supported by the Claude CLI `--model` flag. */
type ModelTier = 'opus' | 'sonnet' | 'haiku';

/** Reasoning effort level for Claude CLI `--effort` flag. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max';

// ---------------------------------------------------------------------------
// Model routing maps
// ---------------------------------------------------------------------------

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
  '/implement-tdd': 'sonnet',
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
  // KPI tracking
  '/track_agentic_kpis': 'haiku',
  // Utility
  '/find_plan_file': 'sonnet',
  // Dependency checking
  '/find_issue_dependencies': 'sonnet',
  '/extract_dependencies': 'haiku',
  // ADW initialization
  '/adw_init': 'sonnet',
  // Scenario writing
  '/scenario_writer': 'opus',
  // Step definition generation
  '/generate_step_definitions': 'sonnet',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
  // Single-pass alignment (complex reasoning, no downgrade)
  '/align_plan_scenarios': 'opus',
  // Install and prime
  '/install': 'sonnet',
  // Diff evaluation (binary classification, cheap)
  '/diff_evaluator': 'haiku',
};

/** Cost-optimized model map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_MODEL_MAP_FAST: Record<SlashCommand, ModelTier> = {
  '/classify_issue': 'haiku',
  '/feature': 'sonnet',
  '/bug': 'sonnet',
  '/chore': 'sonnet',
  '/pr_review': 'sonnet',
  '/implement': 'sonnet',
  '/implement-tdd': 'sonnet',
  '/patch': 'opus',
  '/review': 'sonnet',
  '/test': 'haiku',
  '/resolve_failed_test': 'opus',
  '/resolve_failed_e2e_test': 'opus',
  '/generate_branch_name': 'haiku',
  '/commit': 'haiku',
  '/pull_request': 'haiku',
  '/document': 'sonnet',
  '/track_agentic_kpis': 'haiku',
  '/find_plan_file': 'haiku',
  '/find_issue_dependencies': 'haiku',
  '/extract_dependencies': 'haiku',
  '/adw_init': 'haiku',
  // Scenario writing
  '/scenario_writer': 'sonnet',
  // Step definition generation
  '/generate_step_definitions': 'sonnet',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
  // Single-pass alignment (complex reasoning, no downgrade)
  '/align_plan_scenarios': 'sonnet',
  // Install and prime
  '/install': 'sonnet',
  // Diff evaluation (binary classification, cheap)
  '/diff_evaluator': 'haiku',
};

// ---------------------------------------------------------------------------
// Effort routing maps
// ---------------------------------------------------------------------------

/** Default reasoning effort per slash command. `undefined` means no flag is passed. */
export const SLASH_COMMAND_EFFORT_MAP: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': 'low',
  '/feature': 'high',
  '/bug': 'high',
  '/chore': 'high',
  '/pr_review': 'high',
  '/implement': 'high',
  '/implement-tdd': 'high',
  '/patch': 'high',
  '/review': 'high',
  '/test': undefined,
  '/resolve_failed_test': 'high',
  '/resolve_failed_e2e_test': 'high',
  '/generate_branch_name': 'low',
  '/commit': 'medium',
  '/pull_request': 'medium',
  '/document': 'medium',
  '/track_agentic_kpis': 'medium',
  '/find_plan_file': 'low',
  '/find_issue_dependencies': 'low',
  '/extract_dependencies': 'low',
  '/adw_init': 'medium',
  // Scenario writing
  '/scenario_writer': 'high',
  // Step definition generation
  '/generate_step_definitions': 'high',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'high',
  // Single-pass alignment
  '/align_plan_scenarios': 'high',
  // Install and prime
  '/install': 'medium',
  // Diff evaluation (binary classification, cheap)
  '/diff_evaluator': 'low',
};

/** Cost-optimized reasoning effort map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_EFFORT_MAP_FAST: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': 'low',
  '/feature': 'medium',
  '/bug': 'medium',
  '/chore': 'medium',
  '/pr_review': 'medium',
  '/implement': 'high',
  '/implement-tdd': 'high',
  '/patch': 'high',
  '/review': 'high',
  '/test': undefined,
  '/resolve_failed_test': 'medium',
  '/resolve_failed_e2e_test': 'medium',
  '/generate_branch_name': 'low',
  '/commit': 'low',
  '/pull_request': 'medium',
  '/document': 'medium',
  '/track_agentic_kpis': 'low',
  '/find_plan_file': 'low',
  '/find_issue_dependencies': 'low',
  '/extract_dependencies': 'low',
  '/adw_init': 'medium',
  // Scenario writing
  '/scenario_writer': 'medium',
  // Step definition generation
  '/generate_step_definitions': 'low',
  // Plan validation (complex reasoning, no downgrade)
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'high',
  // Single-pass alignment
  '/align_plan_scenarios': 'medium',
  // Install and prime
  '/install': 'low',
  // Diff evaluation (binary classification, cheap)
  '/diff_evaluator': 'low',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
