/**
 * The forge of the feature-1101 scenarios is feature-1100's strict stand-in, with one addition: every comment on an issue and
 * every merge call is also made as a request to the mock GitHub API, in process, so that the Thens the regression suite shares
 * ("the mock GitHub API recorded a merge of PR …", "… recorded exactly 1 comment on issue … containing the text …") read what
 * the merge run did to GitHub from the mock server's request log. What GitHub answers to a merge call stays scripted per call.
 */

import type { CodeHost, IssueTracker, PullRequestSummary } from '@paysdoc/devplatform';

import { dispatchMockRequest } from '../../../test/mocks/github-api-server.ts';
import { createForge, strictPort, type Forge, type MergeAnswer } from './feature-1100-forge.ts';
import { OWNER, REPO } from './feature-1100-world.ts';

/** More merge calls than any scenario makes. */
const CALLS_ANSWERED = 10;

export function mergedAnswers(count = CALLS_ANSWERED): MergeAnswer[] {
  return Array.from({ length: count }, () => ({ merged: true }));
}

export function refusedThenMergedAnswers(error: string): MergeAnswer[] {
  return [{ merged: false, error }, ...mergedAnswers()];
}

export function createRecordingForge(pullRequest: PullRequestSummary): Forge {
  const forge = createForge(pullRequest);
  const { codeHost, issueTracker } = forge.providers;

  const recordingCodeHost = strictPort<CodeHost>('code host', {
    findPullRequestByBranch: (branchName) => codeHost.findPullRequestByBranch(branchName),
    isPullRequestApproved: (prNumber) => codeHost.isPullRequestApproved(prNumber),
    mergePullRequest(prNumber) {
      dispatchMockRequest('PUT', `/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, '{}');
      return codeHost.mergePullRequest(prNumber);
    },
  });
  const recordingIssueTracker = strictPort<IssueTracker>('issue tracker', {
    fetchLabels: (issueNumber) => issueTracker.fetchLabels(issueNumber),
    commentOnIssue(issueNumber, body) {
      dispatchMockRequest('POST', `/repos/${OWNER}/${REPO}/issues/${issueNumber}/comments`, JSON.stringify({ body }));
      issueTracker.commentOnIssue(issueNumber, body);
    },
  });

  return { ...forge, providers: { ...forge.providers, codeHost: recordingCodeHost, issueTracker: recordingIssueTracker } };
}
