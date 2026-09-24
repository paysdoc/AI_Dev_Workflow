/** These should align with your custom slash commands in .claude/commands that you want to run. */
export type IssueClassSlashCommand = '/chore' | '/bug' | '/feature' | '/pr_review' | '/adw_init';

// /adw_init is intentionally excluded: it is an operator-only bootstrap command with no
// orchestrator. Keeping it here would let the AI classifier / --issue-type CLI
// assign it, which dead-ends in an ENOENT plan-file error. It remains in the
// IssueClassSlashCommand/SlashCommand unions for the prefix/alias maps and manual init flow.
export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review'] as const;


// Routing maps have moved to issueRouting.ts — re-exported here for backward compatibility.
export {
  issueTypeToOrchestratorMap,
  commitPrefixMap,
  branchPrefixMap,
  branchPrefixAliases,
} from './issueRouting';

export type SlashCommand =
  | '/chore'
  | '/bug'
  | '/feature'
  | '/pr_review'
  | '/classify_issue'
  | '/find_plan_file'
  | '/generate_branch_name'
  | '/commit'
  | '/pull_request'
  | '/implement'
  | '/implement-tdd'
  | '/test'
  | '/resolve_failed_test'
  | '/resolve_failed_scenario'
  | '/review'
  | '/patch'
  | '/refactor'
  | '/document'
  | '/find_issue_dependencies'
  | '/extract_dependencies'
  | '/adw_init'
  | '/scenario_writer'
  | '/generate_step_definitions'
  | '/validate_plan_scenarios'
  | '/resolve_plan_scenarios'
  | '/align_plan_scenarios'
  | '/validate_scenario_fidelity'
  | '/install'
  | '/diff_evaluator'
  | '/promote_regression_vocabulary';

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

/** Target repository context for external repo workflows. */
export interface TargetRepoInfo {
  owner: string;
  repo: string;
  cloneUrl: string;
  workspacePath?: string;
}

