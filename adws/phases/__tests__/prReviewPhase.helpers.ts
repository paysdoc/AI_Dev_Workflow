import { Platform } from '@paysdoc/devplatform';
import { AgentStateManager } from '../../core/agentState';
import type { LaunchBoundary } from '../../core';

const BRANCH = 'bugfix-issue-9600-pr-review-owner';
export const ISSUE_NUMBER = 9600;
export const PR_NUMBER = 96;
export const FINISHED_RUN = { pid: 2147483646, pidStartedAt: 'finished-sdlc-run', lastSeenAt: '2026-01-01T00:00:00.000Z' } as const;
export const TARGET_BRANCH = 'trunk';
export const WORKTREE_PATH = '/tmp/adw-pr-review-owner-unit';
export const PR_REVIEW_SCRIPT = 'adws/adwPrReview.tsx';
export const SDLC_SCRIPT = 'adws/adwSdlc.tsx';

export function boundaryFor(linkedIssueNumber: number | undefined): LaunchBoundary {
  return {
    repoId: { owner: 'acme', repo: 'widget', platform: Platform.GitHub },
    providers: {
      codeHost: {
        fetchPullRequest: () => ({
          number: PR_NUMBER,
          title: 'Tidy the retry budget',
          body: '',
          state: 'OPEN',
          sourceBranch: BRANCH,
          targetBranch: TARGET_BRANCH,
          url: '',
          linkedIssueNumber,
        }),
        fetchReviewComments: () => [],
        getAuthenticatedUser: () => 'adw-bot',
      },
    },
    gitContext: { owner: 'acme', repo: 'widget', ensureWorktree: () => WORKTREE_PATH },
  } as unknown as LaunchBoundary;
}

export const BOUNDARY = boundaryFor(ISSUE_NUMBER);

/** What the SDLC run leaves for the PR review to find: awaiting_merge, its own dead owner, and one recorded phase. */
export function seedFinishedSdlcRun(adwId: string): void {
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: ISSUE_NUMBER,
    workflowStage: 'awaiting_merge',
    orchestratorScript: SDLC_SCRIPT,
    branchName: BRANCH,
    ...FINISHED_RUN,
    // A recorded phase is what lets init run with no unaddressed comments instead of exiting.
    phases: { stepDef: { status: 'completed', startedAt: FINISHED_RUN.lastSeenAt, completedAt: FINISHED_RUN.lastSeenAt } },
  });
}
