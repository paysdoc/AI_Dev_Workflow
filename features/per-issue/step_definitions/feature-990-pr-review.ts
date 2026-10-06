/**
 * What an `adwPrReview` run needs that the other orchestrators make for themselves. A PR review resumes the workflow
 * that opened the issue's pull request, by the adwId and the branch its state recorded, and starts only when a human
 * has reviewed that pull request. So the pull request is seeded on the mock forge, against the base branch and carrying
 * a human's review, and the issue's adwId is seeded with its branch, as the SDLC run that opened the pull request left it.
 * The branch itself is made in the target workspace once the base branch has been committed to, since the review checks
 * out a worktree of it and cannot make a branch that does not exist.
 */

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { MockContext } from '../../../test/mocks/types.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';

import { BASE_BRANCH } from './feature-990-world.ts';

export const PR_REVIEW_ORCHESTRATOR = 'adwPrReview';

const REVIEWER = 'maintainer';
const REVIEW = 'Please keep the delivery fee out of the cart total.';
/** Issues and pull requests share one number space on a forge. */
const PULL_REQUEST_OFFSET = 10_000;
const REVIEW_AGE_MS = 30 * 60_000;

function branchNameFor(issue: number): string {
  return `feature-issue-${issue}-baseline-gate`;
}

export async function seedPullRequestReview(mock: MockContext, issue: number, adwId: string): Promise<void> {
  const number = issue + PULL_REQUEST_OFFSET;
  const branch = branchNameFor(issue);
  const reviewedAt = new Date(Date.now() - REVIEW_AGE_MS).toISOString();
  await mock.setState({
    prs: {
      [String(number)]: {
        number,
        title: `Check the base branch before any work (${issue})`,
        body: `Implements #${issue}`,
        state: 'open',
        user: { login: 'test-user' },
        head: { ref: branch },
        base: { ref: BASE_BRANCH },
        reviews: [{ user: { login: REVIEWER }, state: 'CHANGES_REQUESTED', body: REVIEW, submitted_at: reviewedAt }],
        created_at: reviewedAt,
        updated_at: reviewedAt,
      },
    },
  });
  AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: issue, branchName: branch });
}

/** The branch of the issue's pull request, at the tip of the base branch. */
export function ensurePullRequestBranch(workspace: string, issue: number): void {
  const branch = branchNameFor(issue);
  if (realGit(workspace, 'branch', '--list', branch) !== '') return;
  realGit(workspace, 'branch', branch, BASE_BRANCH);
}
