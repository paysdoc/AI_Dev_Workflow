import { describe, it, expect } from 'vitest';
import {
  mapGitLabMRToMergeRequest,
  mapGitLabNoteToReviewComment,
  mapGitLabDiscussionsToReviewComments,
  toProjectPath,
} from '../mappers';
import { Platform, type RepoIdentifier } from '../../types';
import type { GitLabMergeRequest, GitLabNote, GitLabDiscussion } from '../gitlabTypes';

// ── Test helpers ──────────────────────────────────────────────────────

const makeGitLabMR = (overrides: Partial<GitLabMergeRequest> = {}): GitLabMergeRequest => ({
  iid: 10,
  title: 'feat: add login',
  description: 'Closes #42\n\nImplements the login feature.',
  source_branch: 'feature/login',
  target_branch: 'main',
  web_url: 'https://gitlab.com/acme/widgets/-/merge_requests/10',
  state: 'opened',
  ...overrides,
});

const makeGitLabNote = (overrides: Partial<GitLabNote> = {}): GitLabNote => ({
  id: 200,
  body: 'Please fix this',
  author: { id: 1, username: 'reviewer', name: 'Reviewer' },
  created_at: '2026-01-15T10:00:00Z',
  type: 'DiffNote',
  position: {
    new_path: 'src/app.ts',
    new_line: 42,
  },
  ...overrides,
});

const makeGitLabDiscussion = (overrides: Partial<GitLabDiscussion> = {}): GitLabDiscussion => ({
  id: 'disc-abc',
  notes: [makeGitLabNote()],
  ...overrides,
});

// ── mapGitLabMRToMergeRequest tests ──────────────────────────────────

describe('mapGitLabMRToMergeRequest', () => {
  it('maps all fields correctly with full data', () => {
    const mr = makeGitLabMR();
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result).toEqual({
      number: 10,
      title: 'feat: add login',
      body: 'Closes #42\n\nImplements the login feature.',
      sourceBranch: 'feature/login',
      targetBranch: 'main',
      url: 'https://gitlab.com/acme/widgets/-/merge_requests/10',
      linkedIssueNumber: 42,
    });
  });

  it('maps iid to number (not global id)', () => {
    const mr = makeGitLabMR({ iid: 7 });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.number).toBe(7);
  });

  it('extracts linkedIssueNumber from description with Closes #N', () => {
    const mr = makeGitLabMR({ description: 'Closes #42' });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.linkedIssueNumber).toBe(42);
  });

  it('extracts linkedIssueNumber from description with Fixes #N', () => {
    const mr = makeGitLabMR({ description: 'Fixes #99 in the auth module' });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.linkedIssueNumber).toBe(99);
  });

  it('extracts linkedIssueNumber from standalone #N reference', () => {
    const mr = makeGitLabMR({ description: 'Related to #15' });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.linkedIssueNumber).toBe(15);
  });

  it('returns undefined linkedIssueNumber when description has no issue reference', () => {
    const mr = makeGitLabMR({ description: 'Some description without issue ref' });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.linkedIssueNumber).toBeUndefined();
  });

  it('maps empty description as empty string', () => {
    const mr = makeGitLabMR({ description: '' });
    const result = mapGitLabMRToMergeRequest(mr);

    expect(result.body).toBe('');
    expect(result.linkedIssueNumber).toBeUndefined();
  });
});

// ── mapGitLabNoteToReviewComment tests ───────────────────────────────

describe('mapGitLabNoteToReviewComment', () => {
  it('maps all fields correctly', () => {
    const note = makeGitLabNote();
    const result = mapGitLabNoteToReviewComment(note);

    expect(result).toEqual({
      id: '200',
      body: 'Please fix this',
      author: 'reviewer',
      createdAt: '2026-01-15T10:00:00Z',
      path: 'src/app.ts',
      line: 42,
    });
  });

  it('converts numeric id to string', () => {
    const note = makeGitLabNote({ id: 999 });
    const result = mapGitLabNoteToReviewComment(note);

    expect(result.id).toBe('999');
    expect(typeof result.id).toBe('string');
  });

  it('maps note without position (general MR comment)', () => {
    const note = makeGitLabNote({ position: undefined });
    const result = mapGitLabNoteToReviewComment(note);

    expect(result.path).toBeUndefined();
    expect(result.line).toBeUndefined();
  });

  it('maps note with position that has null new_line', () => {
    const note = makeGitLabNote({
      position: { new_path: 'src/utils.ts', new_line: null },
    });
    const result = mapGitLabNoteToReviewComment(note);

    expect(result.path).toBe('src/utils.ts');
    expect(result.line).toBeUndefined();
  });
});

// ── mapGitLabDiscussionsToReviewComments tests ───────────────────────

describe('mapGitLabDiscussionsToReviewComments', () => {
  it('flattens multiple discussions into flat array', () => {
    const discussions: GitLabDiscussion[] = [
      makeGitLabDiscussion({
        id: 'disc-1',
        notes: [makeGitLabNote({ id: 1, body: 'First' })],
      }),
      makeGitLabDiscussion({
        id: 'disc-2',
        notes: [
          makeGitLabNote({ id: 2, body: 'Second' }),
          makeGitLabNote({ id: 3, body: 'Third' }),
        ],
      }),
    ];

    const result = mapGitLabDiscussionsToReviewComments(discussions);

    expect(result).toHaveLength(3);
    expect(result[0].body).toBe('First');
    expect(result[1].body).toBe('Second');
    expect(result[2].body).toBe('Third');
  });

  it('includes both positioned and non-positioned notes', () => {
    const discussions: GitLabDiscussion[] = [
      makeGitLabDiscussion({
        notes: [
          makeGitLabNote({ id: 1, position: { new_path: 'file.ts', new_line: 10 } }),
          makeGitLabNote({ id: 2, position: undefined }),
        ],
      }),
    ];

    const result = mapGitLabDiscussionsToReviewComments(discussions);

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('file.ts');
    expect(result[1].path).toBeUndefined();
  });

  it('returns empty array for no discussions', () => {
    const result = mapGitLabDiscussionsToReviewComments([]);

    expect(result).toEqual([]);
  });

  it('handles discussion with empty notes array', () => {
    const discussions: GitLabDiscussion[] = [
      { id: 'disc-empty', notes: [] },
    ];

    const result = mapGitLabDiscussionsToReviewComments(discussions);

    expect(result).toEqual([]);
  });
});

// ── toProjectPath tests ──────────────────────────────────────────────

describe('toProjectPath', () => {
  it('returns owner/repo format', () => {
    const repoId: RepoIdentifier = {
      owner: 'acme',
      repo: 'widgets',
      platform: Platform.GitLab,
    };

    const result = toProjectPath(repoId);

    expect(result).toBe('acme/widgets');
  });

  it('works with different platforms', () => {
    const repoId: RepoIdentifier = {
      owner: 'org',
      repo: 'project',
      platform: Platform.GitHub,
    };

    const result = toProjectPath(repoId);

    expect(result).toBe('org/project');
  });
});
