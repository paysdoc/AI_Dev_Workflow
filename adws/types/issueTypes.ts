/**
 * Supported slash commands for issue classification.
 * These should align with your custom slash commands in .claude/commands that you want to run.
 */
export type IssueClassSlashCommand = '/chore' | '/bug' | '/feature' | '/pr_review' | '/adw_init';

export const VALID_ISSUE_TYPES: readonly IssueClassSlashCommand[] = ['/chore', '/bug', '/feature', '/pr_review', '/adw_init'] as const;

/**
 * Valid ADW workflow slash commands for explicit workflow routing.
 */
export type AdwSlashCommand =
  | '/adw_plan'
  | '/adw_build'
  | '/adw_test'
  | '/adw_review'
  | '/adw_document'
  | '/adw_patch'
  | '/adw_plan_build'
  | '/adw_plan_build_test'
  | '/adw_plan_build_review'
  | '/adw_plan_build_document'
  | '/adw_plan_build_test_review'
  | '/adw_sdlc'
  | '/adw_init';

// Routing maps have moved to issueRouting.ts — re-exported here for backward compatibility.
export {
  adwCommandToIssueTypeMap,
  adwCommandToOrchestratorMap,
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
  | '/implement_tdd'
  // Test commands
  | '/test'
  | '/resolve_failed_test'
  | '/resolve_failed_e2e_test'
  // Review and patch commands
  | '/review'
  | '/patch'
  // Documentation
  | '/document'
  // Cost tracking
  | '/commit_cost'
  // KPI tracking
  | '/track_agentic_kpis'
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
  // Install and prime
  | '/install';

/**
 * GitHub user model.
 */
export interface GitHubUser {
  /** Not always returned by GitHub API */
  id?: string | null;
  login: string;
  name?: string | null;
  isBot: boolean;
}

/**
 * GitHub label model.
 */
export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

/**
 * GitHub milestone model.
 */
export interface GitHubMilestone {
  id: string;
  number: number;
  title: string;
  description?: string | null;
  state: string;
}

/**
 * GitHub comment model.
 */
export interface GitHubComment {
  id: string;
  author: GitHubUser;
  body: string;
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string - Not always returned */
  updatedAt?: string | null;
}

/**
 * GitHub issue model for list responses (simplified).
 */
export interface GitHubIssueListItem {
  number: number;
  title: string;
  body: string;
  labels: GitHubLabel[];
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
}

/**
 * GitHub issue model (full).
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  author: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  milestone?: GitHubMilestone | null;
  comments: GitHubComment[];
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
  /** ISO 8601 date string */
  closedAt?: string | null;
  url: string;
}

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

/**
 * Minimal issue comment from GitHub REST API (for listing/deleting).
 */
export interface IssueCommentSummary {
  /** Numeric REST API comment ID (required for deletion). */
  id: number;
  /** Comment body text. */
  body: string;
  /** Comment author login. */
  authorLogin: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}
