/**
 * Supported slash commands for issue classification.
 * These should align with your custom slash commands in .claude/commands that you want to run.
 */
export type IssueClassSlashCommand = '/chore' | '/bug' | '/feature' | '/pr_review' | '/adw_init';

// /adw_init is intentionally excluded: it is an operator-only bootstrap command with no
// orchestrator since #547. Keeping it here would let the AI classifier / --issue-type CLI
// assign it, which dead-ends in an ENOENT plan-file error (issue #584). It remains in the
// IssueClassSlashCommand/SlashCommand unions for the prefix/alias maps and manual init flow.
export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review'] as const;


// Routing maps have moved to issueRouting.ts — re-exported here for backward compatibility.
export {
  issueTypeToOrchestratorMap,
  commitPrefixMap,
  branchPrefixMap,
  branchPrefixAliases,
} from './issueRouting';

/**
 * All slash commands used in the ADW system.
 * Includes issue classification commands and ADW-specific commands.
 */
export type SlashCommand =
  // Issue classification commands
  | '/chore'
  | '/bug'
  | '/feature'
  | '/pr_review'
  // ADW workflow commands
  | '/classify_issue'
  | '/find_plan_file'
  | '/generate_branch_name'
  | '/commit'
  | '/pull_request'
  | '/implement'
  | '/implement-tdd'
  // Test commands
  | '/test'
  | '/resolve_failed_test'
  | '/resolve_failed_scenario'
  // Review and patch commands
  | '/review'
  | '/patch'
  // Refactor
  | '/refactor'
  // Documentation
  | '/document'
  // Dependency checking
  | '/find_issue_dependencies'
  | '/extract_dependencies'
  // ADW initialization
  | '/adw_init'
  // Scenario writing
  | '/scenario_writer'
  // Step definition generation
  | '/generate_step_definitions'
  // Plan validation commands
  | '/validate_plan_scenarios'
  | '/resolve_plan_scenarios'
  // Single-pass alignment command
  | '/align_plan_scenarios'
  // Scenario fidelity re-check (post-resolve, scenarios vs issue body)
  | '/validate_scenario_fidelity'
  // Install and prime
  | '/install'
  // Diff evaluation
  | '/diff_evaluator'
  // Promotion rot/reuse advisory analysis
  | '/promote_regression_vocabulary';

/**
 * GitHub webhook payload for pull_request events.
 */
export interface PullRequestWebhookPayload {
  action: 'opened' | 'closed' | 'reopened' | 'synchronize' | 'edited';
  pull_request: {
    number: number;
    state: string;
    merged: boolean;
    body: string | null;
    html_url: string;
    title: string;
    base: { ref: string };
    head: { ref: string };
  };
  repository: {
    name: string;
    owner: { login: string };
    full_name: string;
    clone_url?: string;
  };
}

/**
 * Target repository context for external repo workflows.
 * Carries repository identity and workspace location through the workflow.
 */
export interface TargetRepoInfo {
  owner: string;
  repo: string;
  cloneUrl: string;
  workspacePath?: string;
}

