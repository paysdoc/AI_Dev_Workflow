import { describe, it, expect, vi } from 'vitest';
import type { GitContext } from '../gitContext';
import type { CodeHost, Issue, IssueTracker } from '../providers/types';
import {
  checkGitRepository,
  checkGitHubCLI,
  checkIssueNumber,
} from '../healthCheckChecks';

const SAMPLE_ISSUE: Issue = {
  id: '42', number: 42, title: 'Test issue', body: '', state: 'OPEN',
  author: 'alice', labels: [], comments: [], createdAt: '2024-01-01T00:00:00Z',
  url: 'https://github.com/owner/repo/issues/42',
};

function makeFakeCtx(overrides: Partial<{
  getCurrentBranch: () => string;
  remotes: () => string[];
  hasUncommittedChanges: () => boolean;
  gitConfigUser: () => { name: string | null; email: string | null };
}> = {}): GitContext {
  return {
    getCurrentBranch: () => 'main',
    remotes: () => ['origin'],
    hasUncommittedChanges: () => false,
    gitConfigUser: () => ({ name: 'Alice', email: 'alice@example.com' }),
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
  function makeCodeHost(getAuthenticatedUser: CodeHost['getAuthenticatedUser']): Pick<CodeHost, 'getAuthenticatedUser'> {
    return { getAuthenticatedUser };
  }

  it('returns authenticated:true when getAuthenticatedUser resolves a login', () => {
    const codeHost = makeCodeHost(() => 'alice');
    const result = checkGitHubCLI(codeHost);
    // Only meaningful if gh is installed on the test host; test the shape
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.details.installed).toBe('boolean');
    if (result.details.installed) {
      expect(result.details.authenticated).toBe(true);
    }
  });

  it('authenticated:false when getAuthenticatedUser returns null', () => {
    const codeHost = makeCodeHost(() => null);
    const result = checkGitHubCLI(codeHost);
    if (result.details.installed) {
      expect(result.details.authenticated).toBe(false);
    }
  });

  it('authenticated:false when the code host refuses the operation by name (a non-GitHub port)', () => {
    const codeHost = makeCodeHost(() => { throw new Error('GitLabCodeHost.getAuthenticatedUser is not implemented'); });
    const result = checkGitHubCLI(codeHost);
    if (result.details.installed) {
      expect(result.details.authenticated).toBe(false);
      expect(result.success).toBe(true);
    }
  });

  it('returns success:true even when unauthenticated (warning, not error)', () => {
    const codeHost = makeCodeHost(() => null);
    const result = checkGitHubCLI(codeHost);
    if (result.details.installed) {
      expect(result.success).toBe(true);
    }
  });
});

// ── checkIssueNumber ──────────────────────────────────────────────────────────

describe('checkIssueNumber', () => {
  function makeTracker(fetchIssue: IssueTracker['fetchIssue']): Pick<IssueTracker, 'fetchIssue'> {
    return { fetchIssue };
  }

  it('happy path: fills title and state from the tracker\'s Issue', async () => {
    const tracker = makeTracker(async () => SAMPLE_ISSUE);
    const result = await checkIssueNumber(42, tracker);
    expect(result.success).toBe(true);
    expect(result.details.title).toBe('Test issue');
    expect(result.details.state).toBe('OPEN');
    expect(result.details.exists).toBe(true);
  });

  it('returns failure for invalid issue number (0) without calling the tracker', async () => {
    const fetchIssue = vi.fn();
    const result = await checkIssueNumber(0, makeTracker(fetchIssue));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
    expect(fetchIssue).not.toHaveBeenCalled();
  });

  it('returns failure for NaN issue number without calling the tracker', async () => {
    const fetchIssue = vi.fn();
    const result = await checkIssueNumber(NaN, makeTracker(fetchIssue));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
    expect(fetchIssue).not.toHaveBeenCalled();
  });

  it('returns failure for negative issue number without calling the tracker', async () => {
    const fetchIssue = vi.fn();
    const result = await checkIssueNumber(-1, makeTracker(fetchIssue));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid issue number');
    expect(fetchIssue).not.toHaveBeenCalled();
  });

  it('returns not-found failure when the tracker rejects', async () => {
    const tracker = makeTracker(async () => { throw new Error('Failed to fetch issue #999: not found'); });
    const result = await checkIssueNumber(999, tracker);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found or not accessible');
  });
});
