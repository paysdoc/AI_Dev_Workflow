/**
 * The forge a surface row's phase talks to, in-process. It implements only the port methods the
 * driven rows call: `commentOnIssue`, `applyLabel`, `moveToStatus` and,
 * for the cancel directive's handler, `fetchComments`, `getIssueTitle` and `deleteComment` of the issue tracker, and `getDefaultBranch`,
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

import { Platform, type CodeHost, type IssueComment, type IssueTracker, type RepoContext, type RepoIdentifier } from '@paysdoc/devplatform';
import { dispatchMockRequest, type MockResponse } from '../../../test/mocks/github-api-server.ts';

export const SURFACE_REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };

const UNKNOWN_TITLE = '(unknown)';

function notSupported(method: string): never {
  throw new Error(`mockForgeProviders: ${method} not supported`);
}

function dispatchOrThrow(method: string, httpMethod: string, path: string, payload?: Record<string, unknown>): MockResponse {
  const response = dispatchMockRequest(httpMethod, path, payload === undefined ? '' : JSON.stringify(payload));
  if (response.status >= 400) {
    throw new Error(`mockForgeProviders: ${method} was answered ${response.status}: ${response.body}`);
  }
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** GitHub's REST comment, as the port's `IssueComment`. */
function toIssueComment(raw: unknown): IssueComment {
  const record = isRecord(raw) ? raw : {};
  const user = isRecord(record['user']) ? record['user'] : {};
  return {
    id: String(record['id'] ?? ''),
    body: String(record['body'] ?? ''),
    author: String(user['login'] ?? ''),
    createdAt: String(record['created_at'] ?? ''),
  };
}

function commentsIn(responseBody: string): IssueComment[] {
  const parsed = parseJson(responseBody);
  return Array.isArray(parsed) ? parsed.map(toIssueComment) : [];
}

/** Fails open, as the port documents: an issue the mock does not hold, or a body with no title, is `(unknown)`. */
function titleIn(response: MockResponse): string {
  if (response.status >= 400) return UNKNOWN_TITLE;
  const parsed = parseJson(response.body);
  return isRecord(parsed) && typeof parsed['title'] === 'string' ? parsed['title'] : UNKNOWN_TITLE;
}

function createdPullRequestNumber(responseBody: string): number {
  const parsed: unknown = JSON.parse(responseBody);
  if (typeof parsed === 'object' && parsed !== null && 'number' in parsed && typeof parsed.number === 'number') return parsed.number;
  throw new Error(`mockForgeProviders: createPullRequest was answered a body with no numeric number: ${responseBody}`);
}

function issueTrackerFor(repoId: RepoIdentifier): IssueTracker {
  const repoPath = `/repos/${repoId.owner}/${repoId.repo}`;
  return {
    fetchIssue: () => notSupported('fetchIssue'),
    commentOnIssue: (issueNumber, body) => {
      dispatchOrThrow('commentOnIssue', 'POST', `${repoPath}/issues/${issueNumber}/comments`, { body });
    },
    deleteComment: (commentId) => {
      dispatchOrThrow('deleteComment', 'DELETE', `${repoPath}/issues/comments/${commentId}`);
    },
    closeIssue: () => notSupported('closeIssue'),
    getIssueState: () => notSupported('getIssueState'),
    fetchComments: (issueNumber) => commentsIn(dispatchOrThrow('fetchComments', 'GET', `${repoPath}/issues/${issueNumber}/comments`).body),
    // The mock server has no board route, and no row asserts on a board move.
    moveToStatus: async () => true,
    fetchLabels: () => notSupported('fetchLabels'),
    addLabel: () => notSupported('addLabel'),
    applyLabel: (issueNumber, labelName) => {
      dispatchOrThrow('applyLabel', 'POST', `${repoPath}/issues/${issueNumber}/labels`, { labels: [labelName] });
    },
    ensureLabel: () => notSupported('ensureLabel'),
    createIssue: () => notSupported('createIssue'),
    updateIssueBody: () => notSupported('updateIssueBody'),
    searchOpenIssues: () => notSupported('searchOpenIssues'),
    findOpenUpgradeIssue: () => notSupported('findOpenUpgradeIssue'),
    listIssues: () => notSupported('listIssues'),
    getIssueTitle: (issueNumber) => titleIn(dispatchMockRequest('GET', `${repoPath}/issues/${issueNumber}`, '')),
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
