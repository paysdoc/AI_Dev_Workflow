/**
 * The forge a surface row's phase talks to, in-process. It implements only the port methods the
 * driven rows call: `commentOnIssue` and `moveToStatus` of the issue tracker, and `getDefaultBranch`,
 * `createPullRequest`, `commentOnPullRequest` and `setSecret` of the code host. Any other method
 * throws, so a phase that starts needing one fails loudly instead of being answered with an
 * invented value.
 *
 * Every method that reaches the mock server goes through `dispatchMockRequest` rather than HTTP.
 * The port's methods are synchronous and the phases do not await them, so a request over the wire
 * could land after the phase had resolved and the Then steps had read the recorded requests. The
 * URL and body recorded here are exactly those an HTTP call would record.
 *
 * `getDefaultBranch` answers `main` because G11 commits the fixture on `main`.
 */

import { Platform, type CodeHost, type IssueTracker, type RepoContext, type RepoIdentifier } from '@paysdoc/devplatform';
import { dispatchMockRequest, type MockResponse } from '../../../test/mocks/github-api-server.ts';

export const SURFACE_REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };

function notSupported(method: string): never {
  throw new Error(`mockForgeProviders: ${method} not supported`);
}

function dispatchOrThrow(method: string, httpMethod: string, path: string, payload: Record<string, unknown>): MockResponse {
  const response = dispatchMockRequest(httpMethod, path, JSON.stringify(payload));
  if (response.status >= 400) {
    throw new Error(`mockForgeProviders: ${method} was answered ${response.status}: ${response.body}`);
  }
  return response;
}

function createdPullRequestNumber(responseBody: string): number {
  const parsed: unknown = JSON.parse(responseBody);
  if (typeof parsed === 'object' && parsed !== null && 'number' in parsed && typeof parsed.number === 'number') return parsed.number;
  throw new Error(`mockForgeProviders: createPullRequest was answered a body with no numeric number: ${responseBody}`);
}

function issueTrackerFor(repoId: RepoIdentifier): IssueTracker {
  return {
    fetchIssue: () => notSupported('fetchIssue'),
    commentOnIssue: (issueNumber, body) => {
      dispatchOrThrow('commentOnIssue', 'POST', `/repos/${repoId.owner}/${repoId.repo}/issues/${issueNumber}/comments`, { body });
    },
    deleteComment: () => notSupported('deleteComment'),
    closeIssue: () => notSupported('closeIssue'),
    getIssueState: () => notSupported('getIssueState'),
    fetchComments: () => notSupported('fetchComments'),
    // The mock server has no board route, and no row asserts on a board move.
    moveToStatus: async () => true,
    fetchLabels: () => notSupported('fetchLabels'),
    addLabel: () => notSupported('addLabel'),
    applyLabel: () => notSupported('applyLabel'),
    ensureLabel: () => notSupported('ensureLabel'),
    createIssue: () => notSupported('createIssue'),
    updateIssueBody: () => notSupported('updateIssueBody'),
    searchOpenIssues: () => notSupported('searchOpenIssues'),
    findOpenUpgradeIssue: () => notSupported('findOpenUpgradeIssue'),
    listIssues: () => notSupported('listIssues'),
    getIssueTitle: () => notSupported('getIssueTitle'),
  };
}

function codeHostFor(repoId: RepoIdentifier): CodeHost {
  const repoPath = `/repos/${repoId.owner}/${repoId.repo}`;
  return {
    getDefaultBranch: () => 'main',
    createPullRequest: ({ title, body, sourceBranch, targetBranch }) => {
      const response = dispatchOrThrow('createPullRequest', 'POST', `${repoPath}/pulls`, { title, body, head: sourceBranch, base: targetBranch });
      const number = createdPullRequestNumber(response.body);
      return { url: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${number}`, number };
    },
    fetchPullRequest: () => notSupported('fetchPullRequest'),
    // GitHub serves a pull request's conversation comments from its issue-comments endpoint.
    commentOnPullRequest: (prNumber, body) => {
      dispatchOrThrow('commentOnPullRequest', 'POST', `${repoPath}/issues/${prNumber}/comments`, { body });
    },
    fetchReviewComments: () => notSupported('fetchReviewComments'),
    listOpenPullRequests: () => notSupported('listOpenPullRequests'),
    getRepoIdentifier: () => notSupported('getRepoIdentifier'),
    findPullRequestByBranch: () => notSupported('findPullRequestByBranch'),
    isPullRequestApproved: () => notSupported('isPullRequestApproved'),
    approvePullRequest: () => notSupported('approvePullRequest'),
    mergePullRequest: () => notSupported('mergePullRequest'),
    // GitHub takes the value sealed with the repository's public key. The mock seals nothing, so the value goes as it is.
    setSecret: (name, value) => {
      dispatchOrThrow('setSecret', 'PUT', `${repoPath}/actions/secrets/${name}`, { encrypted_value: value });
    },
    listMergedPullRequests: () => notSupported('listMergedPullRequests'),
    listPullRequests: () => notSupported('listPullRequests'),
    getAuthenticatedUser: () => notSupported('getAuthenticatedUser'),
    canApprovePullRequests: () => notSupported('canApprovePullRequests'),
  };
}

export function mockForgeProviders(repoId: RepoIdentifier, worktreePath: string): RepoContext {
  return { issueTracker: issueTrackerFor(repoId), codeHost: codeHostFor(repoId), repoId, cwd: worktreePath };
}
