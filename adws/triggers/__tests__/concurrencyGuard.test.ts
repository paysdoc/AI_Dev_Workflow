import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core/config', () => ({
  MAX_CONCURRENT_PER_REPO: 5,
}));

import { getInProgressIssueCount, isConcurrencyLimitReached } from '../concurrencyGuard';

const repoInfo = { owner: 'test', repo: 'repo' };

function mockGhCalls(issues: unknown[], prs: unknown[]): void {
  vi.mocked(execSync).mockImplementation((cmd: string) => {
    if (typeof cmd === 'string' && cmd.includes('gh issue list')) return JSON.stringify(issues);
    if (typeof cmd === 'string' && cmd.includes('gh pr list')) return JSON.stringify(prs);
    return '';
  });
}

describe('getInProgressIssueCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 when no open issues', async () => {
    mockGhCalls([], []);
    expect(await getInProgressIssueCount(repoInfo)).toBe(0);
  });

  it('counts issues with ADW comments and no merged PR', async () => {
    const issues = [
      { number: 1, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
      { number: 2, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
      { number: 3, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
    ];
    mockGhCalls(issues, []);
    expect(await getInProgressIssueCount(repoInfo)).toBe(3);
  });

  it('excludes issues with merged PRs', async () => {
    const issues = [
      { number: 1, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
      { number: 2, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
    ];
    const prs = [
      { number: 10, body: 'Implements #1', state: 'MERGED', merged: true },
    ];
    mockGhCalls(issues, prs);
    expect(await getInProgressIssueCount(repoInfo)).toBe(1);
  });

  it('does not count issues without ADW comments', async () => {
    const issues = [
      { number: 1, comments: [{ body: 'Regular comment' }] },
      { number: 2, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
      { number: 3, comments: [] },
    ];
    mockGhCalls(issues, []);
    expect(await getInProgressIssueCount(repoInfo)).toBe(1);
  });

  it('excludes issues with closed PRs', async () => {
    const issues = [
      { number: 5, comments: [{ body: '## :rocket: ADW Workflow Started\n\n<!-- adw-bot -->' }] },
    ];
    const prs = [
      { number: 20, body: 'Implements #5', state: 'CLOSED', merged: false },
    ];
    mockGhCalls(issues, prs);
    expect(await getInProgressIssueCount(repoInfo)).toBe(0);
  });
});

describe('isConcurrencyLimitReached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when count is below limit', async () => {
    mockGhCalls(
      [{ number: 1, comments: [{ body: '<!-- adw-bot -->' }] }],
      [],
    );
    expect(await isConcurrencyLimitReached(repoInfo)).toBe(false);
  });

  it('returns true when count equals limit', async () => {
    const issues = Array.from({ length: 5 }, (_, i) => ({
      number: i + 1,
      comments: [{ body: '<!-- adw-bot -->' }],
    }));
    mockGhCalls(issues, []);
    expect(await isConcurrencyLimitReached(repoInfo)).toBe(true);
  });

  it('returns true when count exceeds limit', async () => {
    const issues = Array.from({ length: 7 }, (_, i) => ({
      number: i + 1,
      comments: [{ body: '<!-- adw-bot -->' }],
    }));
    mockGhCalls(issues, []);
    expect(await isConcurrencyLimitReached(repoInfo)).toBe(true);
  });
});
