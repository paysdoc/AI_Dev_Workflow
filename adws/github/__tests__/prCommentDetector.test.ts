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
import { getUnaddressedComments, hasUnaddressedComments, getLastAdwCommitTimestamp, ADW_COMMIT_PATTERN } from '../prCommentDetector';
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

describe('ADW_COMMIT_PATTERN', () => {
  const adwMessages = [
    'pr-review-orchestrator: feat: resolve merge conflicts',
    'build-agent: fix: update error handling',
    '/feature: feat: add provider config',
    'sdlc_planner: chore: update dependencies',
    'document-agent: feat: update docs',
    'review-agent: review: address feedback',
    'plan-orchestrator: adwinit: initialize project',
  ];

  it.each(adwMessages)('matches ADW commit message: %s', (message) => {
    expect(ADW_COMMIT_PATTERN.test(message)).toBe(true);
  });

  const nonAdwMessages = [
    'feat: add new feature',
    'fix: resolve bug',
    "Merge branch 'main'",
    'Update README.md',
    'Initial commit',
  ];

  it.each(nonAdwMessages)('does not match non-ADW commit message: %s', (message) => {
    expect(ADW_COMMIT_PATTERN.test(message)).toBe(false);
  });
});

describe('getLastAdwCommitTimestamp pattern matching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct timestamp when an ADW commit is found', () => {
    vi.mocked(execSync).mockReturnValue(
      '2025-03-10T14:30:00+00:00 pr-review-orchestrator: feat: resolve merge conflicts\n' +
      '2025-03-09T10:00:00+00:00 feat: add new feature\n'
    );

    const result = getLastAdwCommitTimestamp('feature/test');

    expect(result).toEqual(new Date('2025-03-10T14:30:00+00:00'));
  });

  it('returns null when only non-ADW commits exist', () => {
    vi.mocked(execSync).mockReturnValue(
      '2025-03-10T14:30:00+00:00 feat: add new feature\n' +
      '2025-03-09T10:00:00+00:00 fix: resolve bug\n' +
      "2025-03-08T08:00:00+00:00 Merge branch 'main'\n"
    );

    const result = getLastAdwCommitTimestamp('feature/test');

    expect(result).toBeNull();
  });

  it('returns the most recent ADW commit timestamp', () => {
    vi.mocked(execSync).mockReturnValue(
      '2025-03-12T12:00:00+00:00 feat: manual commit\n' +
      '2025-03-11T10:00:00+00:00 build-orchestrator: fix: update config\n' +
      '2025-03-10T08:00:00+00:00 sdlc_planner: feat: add module\n'
    );

    const result = getLastAdwCommitTimestamp('feature/test');

    expect(result).toEqual(new Date('2025-03-11T10:00:00+00:00'));
  });
});

describe('getUnaddressedComments with ADW commit filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPRDetails.mockReturnValue(stubPRDetails);
  });

  it('does not return comments posted before an ADW commit', () => {
    vi.mocked(execSync).mockReturnValue(
      '2025-03-10T14:00:00+00:00 pr-review-orchestrator: feat: resolve conflicts\n'
    );
    mockFetchPRReviewComments.mockReturnValue([
      {
        id: 1,
        body: 'Please fix this',
        author: { login: 'reviewer', isBot: false },
        createdAt: '2025-03-10T10:00:00+00:00',
        path: 'src/index.ts',
        line: 10,
        updatedAt: '2025-03-10T10:00:00+00:00',
      },
    ]);

    const result = getUnaddressedComments(42);

    expect(result).toEqual([]);
  });

  it('returns comments posted after an ADW commit', () => {
    vi.mocked(execSync).mockReturnValue(
      '2025-03-10T14:00:00+00:00 pr-review-orchestrator: feat: resolve conflicts\n'
    );
    const comment = {
      id: 2,
      body: 'New issue found',
      author: { login: 'reviewer', isBot: false },
      createdAt: '2025-03-10T16:00:00+00:00',
      path: 'src/index.ts',
      line: 5,
      updatedAt: '2025-03-10T16:00:00+00:00',
    };
    mockFetchPRReviewComments.mockReturnValue([comment]);

    const result = getUnaddressedComments(42);

    expect(result).toEqual([comment]);
  });
});
