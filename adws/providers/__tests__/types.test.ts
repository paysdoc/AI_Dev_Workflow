import { describe, it, expect } from 'vitest';
import {
  Platform,
  validateRepoIdentifier,
  type RepoIdentifier,
  type WorkItem,
  type WorkItemComment,
  type MergeRequest,
  type ReviewComment,
  type CreateMROptions,
  type IssueTracker,
  type CodeHost,
  type RepoContext,
} from '../types';

describe('Platform enum', () => {
  it('has expected values', () => {
    expect(Platform.GitHub).toBe('github');
    expect(Platform.GitLab).toBe('gitlab');
    expect(Platform.Bitbucket).toBe('bitbucket');
  });

  it('has exactly 3 members', () => {
    const values = Object.values(Platform);
    expect(values).toHaveLength(3);
  });
});

describe('validateRepoIdentifier', () => {
  it('accepts a valid identifier', () => {
    const id: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
    expect(() => validateRepoIdentifier(id)).not.toThrow();
  });

  it('throws on empty owner', () => {
    const id: RepoIdentifier = { owner: '', repo: 'widgets', platform: Platform.GitHub };
    expect(() => validateRepoIdentifier(id)).toThrow('owner must not be empty');
  });

  it('throws on whitespace-only owner', () => {
    const id: RepoIdentifier = { owner: '   ', repo: 'widgets', platform: Platform.GitLab };
    expect(() => validateRepoIdentifier(id)).toThrow('owner must not be empty');
  });

  it('throws on empty repo', () => {
    const id: RepoIdentifier = { owner: 'acme', repo: '', platform: Platform.Bitbucket };
    expect(() => validateRepoIdentifier(id)).toThrow('repo must not be empty');
  });

  it('throws on whitespace-only repo', () => {
    const id: RepoIdentifier = { owner: 'acme', repo: '  ', platform: Platform.GitHub };
    expect(() => validateRepoIdentifier(id)).toThrow('repo must not be empty');
  });

  it('accepts all platform enum values', () => {
    for (const platform of Object.values(Platform)) {
      const id: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform };
      expect(() => validateRepoIdentifier(id)).not.toThrow();
    }
  });
});

describe('type contracts', () => {
  it('WorkItemComment conforms to its interface', () => {
    const comment: WorkItemComment = {
      id: '1',
      body: 'Hello',
      author: 'alice',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(comment.id).toBe('1');
  });

  it('WorkItem conforms to its interface', () => {
    const item: WorkItem = {
      id: '42',
      number: 42,
      title: 'Test issue',
      body: 'Description',
      state: 'OPEN',
      author: 'bob',
      labels: ['bug', 'urgent'],
      comments: [],
    };
    expect(item.number).toBe(42);
    expect(item.labels).toHaveLength(2);
    expect(item.comments).toHaveLength(0);
  });

  it('WorkItem accepts empty labels and comments', () => {
    const item: WorkItem = {
      id: '1',
      number: 1,
      title: 'Minimal',
      body: '',
      state: 'OPEN',
      author: 'dev',
      labels: [],
      comments: [],
    };
    expect(item.labels).toHaveLength(0);
    expect(item.comments).toHaveLength(0);
  });

  it('MergeRequest conforms to its interface', () => {
    const mr: MergeRequest = {
      number: 10,
      title: 'Add feature',
      body: 'Details',
      sourceBranch: 'feature/foo',
      targetBranch: 'main',
      url: 'https://example.com/pr/10',
    };
    expect(mr.linkedIssueNumber).toBeUndefined();
  });

  it('MergeRequest accepts optional linkedIssueNumber', () => {
    const mr: MergeRequest = {
      number: 10,
      title: 'Add feature',
      body: 'Details',
      sourceBranch: 'feature/foo',
      targetBranch: 'main',
      url: 'https://example.com/pr/10',
      linkedIssueNumber: 5,
    };
    expect(mr.linkedIssueNumber).toBe(5);
  });

  it('ReviewComment conforms to its interface', () => {
    const comment: ReviewComment = {
      id: '99',
      body: 'Needs fix',
      author: 'reviewer',
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(comment.path).toBeUndefined();
    expect(comment.line).toBeUndefined();
  });

  it('ReviewComment accepts optional path and line', () => {
    const comment: ReviewComment = {
      id: '99',
      body: 'Needs fix',
      author: 'reviewer',
      createdAt: '2026-01-01T00:00:00Z',
      path: 'src/index.ts',
      line: 42,
    };
    expect(comment.path).toBe('src/index.ts');
    expect(comment.line).toBe(42);
  });

  it('CreateMROptions conforms to its interface', () => {
    const opts: CreateMROptions = {
      title: 'New PR',
      body: 'Body text',
      sourceBranch: 'feature/bar',
      targetBranch: 'main',
    };
    expect(opts.linkedIssueNumber).toBeUndefined();
  });

  it('CreateMROptions accepts optional linkedIssueNumber', () => {
    const opts: CreateMROptions = {
      title: 'New PR',
      body: 'Body text',
      sourceBranch: 'feature/bar',
      targetBranch: 'main',
      linkedIssueNumber: 7,
    };
    expect(opts.linkedIssueNumber).toBe(7);
  });

  it('RepoIdentifier conforms to its interface', () => {
    const id: RepoIdentifier = {
      owner: 'acme',
      repo: 'widgets',
      platform: Platform.GitHub,
    };
    expect(id.platform).toBe(Platform.GitHub);
  });
});

describe('interface structural tests', () => {
  it('IssueTracker mock satisfies the interface', () => {
    const tracker: IssueTracker = {
      fetchIssue: async (_n: number) => ({
        id: '1', number: _n, title: '', body: '', state: 'OPEN', author: '', labels: [], comments: [],
      }),
      commentOnIssue: (_n: number, _b: string) => {},
      deleteComment: (_id: string) => {},
      closeIssue: async (_n: number, _c?: string) => true,
      getIssueState: (_n: number) => 'OPEN',
      fetchComments: (_n: number) => [],
      moveToStatus: async (_n: number, _s: string) => {},
    };
    expect(tracker.getIssueState(1)).toBe('OPEN');
  });

  it('CodeHost mock satisfies the interface', () => {
    const host: CodeHost = {
      getDefaultBranch: () => 'main',
      createMergeRequest: (_opts: CreateMROptions) => 'https://example.com/pr/1',
      fetchMergeRequest: (_n: number) => ({
        number: _n, title: '', body: '', sourceBranch: '', targetBranch: '', url: '',
      }),
      commentOnMergeRequest: (_n: number, _b: string) => {},
      fetchReviewComments: (_n: number) => [],
      listOpenMergeRequests: () => [],
      getRepoIdentifier: () => ({ owner: 'acme', repo: 'widgets', platform: Platform.GitHub }),
    };
    expect(host.getDefaultBranch()).toBe('main');
  });

  it('RepoContext conforms to its type', () => {
    const tracker: IssueTracker = {
      fetchIssue: async (_n: number) => ({
        id: '1', number: _n, title: '', body: '', state: 'OPEN', author: '', labels: [], comments: [],
      }),
      commentOnIssue: () => {},
      deleteComment: () => {},
      closeIssue: async () => true,
      getIssueState: () => 'OPEN',
      fetchComments: () => [],
      moveToStatus: async () => {},
    };
    const host: CodeHost = {
      getDefaultBranch: () => 'main',
      createMergeRequest: () => '',
      fetchMergeRequest: (_n: number) => ({
        number: _n, title: '', body: '', sourceBranch: '', targetBranch: '', url: '',
      }),
      commentOnMergeRequest: () => {},
      fetchReviewComments: () => [],
      listOpenMergeRequests: () => [],
      getRepoIdentifier: () => ({ owner: 'o', repo: 'r', platform: Platform.GitLab }),
    };
    const ctx: RepoContext = {
      issueTracker: tracker,
      codeHost: host,
      cwd: '/tmp/repo',
      repoId: { owner: 'o', repo: 'r', platform: Platform.GitLab },
    };
    expect(ctx.cwd).toBe('/tmp/repo');
    expect(ctx.repoId.platform).toBe(Platform.GitLab);
  });
});

describe('compile-time type safety', () => {
  it('WorkItem requires all mandatory fields', () => {
    // @ts-expect-error - missing required fields
    const _incomplete: WorkItem = { id: '1' };
    expect(_incomplete).toBeDefined();
  });

  it('MergeRequest requires all mandatory fields', () => {
    // @ts-expect-error - missing required fields
    const _incomplete: MergeRequest = { number: 1 };
    expect(_incomplete).toBeDefined();
  });

  it('RepoIdentifier requires all fields', () => {
    // @ts-expect-error - missing required fields
    const _incomplete: RepoIdentifier = { owner: 'acme' };
    expect(_incomplete).toBeDefined();
  });
});
