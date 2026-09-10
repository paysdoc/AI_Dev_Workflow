import { describe, it, expect, vi } from 'vitest';
import { buildUnaddressedCommentReads, hasUnaddressedComments } from '../prCommentDetector';
import type { CodeHost, PullRequest, ReviewComment } from '../../providers/types';
import type { GitContext } from '../../gitContext';
import type { LaunchBoundary } from '../../core/launchGitContext';

function makeBoundary(overrides: {
  fetchPullRequest?: (n: number) => PullRequest;
  fetchReviewComments?: (n: number) => ReviewComment[];
  getAuthenticatedUser?: () => string | null;
  gitLog?: (branchName: string) => string;
}): Pick<LaunchBoundary, 'providers' | 'gitContext'> {
  const codeHost: Pick<CodeHost, 'fetchPullRequest' | 'fetchReviewComments' | 'getAuthenticatedUser'> = {
    fetchPullRequest: overrides.fetchPullRequest ?? (() => ({ sourceBranch: 'feature-x' } as PullRequest)),
    fetchReviewComments: overrides.fetchReviewComments ?? (() => []),
    getAuthenticatedUser: overrides.getAuthenticatedUser ?? (() => 'adw-bot'),
  };
  const gitContext = { log: overrides.gitLog ?? (() => '') } as unknown as GitContext;
  return { providers: { codeHost } as unknown as LaunchBoundary['providers'], gitContext };
}

describe('buildUnaddressedCommentReads', () => {
  it('delegates each read to the matching boundary provider method with the same argument', () => {
    const fetchPullRequest = vi.fn(() => ({ sourceBranch: 'feature-x' } as PullRequest));
    const fetchReviewComments = vi.fn(() => [] as ReviewComment[]);
    const getAuthenticatedUser = vi.fn(() => 'adw-bot');
    const gitLog = vi.fn(() => '');
    const boundary = makeBoundary({ fetchPullRequest, fetchReviewComments, getAuthenticatedUser, gitLog });

    const reads = buildUnaddressedCommentReads(boundary);
    reads.fetchPullRequest(7);
    reads.fetchReviewComments(7);
    reads.getAuthenticatedUser();
    reads.lastAdwCommitTimestamp('feature-x');

    expect(fetchPullRequest).toHaveBeenCalledWith(7);
    expect(fetchReviewComments).toHaveBeenCalledWith(7);
    expect(getAuthenticatedUser).toHaveBeenCalledOnce();
    expect(gitLog).toHaveBeenCalledWith('feature-x', undefined);
  });
});

describe('hasUnaddressedComments', () => {
  const HUMAN_COMMENT: ReviewComment = { id: 'c1', body: 'please rename this', author: 'a-human', createdAt: '2026-09-09T10:00:00Z' };

  it('is true for one human comment newer than the last ADW commit', () => {
    const boundary = makeBoundary({
      fetchReviewComments: () => [HUMAN_COMMENT],
      gitLog: () => '2026-09-09T09:00:00.000Z build: feature: implement thing',
    });
    expect(hasUnaddressedComments(7, boundary)).toBe(true);
  });

  it('is false when no human comment exists, and never asks for the git read', () => {
    const gitLog = vi.fn(() => '2026-09-09T09:00:00.000Z build: feature: implement thing');
    const boundary = makeBoundary({ fetchReviewComments: () => [], gitLog });
    expect(hasUnaddressedComments(7, boundary)).toBe(false);
    expect(gitLog).not.toHaveBeenCalled();
  });

  it('is false for a comment authored by the code host\'s own login', () => {
    const boundary = makeBoundary({
      fetchReviewComments: () => [{ ...HUMAN_COMMENT, author: 'adw-bot' }],
      getAuthenticatedUser: () => 'adw-bot',
    });
    expect(hasUnaddressedComments(7, boundary)).toBe(false);
  });

  it('is true for a human comment when getAuthenticatedUser answers null', () => {
    const boundary = makeBoundary({
      fetchReviewComments: () => [HUMAN_COMMENT],
      getAuthenticatedUser: () => null,
    });
    expect(hasUnaddressedComments(7, boundary)).toBe(true);
  });
});
