/**
 * Routing maps for ADW issue dispatch.
 *
 * Extracted from issueTypes.ts — routing logic is separate from type definitions.
 * These maps determine which orchestrator script handles which issue type.
 */

import type { IssueClassSlashCommand } from './issueTypes';

/**
 * Maps issue classification types to their default orchestrator scripts.
 * Used by triggers to determine which ADW workflow to spawn when no
 * explicit ADW command is provided.
 */
export const issueTypeToOrchestratorMap: Partial<Record<IssueClassSlashCommand, string>> = {
  '/bug': 'adws/adwSdlc.tsx',
  '/chore': 'adws/adwChore.tsx',
  '/feature': 'adws/adwSdlc.tsx',
  '/pr_review': 'adws/adwPlanBuild.tsx',
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
