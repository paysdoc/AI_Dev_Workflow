import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PRDetails } from '../../core';
import type { RepoInfo } from '../githubApi';

/**
 * Tests that prCommentDetector forwards the optional repoInfo parameter
 * to fetchPRDetails and fetchPRReviewComments.
 */

vi.mock('../githubApi', () => ({
  fetchPRDetails: vi.fn(),
  fetchPRReviewComments: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('../../core/targetRepoRegistry', () => ({
  resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
}));

import { execSync } from 'child_process';
import { getUnaddressedComments, hasUnaddressedComments, getLastAdwCommitTimestamp } from '../prCommentDetector';
import { fetchPRDetails, fetchPRReviewComments } from '../githubApi';
import { resolveTargetRepoCwd } from '../../core/targetRepoRegistry';

const mockFetchPRDetails = vi.mocked(fetchPRDetails);
const mockFetchPRReviewComments = vi.mocked(fetchPRReviewComments);

const stubPRDetails: PRDetails = {
  number: 42,
  title: 'Test PR',
  body: '',
  state: 'OPEN',
  headBranch: 'feature/test',
  baseBranch: 'main',
  url: 'https://github.com/test/repo/pull/42',
  issueNumber: null,
  reviewComments: [],
};

describe('prCommentDetector repoInfo forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPRDetails.mockReturnValue(stubPRDetails);
    mockFetchPRReviewComments.mockReturnValue([]);
  });

  it('forwards repoInfo to fetchPRDetails and fetchPRReviewComments when provided', () => {
    const repoInfo: RepoInfo = { owner: 'ext', repo: 'repo' };

    getUnaddressedComments(42, repoInfo);

    expect(mockFetchPRDetails).toHaveBeenCalledWith(42, repoInfo);
    expect(mockFetchPRReviewComments).toHaveBeenCalledWith(42, repoInfo);
  });

  it('calls fetchPRDetails and fetchPRReviewComments without repoInfo when omitted', () => {
    getUnaddressedComments(42);

    expect(mockFetchPRDetails).toHaveBeenCalledWith(42, undefined);
    expect(mockFetchPRReviewComments).toHaveBeenCalledWith(42, undefined);
  });

  it('hasUnaddressedComments forwards repoInfo', () => {
    const repoInfo: RepoInfo = { owner: 'ext', repo: 'repo' };

    hasUnaddressedComments(42, repoInfo);

    expect(mockFetchPRDetails).toHaveBeenCalledWith(42, repoInfo);
    expect(mockFetchPRReviewComments).toHaveBeenCalledWith(42, repoInfo);
  });
});

describe('getLastAdwCommitTimestamp cwd resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes resolved cwd to execSync', () => {
    vi.mocked(resolveTargetRepoCwd).mockReturnValueOnce('/target/repo');
    vi.mocked(execSync).mockReturnValue('2025-01-15T10:00:00+00:00 feat: implement #42\n');

    getLastAdwCommitTimestamp('feature/test');

    expect(execSync).toHaveBeenCalledWith(
      'git log "feature/test" --format="%aI %s" --no-merges',
      expect.objectContaining({ cwd: '/target/repo' })
    );
  });

  it('passes undefined cwd when registry is not set', () => {
    vi.mocked(execSync).mockReturnValue('');

    getLastAdwCommitTimestamp('feature/test');

    expect(execSync).toHaveBeenCalledWith(
      'git log "feature/test" --format="%aI %s" --no-merges',
      expect.objectContaining({ cwd: undefined })
    );
  });

  it('passes explicit cwd when provided', () => {
    vi.mocked(execSync).mockReturnValue('');

    getLastAdwCommitTimestamp('feature/test', '/explicit/path');

    expect(resolveTargetRepoCwd).toHaveBeenCalledWith('/explicit/path');
    expect(execSync).toHaveBeenCalledWith(
      'git log "feature/test" --format="%aI %s" --no-merges',
      expect.objectContaining({ cwd: '/explicit/path' })
    );
  });
});
