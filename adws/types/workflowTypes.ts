import type { GitHubUser } from './issueTypes';

/**
 * Workflow stages for ADW progress tracking.
 */
export type WorkflowStage =
  | 'starting'
  | 'resuming'
  | 'classified'
  | 'branch_created'
  | 'plan_building'
  | 'plan_created'
  | 'planFile_created'
  | 'plan_committing'
  | 'build_running'
  | 'build_progress'
  | 'build_completed'
  | 'build_committing'
  | 'pr_creating'
  | 'pr_created'
  | 'completed'
  | 'error'
  // Test workflow stages
  | 'test_running'
  | 'test_failed'
  | 'test_resolving'
  | 'test_passed'
  // Review workflow stages
  | 'review_running'
  | 'review_passed'
  | 'review_failed'
  | 'review_patching'
  // Document workflow stages
  | 'document_running'
  | 'document_completed'
  | 'document_failed'
  // Token limit recovery
  | 'token_limit_recovery'
  // Context compaction recovery
  | 'compaction_recovery'
  // Phase-specific compaction recovery
  | 'test_compaction_recovery'
  | 'review_compaction_recovery'
  // Plan validation stages
  | 'plan_validating'
  | 'plan_validated'
  | 'plan_resolving'
  | 'plan_resolved'
  | 'plan_validation_failed'
  // Single-pass alignment stages
  | 'plan_aligning'
  | 'plan_aligned'
  // Install phase stages
  | 'install_running'
  | 'install_completed'
  | 'install_failed'
  // Pause/resume stages
  | 'paused'
  | 'resumed'
  // Handoff stages
  | 'awaiting_merge';

/**
 * PR review comment from GitHub API.
 */
export interface PRReviewComment {
  id: number;
  author: GitHubUser;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * PR details from GitHub API.
 */
export interface PRDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  /** Extracted from PR body (e.g., "Implements #12") */
  issueNumber: number | null;
  reviewComments: PRReviewComment[];
}

/**
 * PR list item for CRON trigger polling.
 */
export interface PRListItem {
  number: number;
  headBranch: string;
  updatedAt: string;
}

/**
 * Workflow stages for PR review progress tracking.
 */
export type PRReviewWorkflowStage =
  | 'pr_review_starting'
  | 'pr_review_planning'
  | 'pr_review_planned'
  | 'pr_review_implementing'
  | 'pr_review_implemented'
  | 'pr_review_testing'
  | 'pr_review_test_failed'
  | 'pr_review_test_passed'
  | 'pr_review_test_max_attempts'
  | 'pr_review_committing'
  | 'pr_review_pushed'
  | 'pr_review_completed'
  | 'pr_review_error';

/**
 * Recovery state for resuming a workflow from a previous run.
 */
export interface RecoveryState {
  /** The last successfully completed stage */
  lastCompletedStage: WorkflowStage | null;
  /** The ADW ID from the previous run (extracted from comments) */
  adwId: string | null;
  /** The branch name from previous run */
  branchName: string | null;
  /** The plan file path from previous run */
  planPath: string | null;
  /** The PR URL if already created */
  prUrl: string | null;
  /** Whether recovery is possible */
  canResume: boolean;
}
