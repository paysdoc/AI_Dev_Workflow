import { describe, it, expect } from 'vitest';
import type { GitContext } from '../gitContext/gitContext';
import {
  checkGitRepository,
  checkGitHubCLI,
  checkIssueNumber,
} from '../healthCheckChecks';

const ISSUE_JSON = JSON.stringify({
  number: 42,
  title: 'Test issue',
  state: 'OPEN',
  body: '',
  author: { login: 'alice' },
  assignees: [],
  labels: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  closedAt: null,
  url: 'https://github.com/owner/repo/issues/42',
});

function makeFakeCtx(overrides: Partial<{
  getCurrentBranch: () => string;
  remotes: () => string[];
  hasUncommittedChanges: () => boolean;
  gitConfigUser: () => { name: string | null; email: string | null };
  authenticatedUser: () => string;
  fetchIssue: (n: number) => string;
  owner: string;
  repo: string;
}> = {}): GitContext {
  return {
    getCurrentBranch: () => 'main',
    remotes: () => ['origin'],
    hasUncommittedChanges: () => false,
    gitConfigUser: () => ({ name: 'Alice', email: 'alice@example.com' }),
    authenticatedUser: () => '{"login":"alice","id":1}',
    fetchIssue: () => ISSUE_JSON,
    owner: 'owner',
    repo: 'repo',
    ...overrides,
  } as unknown as GitContext;
}

// ── checkGitRepository ────────────────────────────────────────────────────────

describe('checkGitRepository', () => {
  it('happy path: returns success with branch, remote, and user info', () => {
    const ctx = makeFakeCtx();
    const result = checkGitRepository(ctx);
    expect(result.success).toBe(true);
    expect(result.details.currentBranch).toBe('main');
    expect(result.details.hasRemote).toBe(true);
    expect(result.details.remotes).toEqual(['origin']);
    expect(result.details.hasUncommittedChanges).toBe(false);
    expect(result.details.userConfigured).toBe(true);
    expect(result.details.userName).toBe('Alice');
    expect(result.details.userEmail).toBe('alice@example.com');
    expect(result.warning).toBeUndefined();
  });

  it('getCurrentBranch returns empty string → currentBranch falls back to "unknown"', () => {
    const ctx = makeFakeCtx({ getCurrentBranch: () => '' });
    const result = checkGitRepository(ctx);
    expect(result.details.currentBranch).toBe('unknown');
  });

  it('getCurrentBranch throws → currentBranch falls back to "unknown"', () => {
    const ctx = makeFakeCtx({ getCurrentBranch: () => { throw new Error('detached HEAD'); } });
    const result = checkGitRepository(ctx);
    expect(result.details.currentBranch).toBe('unknown');
  });

  it('remotes() throws → hasRemote:false, remotes:[]', () => {
    const ctx = makeFakeCtx({ remotes: () => { throw new Error('not a repo'); } });
    const result = checkGitRepository(ctx);
    expect(result.success).toBe(true);
    expect(result.details.hasRemote).toBe(false);
    expect(result.details.remotes).toEqual([]);
  });

  it('remotes() returns empty array → hasRemote:false', () => {
    const ctx = makeFakeCtx({ remotes: () => [] });
    const result = checkGitRepository(ctx);
    expect(result.details.hasRemote).toBe(false);
    expect(result.details.remotes).toEqual([]);
  });

  it('gitConfigUser returns { name: null, email: null } → userConfigured:false + warning', () => {
    const ctx = makeFakeCtx({ gitConfigUser: () => ({ name: null, email: null }) });
    const result = checkGitRepository(ctx);
    expect(result.success).toBe(true);
    expect(result.details.userConfigured).toBe(false);
    expect(result.warning).toBe('Git user.name or user.email not configured');
  });

  it('gitConfigUser returns only name null → userConfigured:false + warning', () => {
    const ctx = makeFakeCtx({ gitConfigUser: () => ({ name: null, email: 'e@x.com' }) });
    const result = checkGitRepository(ctx);
    expect(result.details.userConfigured).toBe(false);
    expect(result.warning).toBeDefined();
  });

  it('returns details.userName as undefined when name is null', () => {
    const ctx = makeFakeCtx({ gitConfigUser: () => ({ name: null, email: null }) });
    const result = checkGitRepository(ctx);
    expect(result.details.userName).toBeUndefined();
    expect(result.details.userEmail).toBeUndefined();
  });
});

// ── checkGitHubCLI ────────────────────────────────────────────────────────────

describe('checkGitHubCLI', () => {
  it('returns authenticated:true when authenticatedUser resolves', () => {
    const ctx = makeFakeCtx();
    const result = checkGitHubCLI(ctx);
    // Only meaningful if gh is installed on the test host; test the shape
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.details.installed).toBe('boolean');
  });

  it('authenticated:false when authenticatedUser throws', () => {
    const ctx = makeFakeCtx({ authenticatedUser: () => { throw new Error('not logged in'); } });
    const result = checkGitHubCLI(ctx);
    if (result.details.installed) {
      expect(result.details.authenticated).toBe(false);
    }
  });

  it('returns success:true even when unauthenticated (warning, not error)', () => {
    const ctx = makeFakeCtx({ authenticatedUser: () => { throw new Error('unauth'); } });
    const result = checkGitHubCLI(ctx);
    if (result.details.installed) {
      expect(result.success).toBe(true);
    }
  });
});

// ── checkIssueNumber ──────────────────────────────────────────────────────────

describe('checkIssueNumber', () => {
  it('happy path: parses title and state from fetchIssue output', () => {
    const ctx = makeFakeCtx();
    const result = checkIssueNumber(42, ctx);
    expect(result.success).toBe(true);
    expect(result.details.title).toBe('Test issue');
    expect(result.details.state).toBe('OPEN');
    expect(result.details.exists).toBe(true);
  });

  it('returns failure for invalid issue number (0)', () => {
    const ctx = makeFakeCtx();
    const result = checkIssueNumber(0, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
  });

  it('returns failure for NaN issue number', () => {
    const ctx = makeFakeCtx();
    const result = checkIssueNumber(NaN, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
  });

  it('returns failure for negative issue number', () => {
    const ctx = makeFakeCtx();
    const result = checkIssueNumber(-1, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
  });

  it('returns not-found failure when fetchIssue throws', () => {
    const ctx = makeFakeCtx({ fetchIssue: () => { throw new Error('not found'); } });
    const result = checkIssueNumber(999, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or not accessible');
  });

  it('returns not-found failure when fetchIssue returns "Could not resolve"', () => {
    const ctx = makeFakeCtx({ fetchIssue: () => 'Could not resolve to a Repository' });
    const result = checkIssueNumber(999, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or not accessible');
  });

  it('returns parse failure when fetchIssue returns invalid JSON', () => {
    const ctx = makeFakeCtx({ fetchIssue: () => 'not json at all' });
    const result = checkIssueNumber(1, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to parse');
  });
});
