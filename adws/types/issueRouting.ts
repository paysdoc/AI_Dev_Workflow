/**
 * Routing maps for ADW issue and command dispatch.
 *
 * Extracted from issueTypes.ts — routing logic is separate from type definitions.
 * These maps determine which orchestrator script handles which issue type or ADW command.
 */

import type { IssueClassSlashCommand } from './issueTypes';
import type { AdwSlashCommand } from './issueTypes';

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
  '/bug': 'adws/adwSdlc.tsx',
  '/chore': 'adws/adwChore.tsx',
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
  '/adw_init': ['adwinit'],
};
