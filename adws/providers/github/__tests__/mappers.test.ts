import { describe, it, expect } from 'vitest';
import {
  mapGitHubIssueToWorkItem,
  mapGitHubCommentToWorkItemComment,
  mapIssueCommentSummaryToWorkItemComment,
  toRepoInfo,
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
} from '../mappers';
import type { GitHubIssue, GitHubComment, IssueCommentSummary } from '../../../types/issueTypes';
import type { PRDetails, PRReviewComment, PRListItem } from '../../../types/workflowTypes';
import { Platform, type RepoIdentifier } from '../../types';

// ── IssueTracker test helpers ───────────────────────────────────────────

const makeGitHubComment = (overrides: Partial<GitHubComment> = {}): GitHubComment => ({
  id: 'comment-1',
  author: { login: 'alice', name: 'Alice', isBot: false },
  body: 'A comment',
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-15T11:00:00Z',
  ...overrides,
});

const makeGitHubIssue = (overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  number: 42,
  title: 'Test issue',
  body: 'Issue body',
  state: 'OPEN',
  author: { login: 'bob', name: 'Bob', isBot: false },
  assignees: [{ login: 'carol', name: 'Carol', isBot: false }],
  labels: [{ id: 'lbl-1', name: 'bug', color: 'red', description: 'A bug' }],
  milestone: { id: 'ms-1', number: 1, title: 'v1.0', description: 'First release', state: 'open' },
  comments: [makeGitHubComment()],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  closedAt: null,
  url: 'https://github.com/acme/widgets/issues/42',
  ...overrides,
});

// ── IssueTracker mapper tests ───────────────────────────────────────────

describe('mapGitHubCommentToWorkItemComment', () => {
  it('maps all fields correctly', () => {
    const comment = makeGitHubComment();
    const result = mapGitHubCommentToWorkItemComment(comment);

    expect(result).toEqual({
      id: 'comment-1',
      body: 'A comment',
      author: 'alice',
      createdAt: '2026-01-15T10:00:00Z',
    });
  });

  it('maps comment with null updatedAt without affecting output', () => {
    const comment = makeGitHubComment({ updatedAt: null });
    const result = mapGitHubCommentToWorkItemComment(comment);

    expect(result.id).toBe('comment-1');
    expect(result.author).toBe('alice');
    expect(result).not.toHaveProperty('updatedAt');
  });

  it('maps comment from bot author', () => {
    const comment = makeGitHubComment({
      author: { login: 'dependabot[bot]', name: null, isBot: true },
    });
    const result = mapGitHubCommentToWorkItemComment(comment);

    expect(result.author).toBe('dependabot[bot]');
  });
});

describe('mapGitHubIssueToWorkItem', () => {
  it('maps a full issue with all fields populated', () => {
    const issue = makeGitHubIssue();
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result).toEqual({
      id: '42',
      number: 42,
      title: 'Test issue',
      body: 'Issue body',
      state: 'OPEN',
      author: 'bob',
      labels: ['bug'],
      comments: [{
        id: 'comment-1',
        body: 'A comment',
        author: 'alice',
        createdAt: '2026-01-15T10:00:00Z',
      }],
    });
  });

  it('id is the string version of number', () => {
    const issue = makeGitHubIssue({ number: 999 });
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result.id).toBe('999');
    expect(result.number).toBe(999);
  });

  it('maps issue with empty comments, labels, and body', () => {
    const issue = makeGitHubIssue({
      comments: [],
      labels: [],
      body: '',
    });
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result.comments).toEqual([]);
    expect(result.labels).toEqual([]);
    expect(result.body).toBe('');
  });

  it('maps issue with bot author', () => {
    const issue = makeGitHubIssue({
      author: { login: 'github-actions[bot]', name: null, isBot: true },
    });
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result.author).toBe('github-actions[bot]');
  });

  it('maps multiple labels to string array', () => {
    const issue = makeGitHubIssue({
      labels: [
        { id: 'lbl-1', name: 'bug', color: 'red', description: null },
        { id: 'lbl-2', name: 'priority:high', color: 'orange', description: 'High priority' },
        { id: 'lbl-3', name: 'enhancement', color: 'blue', description: null },
      ],
    });
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result.labels).toEqual(['bug', 'priority:high', 'enhancement']);
  });

  it('maps multiple comments', () => {
    const issue = makeGitHubIssue({
      comments: [
        makeGitHubComment({ id: 'c1', body: 'First' }),
        makeGitHubComment({ id: 'c2', body: 'Second', author: { login: 'dan', name: 'Dan', isBot: false } }),
      ],
    });
    const result = mapGitHubIssueToWorkItem(issue);

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].id).toBe('c1');
    expect(result.comments[1].author).toBe('dan');
  });
});

describe('mapIssueCommentSummaryToWorkItemComment', () => {
  it('maps all fields correctly with numeric id converted to string', () => {
    const comment: IssueCommentSummary = {
      id: 12345,
      body: 'REST comment',
      authorLogin: 'eve',
      createdAt: '2026-02-01T00:00:00Z',
    };
    const result = mapIssueCommentSummaryToWorkItemComment(comment);

    expect(result).toEqual({
      id: '12345',
      body: 'REST comment',
      author: 'eve',
      createdAt: '2026-02-01T00:00:00Z',
    });
  });

  it('converts numeric id to string', () => {
    const comment: IssueCommentSummary = {
      id: 0,
      body: '',
      authorLogin: 'bot',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const result = mapIssueCommentSummaryToWorkItemComment(comment);

    expect(result.id).toBe('0');
  });
});

describe('toRepoInfo', () => {
  it('extracts only owner and repo, drops platform', () => {
    const repoId: RepoIdentifier = {
      owner: 'acme',
      repo: 'widgets',
      platform: Platform.GitHub,
    };
    const result = toRepoInfo(repoId);

    expect(result).toEqual({ owner: 'acme', repo: 'widgets' });
    expect(result).not.toHaveProperty('platform');
  });

  it('works with different platforms', () => {
    const repoId: RepoIdentifier = {
      owner: 'org',
      repo: 'project',
      platform: Platform.GitLab,
    };
    const result = toRepoInfo(repoId);

    expect(result).toEqual({ owner: 'org', repo: 'project' });
  });
});

// ── CodeHost mapper tests ───────────────────────────────────────────────

describe('mapPRDetailsToMergeRequest', () => {
  const fullPR: PRDetails = {
    number: 42,
    title: 'feat: add login',
    body: 'Implements #12\n\nDescription here',
    state: 'OPEN',
    headBranch: 'feature/issue-12-login',
    baseBranch: 'main',
    url: 'https://github.com/acme/widgets/pull/42',
    issueNumber: 12,
    reviewComments: [],
  };

  it('maps all fields correctly with full data', () => {
    const result = mapPRDetailsToMergeRequest(fullPR);

    expect(result).toEqual({
      number: 42,
      title: 'feat: add login',
      body: 'Implements #12\n\nDescription here',
      sourceBranch: 'feature/issue-12-login',
      targetBranch: 'main',
      url: 'https://github.com/acme/widgets/pull/42',
      linkedIssueNumber: 12,
    });
  });

  it('maps null issueNumber to undefined linkedIssueNumber', () => {
    const pr: PRDetails = { ...fullPR, issueNumber: null };

    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.linkedIssueNumber).toBeUndefined();
  });

  it('maps empty body as empty string', () => {
    const pr: PRDetails = { ...fullPR, body: '' };

    const result = mapPRDetailsToMergeRequest(pr);

    expect(result.body).toBe('');
  });
});

describe('mapPRReviewCommentToReviewComment', () => {
  const fullComment: PRReviewComment = {
    id: 999,
    author: { login: 'reviewer', name: 'Reviewer', isBot: false },
    body: 'Please fix this',
    path: 'src/app.ts',
    line: 42,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  };

  it('maps all fields correctly with full data', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result).toEqual({
      id: '999',
      body: 'Please fix this',
      author: 'reviewer',
      createdAt: '2026-01-01T00:00:00Z',
      path: 'src/app.ts',
      line: 42,
    });
  });

  it('converts numeric id to string', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result.id).toBe('999');
    expect(typeof result.id).toBe('string');
  });

  it('maps null line to undefined', () => {
    const comment: PRReviewComment = { ...fullComment, line: null };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.line).toBeUndefined();
  });

  it('maps empty path to undefined', () => {
    const comment: PRReviewComment = { ...fullComment, path: '' };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.path).toBeUndefined();
  });

  it('maps bot author login correctly', () => {
    const comment: PRReviewComment = {
      ...fullComment,
      author: { login: 'dependabot[bot]', name: null, isBot: true },
    };

    const result = mapPRReviewCommentToReviewComment(comment);

    expect(result.author).toBe('dependabot[bot]');
  });

  it('drops updatedAt field', () => {
    const result = mapPRReviewCommentToReviewComment(fullComment);

    expect(result).not.toHaveProperty('updatedAt');
  });
});

describe('mapPRListItemToMergeRequest', () => {
  const item: PRListItem = {
    number: 5,
    headBranch: 'feature/issue-5-auth',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  it('maps number and sourceBranch from PRListItem', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.number).toBe(5);
    expect(result.sourceBranch).toBe('feature/issue-5-auth');
  });

  it('sets unavailable fields to empty strings', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.title).toBe('');
    expect(result.body).toBe('');
    expect(result.targetBranch).toBe('');
    expect(result.url).toBe('');
  });

  it('does not include linkedIssueNumber', () => {
    const result = mapPRListItemToMergeRequest(item);

    expect(result.linkedIssueNumber).toBeUndefined();
  });
});
