import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../github/prApi', () => ({
  fetchPRDetails: vi.fn(),
  fetchPRReviewComments: vi.fn(),
  commentOnPR: vi.fn(),
  fetchPRList: vi.fn(),
}));

vi.mock('../../../github/pullRequestCreator', () => ({
  createPullRequest: vi.fn(),
}));

vi.mock('../../../vcs/branchOperations', () => ({
  getDefaultBranch: vi.fn(),
}));

import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../../github/prApi';
import { createPullRequest } from '../../../github/pullRequestCreator';
import { getDefaultBranch } from '../../../vcs/branchOperations';
import { GitHubCodeHost, createGitHubCodeHost } from '../githubCodeHost';
import { Platform, type RepoIdentifier } from '../../types';
import type { PRDetails as PRDetailsType, PRReviewComment, PRListItem } from '../../../types/workflowTypes';

const testRepoId: RepoIdentifier = {
  owner: 'acme',
  repo: 'widgets',
  platform: Platform.GitHub,
};

const mockPRDetails: PRDetailsType = {
  number: 10,
  title: 'feat: add login',
  body: 'Implements #42',
  state: 'OPEN',
  headBranch: 'feature/issue-42-login',
  baseBranch: 'main',
  url: 'https://github.com/acme/widgets/pull/10',
  issueNumber: 42,
  reviewComments: [],
};

const mockReviewComment: PRReviewComment = {
  id: 100,
  author: { login: 'reviewer', name: 'Reviewer', isBot: false },
  body: 'Fix this',
  path: 'src/app.ts',
  line: 5,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const mockPRListItem: PRListItem = {
  number: 3,
  headBranch: 'feature/issue-3-auth',
  updatedAt: '2026-03-01T00:00:00Z',
};

describe('createGitHubCodeHost', () => {
  it('creates a valid CodeHost instance', () => {
    const host = createGitHubCodeHost(testRepoId);

    expect(host).toBeDefined();
    expect(host.getRepoIdentifier()).toEqual(testRepoId);
  });

  it('throws on empty owner', () => {
    expect(() =>
      createGitHubCodeHost({ owner: '', repo: 'widgets', platform: Platform.GitHub })
    ).toThrow('owner must not be empty');
  });

  it('throws on empty repo', () => {
    expect(() =>
      createGitHubCodeHost({ owner: 'acme', repo: '', platform: Platform.GitHub })
    ).toThrow('repo must not be empty');
  });

  it('throws on whitespace-only owner', () => {
    expect(() =>
      createGitHubCodeHost({ owner: '  ', repo: 'widgets', platform: Platform.GitHub })
    ).toThrow('owner must not be empty');
  });
});

describe('GitHubCodeHost', () => {
  let host: GitHubCodeHost;

  beforeEach(() => {
    vi.clearAllMocks();
    host = new GitHubCodeHost(testRepoId);
  });

  describe('getRepoIdentifier', () => {
    it('returns the bound RepoIdentifier', () => {
      expect(host.getRepoIdentifier()).toEqual(testRepoId);
    });
  });

  describe('getDefaultBranch', () => {
    it('delegates to gitBranchOperations.getDefaultBranch', () => {
      vi.mocked(getDefaultBranch).mockReturnValue('main');

      const result = host.getDefaultBranch();

      expect(result).toBe('main');
      expect(getDefaultBranch).toHaveBeenCalledOnce();
    });
  });

  describe('fetchMergeRequest', () => {
    it('calls fetchPRDetails with bound repoInfo', () => {
      vi.mocked(fetchPRDetails).mockReturnValue(mockPRDetails);

      host.fetchMergeRequest(10);

      expect(fetchPRDetails).toHaveBeenCalledWith(10, { owner: 'acme', repo: 'widgets' });
    });

    it('returns a MergeRequest with mapped fields', () => {
      vi.mocked(fetchPRDetails).mockReturnValue(mockPRDetails);

      const result = host.fetchMergeRequest(10);

      expect(result).toEqual({
        number: 10,
        title: 'feat: add login',
        body: 'Implements #42',
        sourceBranch: 'feature/issue-42-login',
        targetBranch: 'main',
        url: 'https://github.com/acme/widgets/pull/10',
        linkedIssueNumber: 42,
      });
    });

    it('propagates errors from the underlying function', () => {
      vi.mocked(fetchPRDetails).mockImplementation(() => {
        throw new Error('Failed to fetch PR #10');
      });

      expect(() => host.fetchMergeRequest(10)).toThrow('Failed to fetch PR #10');
    });
  });

  describe('commentOnMergeRequest', () => {
    it('calls commentOnPR with bound repoInfo', () => {
      host.commentOnMergeRequest(10, 'Great work!');

      expect(commentOnPR).toHaveBeenCalledWith(10, 'Great work!', { owner: 'acme', repo: 'widgets' });
    });
  });

  describe('fetchReviewComments', () => {
    it('calls fetchPRReviewComments with bound repoInfo', () => {
      vi.mocked(fetchPRReviewComments).mockReturnValue([mockReviewComment]);

      host.fetchReviewComments(10);

      expect(fetchPRReviewComments).toHaveBeenCalledWith(10, { owner: 'acme', repo: 'widgets' });
    });

    it('returns ReviewComment[] with mapped fields', () => {
      vi.mocked(fetchPRReviewComments).mockReturnValue([mockReviewComment]);

      const result = host.fetchReviewComments(10);

      expect(result).toEqual([
        {
          id: '100',
          body: 'Fix this',
          author: 'reviewer',
          createdAt: '2026-01-01T00:00:00Z',
          path: 'src/app.ts',
          line: 5,
        },
      ]);
    });

    it('returns empty array when no comments', () => {
      vi.mocked(fetchPRReviewComments).mockReturnValue([]);

      const result = host.fetchReviewComments(10);

      expect(result).toEqual([]);
    });
  });

  describe('listOpenMergeRequests', () => {
    it('calls fetchPRList with bound repoInfo', () => {
      vi.mocked(fetchPRList).mockReturnValue([mockPRListItem]);

      host.listOpenMergeRequests();

      expect(fetchPRList).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' });
    });

    it('returns MergeRequest[] with mapped fields', () => {
      vi.mocked(fetchPRList).mockReturnValue([mockPRListItem]);

      const result = host.listOpenMergeRequests();

      expect(result).toEqual([
        {
          number: 3,
          title: '',
          body: '',
          sourceBranch: 'feature/issue-3-auth',
          targetBranch: '',
          url: '',
        },
      ]);
    });

    it('returns empty array when no open PRs', () => {
      vi.mocked(fetchPRList).mockReturnValue([]);

      const result = host.listOpenMergeRequests();

      expect(result).toEqual([]);
    });
  });

  describe('createMergeRequest', () => {
    it('calls createPullRequest with bound repoInfo', () => {
      vi.mocked(createPullRequest).mockReturnValue('https://github.com/acme/widgets/pull/11');

      host.createMergeRequest({
        title: 'New feature',
        body: 'Description',
        sourceBranch: 'feature/new',
        targetBranch: 'main',
        linkedIssueNumber: 7,
      });

      expect(createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          number: 7,
          title: 'New feature',
          body: 'Description',
        }),
        '',
        '',
        'main',
        process.cwd(),
        { owner: 'acme', repo: 'widgets' },
      );
    });

    it('returns the PR URL from createPullRequest', () => {
      vi.mocked(createPullRequest).mockReturnValue('https://github.com/acme/widgets/pull/11');

      const result = host.createMergeRequest({
        title: 'New feature',
        body: 'Description',
        sourceBranch: 'feature/new',
        targetBranch: 'main',
      });

      expect(result).toBe('https://github.com/acme/widgets/pull/11');
    });

    it('uses 0 for linkedIssueNumber when not provided', () => {
      vi.mocked(createPullRequest).mockReturnValue('');

      host.createMergeRequest({
        title: 'No issue',
        body: 'Body',
        sourceBranch: 'feature/no-issue',
        targetBranch: 'main',
      });

      expect(createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({ number: 0 }),
        '',
        '',
        'main',
        process.cwd(),
        { owner: 'acme', repo: 'widgets' },
      );
    });

    it('constructs a minimal GitHubIssue with required fields', () => {
      vi.mocked(createPullRequest).mockReturnValue('');

      host.createMergeRequest({
        title: 'Title',
        body: 'Body',
        sourceBranch: 'feature/x',
        targetBranch: 'develop',
        linkedIssueNumber: 5,
      });

      const issueArg = vi.mocked(createPullRequest).mock.calls[0][0];
      expect(issueArg.state).toBe('OPEN');
      expect(issueArg.author).toEqual({ login: '', isBot: false });
      expect(issueArg.assignees).toEqual([]);
      expect(issueArg.labels).toEqual([]);
      expect(issueArg.comments).toEqual([]);
    });
  });
});
