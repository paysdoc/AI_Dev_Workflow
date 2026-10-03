/**
 * The forge a surface row's phase talks to, in-process. It implements only the port methods the
 * driven rows call; any other method throws, so a phase that starts needing one fails loudly
 * instead of being answered with an invented value.
 *
 * `commentOnIssue` and `applyLabel` go through `dispatchMockRequest` rather than HTTP. The port's
 * methods are synchronous and the phases do not await them, so a request over the wire could land
 * after the phase had resolved and the Then steps had read the recorded requests. The URL and body
 * recorded here are exactly those an HTTP call would record.
 */

import { Platform, type CodeHost, type IssueTracker, type RepoContext, type RepoIdentifier } from '@paysdoc/devplatform';
import { dispatchMockRequest } from '../../../test/mocks/github-api-server.ts';

export const SURFACE_REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };

function notSupported(method: string): never {
  throw new Error(`mockForgeProviders: ${method} not supported`);
}

function dispatchOrThrow(operation: string, method: string, path: string, body: unknown): void {
  const response = dispatchMockRequest(method, path, JSON.stringify(body));
  if (response.status >= 400) {
    throw new Error(`mockForgeProviders: ${operation} was answered ${response.status}: ${response.body}`);
  }
}

function issueTrackerFor(repoId: RepoIdentifier): IssueTracker {
  const issuePath = (issueNumber: number, resource: string): string => `/repos/${repoId.owner}/${repoId.repo}/issues/${issueNumber}/${resource}`;
  return {
    fetchIssue: () => notSupported('fetchIssue'),
    commentOnIssue: (issueNumber, body) => dispatchOrThrow('commentOnIssue', 'POST', issuePath(issueNumber, 'comments'), { body }),
    deleteComment: () => notSupported('deleteComment'),
    closeIssue: () => notSupported('closeIssue'),
    getIssueState: () => notSupported('getIssueState'),
    fetchComments: () => notSupported('fetchComments'),
    // The mock server has no board route, and no row asserts on a board move.
    moveToStatus: async () => true,
    fetchLabels: () => notSupported('fetchLabels'),
    addLabel: () => notSupported('addLabel'),
    applyLabel: (issueNumber, labelName) => dispatchOrThrow('applyLabel', 'POST', issuePath(issueNumber, 'labels'), { labels: [labelName] }),
    ensureLabel: () => notSupported('ensureLabel'),
    createIssue: () => notSupported('createIssue'),
    updateIssueBody: () => notSupported('updateIssueBody'),
    searchOpenIssues: () => notSupported('searchOpenIssues'),
    findOpenUpgradeIssue: () => notSupported('findOpenUpgradeIssue'),
    listIssues: () => notSupported('listIssues'),
    getIssueTitle: () => notSupported('getIssueTitle'),
  };
}

const unsupportedCodeHost: CodeHost = {
  getDefaultBranch: () => notSupported('getDefaultBranch'),
  createPullRequest: () => notSupported('createPullRequest'),
  fetchPullRequest: () => notSupported('fetchPullRequest'),
  commentOnPullRequest: () => notSupported('commentOnPullRequest'),
  fetchReviewComments: () => notSupported('fetchReviewComments'),
  listOpenPullRequests: () => notSupported('listOpenPullRequests'),
  getRepoIdentifier: () => notSupported('getRepoIdentifier'),
  findPullRequestByBranch: () => notSupported('findPullRequestByBranch'),
  isPullRequestApproved: () => notSupported('isPullRequestApproved'),
  approvePullRequest: () => notSupported('approvePullRequest'),
  mergePullRequest: () => notSupported('mergePullRequest'),
  setSecret: () => notSupported('setSecret'),
  listMergedPullRequests: () => notSupported('listMergedPullRequests'),
  listPullRequests: () => notSupported('listPullRequests'),
  getAuthenticatedUser: () => notSupported('getAuthenticatedUser'),
  canApprovePullRequests: () => notSupported('canApprovePullRequests'),
};

export function mockForgeProviders(repoId: RepoIdentifier, worktreePath: string): RepoContext {
  return { issueTracker: issueTrackerFor(repoId), codeHost: unsupportedCodeHost, repoId, cwd: worktreePath };
}
