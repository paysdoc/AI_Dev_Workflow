/**
 * Shared test helper for building mock RepoContext objects.
 */

import { vi } from 'vitest';
import { type RepoContext, Platform } from '../../../providers/types';

export interface MockRepoContext extends RepoContext {
  readonly issueTracker: {
    fetchIssue: ReturnType<typeof vi.fn>;
    commentOnIssue: ReturnType<typeof vi.fn>;
    deleteComment: ReturnType<typeof vi.fn>;
    closeIssue: ReturnType<typeof vi.fn>;
    getIssueState: ReturnType<typeof vi.fn>;
    fetchComments: ReturnType<typeof vi.fn>;
    moveToStatus: ReturnType<typeof vi.fn>;
  };
  readonly codeHost: {
    getDefaultBranch: ReturnType<typeof vi.fn>;
    createMergeRequest: ReturnType<typeof vi.fn>;
    fetchMergeRequest: ReturnType<typeof vi.fn>;
    commentOnMergeRequest: ReturnType<typeof vi.fn>;
    fetchReviewComments: ReturnType<typeof vi.fn>;
    listOpenMergeRequests: ReturnType<typeof vi.fn>;
    getRepoIdentifier: ReturnType<typeof vi.fn>;
  };
}

export function makeRepoContext(): MockRepoContext {
  return {
    issueTracker: {
      fetchIssue: vi.fn().mockResolvedValue({ id: '1', number: 42, title: 'Test', body: '', state: 'open', author: '', labels: [], comments: [] }),
      commentOnIssue: vi.fn(),
      deleteComment: vi.fn(),
      closeIssue: vi.fn().mockResolvedValue(true),
      getIssueState: vi.fn().mockReturnValue('open'),
      fetchComments: vi.fn().mockReturnValue([]),
      moveToStatus: vi.fn().mockResolvedValue(undefined),
    },
    codeHost: {
      getDefaultBranch: vi.fn().mockReturnValue('main'),
      createMergeRequest: vi.fn().mockReturnValue('https://github.com/o/r/pull/1'),
      fetchMergeRequest: vi.fn().mockReturnValue({ number: 1, title: 'PR', body: '', sourceBranch: 'feat', targetBranch: 'main', url: '' }),
      commentOnMergeRequest: vi.fn(),
      fetchReviewComments: vi.fn().mockReturnValue([]),
      listOpenMergeRequests: vi.fn().mockReturnValue([]),
      getRepoIdentifier: vi.fn().mockReturnValue({ owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub }),
    },
    cwd: '/mock/worktree',
    repoId: { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub },
  };
}
