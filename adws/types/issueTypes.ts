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

/**
 * Maps ADW workflow commands to issue classification types.
 * Commands with test phases map to /feature, without test to /bug,
 * planning/documentation-only to /chore, review-focused to /pr_review.
 */
export const adwCommandToIssueTypeMap: Record<AdwSlashCommand, IssueClassSlashCommand> = {
  '/adw_plan': '/chore',
  '/adw_build': '/feature',
  '/adw_test': '/feature',
  '/adw_review': '/pr_review',
  '/adw_document': '/chore',
  '/adw_patch': '/bug',
  '/adw_plan_build': '/bug',
  '/adw_plan_build_test': '/feature',
  '/adw_plan_build_review': '/pr_review',
  '/adw_plan_build_document': '/chore',
  '/adw_plan_build_test_review': '/feature',
  '/adw_sdlc': '/feature',
  '/adw_init': '/adw_init',
};

/**
 * Maps ADW workflow commands to their dedicated orchestrator scripts.
 * Commands present in this map bypass issue-type-based routing and route
 * directly to the specified orchestrator.
 */
export const adwCommandToOrchestratorMap: Partial<Record<AdwSlashCommand, string>> = {
  '/adw_plan': 'adws/adwPlan.tsx',
  '/adw_build': 'adws/adwBuild.tsx',
  '/adw_test': 'adws/adwTest.tsx',
  '/adw_review': 'adws/adwPrReview.tsx',
  '/adw_document': 'adws/adwDocument.tsx',
  '/adw_patch': 'adws/adwPatch.tsx',
  '/adw_plan_build': 'adws/adwPlanBuild.tsx',
  '/adw_plan_build_test': 'adws/adwPlanBuildTest.tsx',
  '/adw_plan_build_review': 'adws/adwPlanBuildReview.tsx',
  '/adw_plan_build_document': 'adws/adwPlanBuildDocument.tsx',
  '/adw_plan_build_test_review': 'adws/adwPlanBuildTestReview.tsx',
  '/adw_sdlc': 'adws/adwSdlc.tsx',
  '/adw_init': 'adws/adwInit.tsx',
} as const;

/**
 * Maps issue classification types to their default orchestrator scripts.
 * Used by triggers to determine which ADW workflow to spawn when no
 * explicit ADW command is provided.
 */
export const issueTypeToOrchestratorMap: Record<IssueClassSlashCommand, string> = {
  '/bug': 'adws/adwPlanBuildTest.tsx',
  '/chore': 'adws/adwPlanBuild.tsx',
  '/feature': 'adws/adwSdlc.tsx',
  '/pr_review': 'adws/adwPlanBuild.tsx',
  '/adw_init': 'adws/adwInit.tsx',
};

/**
 * Maps issue classification to commit message prefixes.
 * Following conventional commits specification.
 */
export const commitPrefixMap: Record<IssueClassSlashCommand, string> = {
  '/feature': 'feat:',
  '/bug': 'fix:',
  '/chore': 'chore:',
  '/pr_review': 'review:',
  '/adw_init': 'adwinit:',
};

/**
 * Maps issue classification to branch name prefixes.
 * Following common Git branching conventions.
 */
export const branchPrefixMap: Record<IssueClassSlashCommand, string> = {
  '/feature': 'feature',
  '/bug': 'bugfix',
  '/chore': 'chore',
  '/pr_review': 'review',
  '/adw_init': 'adwinit',
  };

/**
 * Alternative branch name prefixes that the Claude skill may generate.
 * Used by findWorktreeForIssue to match worktrees created with non-canonical prefixes.
 */
export const branchPrefixAliases: Record<IssueClassSlashCommand, readonly string[]> = {
  '/feature': ['feat'],
  '/bug': ['bug'],
  '/chore': [],
  '/pr_review': ['test'],
  '/adw_init' : ['adwinit'],
};

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
  // Plan validation commands
  | '/validate_plan_scenarios'
  | '/resolve_plan_scenarios';

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
