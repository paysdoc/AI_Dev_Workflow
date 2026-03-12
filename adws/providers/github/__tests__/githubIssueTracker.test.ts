import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubIssue, IssueCommentSummary } from '../../../types/issueTypes';
import { Platform, type RepoIdentifier } from '../../types';

vi.mock('../../../github/issueApi', () => ({
  fetchGitHubIssue: vi.fn(),
  commentOnIssue: vi.fn(),
  deleteIssueComment: vi.fn(),
  closeIssue: vi.fn(),
  getIssueState: vi.fn(),
  fetchIssueCommentsRest: vi.fn(),
}));

vi.mock('../../../github/projectBoardApi', () => ({
  moveIssueToStatus: vi.fn(),
}));

import {
  fetchGitHubIssue,
  commentOnIssue as ghCommentOnIssue,
  deleteIssueComment,
  closeIssue as ghCloseIssue,
  getIssueState as ghGetIssueState,
  fetchIssueCommentsRest,
} from '../../../github/issueApi';
import { moveIssueToStatus } from '../../../github/projectBoardApi';
import { createGitHubIssueTracker } from '../githubIssueTracker';

const validRepoId: RepoIdentifier = {
  owner: 'acme',
  repo: 'widgets',
  platform: Platform.GitHub,
};

const expectedRepoInfo = { owner: 'acme', repo: 'widgets' };

const makeGitHubIssue = (overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
  number: 42,
  title: 'Test issue',
  body: 'Issue body',
  state: 'OPEN',
  author: { login: 'bob', name: 'Bob', isBot: false },
  assignees: [],
  labels: [{ id: 'lbl-1', name: 'bug', color: 'red', description: null }],
  milestone: null,
  comments: [{
    id: 'c1',
    author: { login: 'alice', name: 'Alice', isBot: false },
    body: 'A comment',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: null,
  }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  closedAt: null,
  url: 'https://github.com/acme/widgets/issues/42',
  ...overrides,
});

describe('createGitHubIssueTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction', () => {
    it('creates a tracker with a valid RepoIdentifier', () => {
      expect(() => createGitHubIssueTracker(validRepoId)).not.toThrow();
    });

    it('throws on empty owner', () => {
      const bad: RepoIdentifier = { owner: '', repo: 'widgets', platform: Platform.GitHub };
      expect(() => createGitHubIssueTracker(bad)).toThrow('owner must not be empty');
    });

    it('throws on empty repo', () => {
      const bad: RepoIdentifier = { owner: 'acme', repo: '', platform: Platform.GitHub };
      expect(() => createGitHubIssueTracker(bad)).toThrow('repo must not be empty');
    });

    it('throws on whitespace-only owner', () => {
      const bad: RepoIdentifier = { owner: '   ', repo: 'widgets', platform: Platform.GitHub };
      expect(() => createGitHubIssueTracker(bad)).toThrow('owner must not be empty');
    });

    it('returns an object with all IssueTracker methods', () => {
      const tracker = createGitHubIssueTracker(validRepoId);
      expect(typeof tracker.fetchIssue).toBe('function');
      expect(typeof tracker.commentOnIssue).toBe('function');
      expect(typeof tracker.deleteComment).toBe('function');
      expect(typeof tracker.closeIssue).toBe('function');
      expect(typeof tracker.getIssueState).toBe('function');
      expect(typeof tracker.fetchComments).toBe('function');
      expect(typeof tracker.moveToStatus).toBe('function');
    });
  });

  describe('fetchIssue', () => {
    it('delegates to fetchGitHubIssue with bound repoInfo and maps result', async () => {
      const ghIssue = makeGitHubIssue();
      vi.mocked(fetchGitHubIssue).mockResolvedValue(ghIssue);

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = await tracker.fetchIssue(42);

      expect(fetchGitHubIssue).toHaveBeenCalledWith(42, expectedRepoInfo);
      expect(result.id).toBe('42');
      expect(result.number).toBe(42);
      expect(result.title).toBe('Test issue');
      expect(result.author).toBe('bob');
      expect(result.labels).toEqual(['bug']);
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].author).toBe('alice');
    });

    it('passes bound repoInfo, not undefined', async () => {
      vi.mocked(fetchGitHubIssue).mockResolvedValue(makeGitHubIssue());

      const tracker = createGitHubIssueTracker(validRepoId);
      await tracker.fetchIssue(1);

      const calledWith = vi.mocked(fetchGitHubIssue).mock.calls[0];
      expect(calledWith[1]).toEqual(expectedRepoInfo);
      expect(calledWith[1]).not.toBeUndefined();
    });
  });

  describe('commentOnIssue', () => {
    it('delegates to underlying commentOnIssue with bound repoInfo', () => {
      const tracker = createGitHubIssueTracker(validRepoId);
      tracker.commentOnIssue(10, 'Hello');

      expect(ghCommentOnIssue).toHaveBeenCalledWith(10, 'Hello', expectedRepoInfo);
    });
  });

  describe('deleteComment', () => {
    it('converts string ID to number and delegates with bound repoInfo', () => {
      const tracker = createGitHubIssueTracker(validRepoId);
      tracker.deleteComment('123');

      expect(deleteIssueComment).toHaveBeenCalledWith(123, expectedRepoInfo);
    });

    it('handles string "0" correctly', () => {
      const tracker = createGitHubIssueTracker(validRepoId);
      tracker.deleteComment('0');

      expect(deleteIssueComment).toHaveBeenCalledWith(0, expectedRepoInfo);
    });
  });

  describe('closeIssue', () => {
    it('delegates with comment and bound repoInfo', async () => {
      vi.mocked(ghCloseIssue).mockResolvedValue(true);

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = await tracker.closeIssue(42, 'Closing comment');

      expect(ghCloseIssue).toHaveBeenCalledWith(42, expectedRepoInfo, 'Closing comment');
      expect(result).toBe(true);
    });

    it('delegates without optional comment', async () => {
      vi.mocked(ghCloseIssue).mockResolvedValue(true);

      const tracker = createGitHubIssueTracker(validRepoId);
      await tracker.closeIssue(42);

      expect(ghCloseIssue).toHaveBeenCalledWith(42, expectedRepoInfo, undefined);
    });

    it('returns false when issue is already closed', async () => {
      vi.mocked(ghCloseIssue).mockResolvedValue(false);

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = await tracker.closeIssue(42);

      expect(result).toBe(false);
    });
  });

  describe('getIssueState', () => {
    it('delegates and returns the state string', () => {
      vi.mocked(ghGetIssueState).mockReturnValue('OPEN');

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = tracker.getIssueState(42);

      expect(ghGetIssueState).toHaveBeenCalledWith(42, expectedRepoInfo);
      expect(result).toBe('OPEN');
    });

    it('returns CLOSED state', () => {
      vi.mocked(ghGetIssueState).mockReturnValue('CLOSED');

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = tracker.getIssueState(42);

      expect(result).toBe('CLOSED');
    });
  });

  describe('fetchComments', () => {
    it('delegates and maps IssueCommentSummary to WorkItemComment', () => {
      const summaries: IssueCommentSummary[] = [
        { id: 100, body: 'First', authorLogin: 'alice', createdAt: '2026-01-01T00:00:00Z' },
        { id: 200, body: 'Second', authorLogin: 'bob', createdAt: '2026-01-02T00:00:00Z' },
      ];
      vi.mocked(fetchIssueCommentsRest).mockReturnValue(summaries);

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = tracker.fetchComments(42);

      expect(fetchIssueCommentsRest).toHaveBeenCalledWith(42, expectedRepoInfo);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '100',
        body: 'First',
        author: 'alice',
        createdAt: '2026-01-01T00:00:00Z',
      });
      expect(result[1]).toEqual({
        id: '200',
        body: 'Second',
        author: 'bob',
        createdAt: '2026-01-02T00:00:00Z',
      });
    });

    it('returns empty array when no comments', () => {
      vi.mocked(fetchIssueCommentsRest).mockReturnValue([]);

      const tracker = createGitHubIssueTracker(validRepoId);
      const result = tracker.fetchComments(42);

      expect(result).toEqual([]);
    });
  });

  describe('moveToStatus', () => {
    it('delegates to moveIssueToStatus with bound repoInfo', async () => {
      vi.mocked(moveIssueToStatus).mockResolvedValue(undefined);

      const tracker = createGitHubIssueTracker(validRepoId);
      await tracker.moveToStatus(42, 'In Progress');

      expect(moveIssueToStatus).toHaveBeenCalledWith(42, 'In Progress', expectedRepoInfo);
    });
  });

  describe('repo binding', () => {
    it('all methods use the bound repoInfo from construction', async () => {
      const ghIssue = makeGitHubIssue();
      vi.mocked(fetchGitHubIssue).mockResolvedValue(ghIssue);
      vi.mocked(ghCloseIssue).mockResolvedValue(true);
      vi.mocked(ghGetIssueState).mockReturnValue('OPEN');
      vi.mocked(fetchIssueCommentsRest).mockReturnValue([]);
      vi.mocked(moveIssueToStatus).mockResolvedValue(undefined);

      const tracker = createGitHubIssueTracker(validRepoId);

      await tracker.fetchIssue(1);
      tracker.commentOnIssue(1, 'test');
      tracker.deleteComment('1');
      await tracker.closeIssue(1);
      tracker.getIssueState(1);
      tracker.fetchComments(1);
      await tracker.moveToStatus(1, 'Done');

      // Every underlying function received the bound repoInfo
      expect(fetchGitHubIssue).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(ghCommentOnIssue).toHaveBeenCalledWith(1, 'test', expectedRepoInfo);
      expect(deleteIssueComment).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(ghCloseIssue).toHaveBeenCalledWith(1, expectedRepoInfo, undefined);
      expect(ghGetIssueState).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(fetchIssueCommentsRest).toHaveBeenCalledWith(1, expectedRepoInfo);
      expect(moveIssueToStatus).toHaveBeenCalledWith(1, 'Done', expectedRepoInfo);
    });

    it('two trackers with different repos are independent', () => {
      vi.mocked(ghGetIssueState).mockReturnValue('OPEN');

      const tracker1 = createGitHubIssueTracker(validRepoId);
      const tracker2 = createGitHubIssueTracker({
        owner: 'other',
        repo: 'project',
        platform: Platform.GitHub,
      });

      tracker1.getIssueState(1);
      tracker2.getIssueState(2);

      expect(ghGetIssueState).toHaveBeenCalledWith(1, { owner: 'acme', repo: 'widgets' });
      expect(ghGetIssueState).toHaveBeenCalledWith(2, { owner: 'other', repo: 'project' });
    });
  });
});
