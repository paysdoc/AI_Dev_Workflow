import type { SlashCommand } from '../types/issueTypes';

type ModelTier = 'fable' | 'opus' | 'sonnet' | 'haiku';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const SLASH_COMMAND_MODEL_MAP: Record<SlashCommand, ModelTier> = {
  '/classify_issue': 'sonnet',
  // Planning (complex reasoning)
  '/feature': 'opus',
  '/bug': 'opus',
  '/chore': 'opus',
  '/pr_review': 'opus',
  '/implement': 'sonnet',
  '/implement-tdd': 'sonnet',
  '/patch': 'opus',
  // Review (complex reasoning)
  '/review': 'opus',
  // Test running (structured, cheap)
  '/test': 'haiku',
  '/resolve_failed_test': 'opus',
  '/resolve_failed_scenario': 'opus',
  '/generate_branch_name': 'sonnet',
  '/commit': 'sonnet',
  '/pull_request': 'sonnet',
  '/document': 'sonnet',
  '/find_plan_file': 'sonnet',
  '/find_issue_dependencies': 'sonnet',
  '/extract_dependencies': 'haiku',
  '/adw_init': 'sonnet',
  '/scenario_writer': 'opus',
  '/generate_step_definitions': 'sonnet',
  // no downgrade
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
  // no downgrade
  '/align_plan_scenarios': 'opus',
  // mirrors validate_plan_scenarios
  '/validate_scenario_fidelity': 'opus',
  '/install': 'sonnet',
  '/diff_evaluator': 'haiku',
  '/refactor': 'sonnet',
  '/promote_regression_vocabulary': 'sonnet',
};

/** Cost-optimized model map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_MODEL_MAP_FAST: Record<SlashCommand, ModelTier> = {
  '/classify_issue': 'haiku',
  '/feature': 'opus',
  '/bug': 'opus',
  '/chore': 'sonnet',
  '/pr_review': 'sonnet',
  '/implement': 'sonnet',
  '/implement-tdd': 'sonnet',
  '/patch': 'opus',
  '/review': 'opus',
  '/test': 'haiku',
  '/resolve_failed_test': 'opus',
  '/resolve_failed_scenario': 'opus',
  '/generate_branch_name': 'haiku',
  '/commit': 'haiku',
  '/pull_request': 'haiku',
  '/document': 'sonnet',
  '/find_plan_file': 'haiku',
  '/find_issue_dependencies': 'haiku',
  '/extract_dependencies': 'haiku',
  '/adw_init': 'haiku',
  '/scenario_writer': 'sonnet',
  '/generate_step_definitions': 'sonnet',
  // no downgrade
  '/validate_plan_scenarios': 'opus',
  '/resolve_plan_scenarios': 'opus',
  // no downgrade
  '/align_plan_scenarios': 'sonnet',
  // mirrors validate_plan_scenarios fast tier
  '/validate_scenario_fidelity': 'opus',
  '/install': 'sonnet',
  '/diff_evaluator': 'haiku',
  '/refactor': 'sonnet',
  '/promote_regression_vocabulary': 'haiku',
};

/**
 * `undefined` means no flag is passed.
 *
 * Effort-parameter support by model (Claude API):
 * - Opus 4.7 (`opus`): low, medium, high, xhigh, max
 * - Sonnet 4.6 (`sonnet`): low, medium, high, max — no xhigh
 * - Haiku 4.5 (`haiku`): effort parameter not supported — must be undefined
 *
 * This map must stay in sync with `SLASH_COMMAND_MODEL_MAP` above.
 */
export const SLASH_COMMAND_EFFORT_MAP: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': 'low',
  '/feature': 'max',
  '/bug': 'max',
  '/chore': 'high',
  '/pr_review': 'high',
  '/implement': 'max',
  '/implement-tdd': 'max',
  '/patch': 'max',
  '/review': 'max',
  '/test': undefined,
  '/resolve_failed_test': 'max',
  '/resolve_failed_scenario': 'max',
  '/generate_branch_name': 'low',
  '/commit': 'medium',
  '/pull_request': 'medium',
  '/document': 'medium',
  '/find_plan_file': 'low',
  '/find_issue_dependencies': 'low',
  '/extract_dependencies': undefined,
  '/adw_init': 'medium',
  '/scenario_writer': 'max',
  '/generate_step_definitions': 'max',
  // no downgrade
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'max',
  '/align_plan_scenarios': 'max',
  // mirrors validate_plan_scenarios effort
  '/validate_scenario_fidelity': 'high',
  '/install': 'medium',
  '/diff_evaluator': undefined,
  '/refactor': 'high',
  '/promote_regression_vocabulary': 'medium',
};

/** Cost-optimized reasoning effort map used when the issue body contains `/fast` or `/cheap`. */
export const SLASH_COMMAND_EFFORT_MAP_FAST: Record<SlashCommand, ReasoningEffort | undefined> = {
  '/classify_issue': undefined,
  '/feature': 'max',
  '/bug': 'max',
  '/chore': 'medium',
  '/pr_review': 'medium',
  '/implement': 'high',
  '/implement-tdd': 'high',
  '/patch': 'high',
  '/review': 'high',
  '/test': undefined,
  '/resolve_failed_test': 'medium',
  '/resolve_failed_scenario': 'medium',
  '/generate_branch_name': undefined,
  '/commit': undefined,
  '/pull_request': undefined,
  '/document': 'medium',
  '/find_plan_file': undefined,
  '/find_issue_dependencies': undefined,
  '/extract_dependencies': undefined,
  '/adw_init': undefined,
  '/scenario_writer': 'medium',
  '/generate_step_definitions': 'low',
  // no downgrade
  '/validate_plan_scenarios': 'high',
  '/resolve_plan_scenarios': 'high',
  '/align_plan_scenarios': 'medium',
  '/validate_scenario_fidelity': 'high',
  '/install': 'low',
  '/diff_evaluator': undefined,
  '/refactor': 'high',
  '/promote_regression_vocabulary': 'medium',
};

export function isFastMode(issueBody?: string): boolean {
  if (!issueBody) return false;
  return /\/fast\b|\/cheap\b/i.test(issueBody);
}

/** Selects the fast/cheap map when the issue body contains `/fast` or `/cheap` keywords. */
export function getModelForCommand(
  command: SlashCommand,
  issueBody?: string,
): ModelTier {
  const map = isFastMode(issueBody)
    ? SLASH_COMMAND_MODEL_MAP_FAST
    : SLASH_COMMAND_MODEL_MAP;
  return map[command];
}

export function getEffortForCommand(
  command: SlashCommand,
  issueBody?: string,
): ReasoningEffort | undefined {
  const map = isFastMode(issueBody)
    ? SLASH_COMMAND_EFFORT_MAP_FAST
    : SLASH_COMMAND_EFFORT_MAP;
  return map[command];
}
