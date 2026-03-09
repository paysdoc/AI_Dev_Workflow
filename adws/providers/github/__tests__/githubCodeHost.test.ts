import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform, type RepoIdentifier, type CodeHost, type CreateMROptions } from '../../types';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../../github/prApi', () => ({
  fetchPRDetails: vi.fn(),
  fetchPRReviewComments: vi.fn(),
  commentOnPR: vi.fn(),
  fetchPRList: vi.fn(),
}));

vi.mock('../../../github/gitCommitOperations', () => ({
  pushBranch: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/adw-pr-test'),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmdirSync: vi.fn(),
  };
});

import { execSync } from 'child_process';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../../github/prApi';
import { pushBranch } from '../../../github/gitCommitOperations';
import { GitHubCodeHost, createGitHubCodeHost } from '../githubCodeHost';
import type { PRDetails, PRReviewComment, PRListItem } from '../../../types/workflowTypes';

const mockExecSync = vi.mocked(execSync);
const mockFetchPRDetails = vi.mocked(fetchPRDetails);
const mockFetchPRReviewComments = vi.mocked(fetchPRReviewComments);
const mockCommentOnPR = vi.mocked(commentOnPR);
const mockFetchPRList = vi.mocked(fetchPRList);
const mockPushBranch = vi.mocked(pushBranch);

const testRepoId: RepoIdentifier = {
  owner: 'acme',
  repo: 'widgets',
  platform: Platform.GitHub,
};

describe('GitHubCodeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('stores the RepoIdentifier', () => {
      const host = new GitHubCodeHost(testRepoId);
      expect(host.getRepoIdentifier()).toEqual(testRepoId);
    });

    it('throws on empty owner', () => {
      const badId: RepoIdentifier = { owner: '', repo: 'widgets', platform: Platform.GitHub };
      expect(() => new GitHubCodeHost(badId)).toThrow('owner must not be empty');
    });

    it('throws on empty repo', () => {
      const badId: RepoIdentifier = { owner: 'acme', repo: '', platform: Platform.GitHub };
      expect(() => new GitHubCodeHost(badId)).toThrow('repo must not be empty');
    });

    it('throws on whitespace-only owner', () => {
      const badId: RepoIdentifier = { owner: '   ', repo: 'widgets', platform: Platform.GitHub };
      expect(() => new GitHubCodeHost(badId)).toThrow('owner must not be empty');
    });
  });

  describe('getRepoIdentifier', () => {
    it('returns the exact bound RepoIdentifier', () => {
      const host = new GitHubCodeHost(testRepoId);
      const result = host.getRepoIdentifier();

      expect(result).toEqual(testRepoId);
      expect(result.owner).toBe('acme');
      expect(result.repo).toBe('widgets');
      expect(result.platform).toBe(Platform.GitHub);
    });
  });

  describe('getDefaultBranch', () => {
    it('calls gh repo view with the bound repo', () => {
      mockExecSync.mockReturnValue('main\n');
      const host = new GitHubCodeHost(testRepoId);

      const result = host.getDefaultBranch();

      expect(result).toBe('main');
      expect(mockExecSync).toHaveBeenCalledWith(
        "gh repo view --repo acme/widgets --json defaultBranchRef --jq '.defaultBranchRef.name'",
        { encoding: 'utf-8' }
      );
    });

    it('returns trimmed branch name', () => {
      mockExecSync.mockReturnValue('  develop  \n');
      const host = new GitHubCodeHost(testRepoId);

      expect(host.getDefaultBranch()).toBe('develop');
    });

    it('throws meaningful error on empty result', () => {
      mockExecSync.mockReturnValue('');
      const host = new GitHubCodeHost(testRepoId);

      expect(() => host.getDefaultBranch()).toThrow('Failed to get default branch for acme/widgets');
    });

    it('throws meaningful error on CLI failure', () => {
      mockExecSync.mockImplementation(() => { throw new Error('gh not found'); });
      const host = new GitHubCodeHost(testRepoId);

      expect(() => host.getDefaultBranch()).toThrow('Failed to get default branch for acme/widgets');
    });
  });

  describe('fetchMergeRequest', () => {
    it('calls fetchPRDetails with the bound repoInfo and returns mapped MergeRequest', () => {
      const prDetails: PRDetails = {
        number: 42,
        title: 'Add feature',
        body: 'Implements #10',
        state: 'OPEN',
        headBranch: 'feature/x',
        baseBranch: 'main',
        url: 'https://github.com/acme/widgets/pull/42',
        issueNumber: 10,
        reviewComments: [],
      };
      mockFetchPRDetails.mockReturnValue(prDetails);
      const host = new GitHubCodeHost(testRepoId);

      const result = host.fetchMergeRequest(42);

      expect(mockFetchPRDetails).toHaveBeenCalledWith(42, { owner: 'acme', repo: 'widgets' });
      expect(result.number).toBe(42);
      expect(result.title).toBe('Add feature');
      expect(result.sourceBranch).toBe('feature/x');
      expect(result.targetBranch).toBe('main');
      expect(result.linkedIssueNumber).toBe(10);
    });
  });

  describe('commentOnMergeRequest', () => {
    it('calls commentOnPR with the bound repoInfo', () => {
      const host = new GitHubCodeHost(testRepoId);

      host.commentOnMergeRequest(42, 'LGTM');

      expect(mockCommentOnPR).toHaveBeenCalledWith(42, 'LGTM', { owner: 'acme', repo: 'widgets' });
    });
  });

  describe('fetchReviewComments', () => {
    it('calls fetchPRReviewComments with the bound repoInfo and returns mapped ReviewComments', () => {
      const comments: PRReviewComment[] = [
        {
          id: 100,
          author: { login: 'alice', name: 'Alice', isBot: false },
          body: 'Fix this',
          path: 'src/index.ts',
          line: 10,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T01:00:00Z',
        },
        {
          id: 200,
          author: { login: 'bob', name: null, isBot: true },
          body: 'Review submitted',
          path: '',
          line: null,
          createdAt: '2026-01-02T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
      ];
      mockFetchPRReviewComments.mockReturnValue(comments);
      const host = new GitHubCodeHost(testRepoId);

      const result = host.fetchReviewComments(42);

      expect(mockFetchPRReviewComments).toHaveBeenCalledWith(42, { owner: 'acme', repo: 'widgets' });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('100');
      expect(result[0].author).toBe('alice');
      expect(result[0].path).toBe('src/index.ts');
      expect(result[0].line).toBe(10);
      expect(result[1].id).toBe('200');
      expect(result[1].path).toBeUndefined();
      expect(result[1].line).toBeUndefined();
    });

    it('returns empty array when no comments', () => {
      mockFetchPRReviewComments.mockReturnValue([]);
      const host = new GitHubCodeHost(testRepoId);

      const result = host.fetchReviewComments(42);

      expect(result).toEqual([]);
    });
  });

  describe('listOpenMergeRequests', () => {
    it('calls fetchPRList with the bound repoInfo and returns mapped MergeRequests', () => {
      const prList: PRListItem[] = [
        { number: 1, headBranch: 'feature/a', updatedAt: '2026-01-01T00:00:00Z' },
        { number: 2, headBranch: 'bugfix/b', updatedAt: '2026-01-02T00:00:00Z' },
      ];
      mockFetchPRList.mockReturnValue(prList);
      const host = new GitHubCodeHost(testRepoId);

      const result = host.listOpenMergeRequests();

      expect(mockFetchPRList).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' });
      expect(result).toHaveLength(2);
      expect(result[0].number).toBe(1);
      expect(result[0].sourceBranch).toBe('feature/a');
      expect(result[1].number).toBe(2);
      expect(result[1].sourceBranch).toBe('bugfix/b');
    });

    it('returns empty array when no open PRs', () => {
      mockFetchPRList.mockReturnValue([]);
      const host = new GitHubCodeHost(testRepoId);

      const result = host.listOpenMergeRequests();

      expect(result).toEqual([]);
    });
  });

  describe('createMergeRequest', () => {
    const options: CreateMROptions = {
      title: 'feat: Add new feature (#10)',
      body: '## Summary\nImplements #10',
      sourceBranch: 'feature/issue-10-add-feature',
      targetBranch: 'main',
    };

    it('pushes the branch and calls gh pr create with correct flags', () => {
      mockExecSync.mockReturnValue('https://github.com/acme/widgets/pull/42\n');
      const host = new GitHubCodeHost(testRepoId);

      const result = host.createMergeRequest(options);

      expect(mockPushBranch).toHaveBeenCalledWith('feature/issue-10-add-feature');
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('gh pr create --repo acme/widgets'),
        expect.objectContaining({ encoding: 'utf-8', shell: '/bin/bash' })
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--base main --head feature/issue-10-add-feature'),
        expect.anything()
      );
      expect(result).toBe('https://github.com/acme/widgets/pull/42');
    });

    it('returns empty string on failure', () => {
      mockExecSync.mockImplementation(() => { throw new Error('PR creation failed'); });
      const host = new GitHubCodeHost(testRepoId);

      const result = host.createMergeRequest(options);

      expect(result).toBe('');
    });
  });

  describe('repo binding', () => {
    it('all methods consistently use the bound repo', () => {
      const prDetails: PRDetails = {
        number: 1, title: '', body: '', state: 'OPEN',
        headBranch: 'a', baseBranch: 'main', url: '', issueNumber: null, reviewComments: [],
      };
      mockFetchPRDetails.mockReturnValue(prDetails);
      mockFetchPRReviewComments.mockReturnValue([]);
      mockFetchPRList.mockReturnValue([]);
      mockExecSync.mockReturnValue('main\n');

      const host = new GitHubCodeHost(testRepoId);
      const expectedRepoInfo = { owner: 'acme', repo: 'widgets' };

      host.getDefaultBranch();
      host.fetchMergeRequest(1);
      host.commentOnMergeRequest(1, 'test');
      host.fetchReviewComments(1);
      host.listOpenMergeRequests();

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--repo acme/widgets'),
        expect.anything()
      );
      expect(mockFetchPRDetails).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(mockCommentOnPR).toHaveBeenCalledWith(1, 'test', expectedRepoInfo);
      expect(mockFetchPRReviewComments).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(mockFetchPRList).toHaveBeenCalledWith(expectedRepoInfo);
    });

    it('two instances with different repos operate independently', () => {
      const repoA: RepoIdentifier = { owner: 'orgA', repo: 'repoA', platform: Platform.GitHub };
      const repoB: RepoIdentifier = { owner: 'orgB', repo: 'repoB', platform: Platform.GitHub };

      const prA: PRDetails = {
        number: 1, title: 'A', body: '', state: 'OPEN',
        headBranch: 'a', baseBranch: 'main', url: '', issueNumber: null, reviewComments: [],
      };
      const prB: PRDetails = {
        number: 2, title: 'B', body: '', state: 'OPEN',
        headBranch: 'b', baseBranch: 'develop', url: '', issueNumber: null, reviewComments: [],
      };

      mockFetchPRDetails
        .mockReturnValueOnce(prA)
        .mockReturnValueOnce(prB);

      const hostA = new GitHubCodeHost(repoA);
      const hostB = new GitHubCodeHost(repoB);

      hostA.fetchMergeRequest(1);
      hostB.fetchMergeRequest(2);

      expect(mockFetchPRDetails).toHaveBeenCalledWith(1, { owner: 'orgA', repo: 'repoA' });
      expect(mockFetchPRDetails).toHaveBeenCalledWith(2, { owner: 'orgB', repo: 'repoB' });
    });
  });
});

describe('createGitHubCodeHost', () => {
  it('returns a valid CodeHost instance', () => {
    const host: CodeHost = createGitHubCodeHost(testRepoId);

    expect(host.getRepoIdentifier).toBeDefined();
    expect(host.getDefaultBranch).toBeDefined();
    expect(host.fetchMergeRequest).toBeDefined();
    expect(host.commentOnMergeRequest).toBeDefined();
    expect(host.fetchReviewComments).toBeDefined();
    expect(host.listOpenMergeRequests).toBeDefined();
    expect(host.createMergeRequest).toBeDefined();
  });

  it('passes through RepoIdentifier correctly', () => {
    const host = createGitHubCodeHost(testRepoId);

    expect(host.getRepoIdentifier()).toEqual(testRepoId);
  });

  it('throws on invalid RepoIdentifier', () => {
    const badId: RepoIdentifier = { owner: '', repo: 'x', platform: Platform.GitHub };
    expect(() => createGitHubCodeHost(badId)).toThrow('owner must not be empty');
  });
});
