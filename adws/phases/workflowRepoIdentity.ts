/**
 * Replaces every `?? getRepoInfo()` wrong-repo-fallback idiom in the phases
 * with a single precedence over the identity a `WorkflowConfig` already
 * carries (#820). `repoContext.repoId` → `gitContext` → `targetRepo`: all
 * three sources agree by construction (`bindWorkspaceContext` refuses a
 * mismatch), so precedence only decides which object is read, never which
 * repository is addressed. A config carrying none of the three is a
 * programming error — `initializeWorkflow` always sets at least one — so
 * this throws rather than falling back to the ambient local git remote.
 */

import { Platform, type RepoIdentifier } from '../providers/types';
import type { GitContext } from '../gitContext';
import type { WorkflowConfig } from './workflowInit';

export function resolveWorkflowRepoId(config: Pick<WorkflowConfig, 'repoContext' | 'gitContext' | 'targetRepo'>): RepoIdentifier {
  if (config.repoContext) return config.repoContext.repoId;
  if (config.gitContext) return { owner: config.gitContext.owner, repo: config.gitContext.repo, platform: Platform.GitHub };
  if (config.targetRepo) return { owner: config.targetRepo.owner, repo: config.targetRepo.repo, platform: Platform.GitHub };
  throw new Error(
    'resolveWorkflowRepoId: this WorkflowConfig carries no launch identity (repoContext, gitContext or targetRepo) — initializeWorkflow always sets one',
  );
}

/**
 * Returns the launch-boundary GitContext a WorkflowConfig carries, or throws.
 * `gitContext` is optional only for phase-test fixtures — every production
 * config comes from initializeWorkflow or initializePRReviewWorkflow, both of
 * which always set one.
 */
export function requireWorkflowGitContext(config: Pick<WorkflowConfig, 'gitContext'>): GitContext {
  if (config.gitContext) return config.gitContext;
  throw new Error(
    'requireWorkflowGitContext: this WorkflowConfig carries no launch GitContext — initializeWorkflow and initializePRReviewWorkflow always set one',
  );
}
