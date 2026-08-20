import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IssueTracker, IssueSummary } from '../../providers/types';

vi.mock('../../core', () => ({
  log: vi.fn(),
  execWithRetry: vi.fn(),
}));

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn() },
  readFileSync: vi.fn(),
}));

import { buildDefaultDocsSelfCheckDeps } from '../docsSelfCheck';

function makeTracker(searchOpenIssues: (search: string, limit: number) => readonly IssueSummary[]): IssueTracker {
  return { searchOpenIssues } as unknown as IssueTracker;
}

describe('findExistingRefactorIssueDefault (via buildDefaultDocsSelfCheckDeps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the matching issue number when title includes docPath', () => {
    const issues = [
      { number: 42, title: 'docs-bloat: app_docs/feature-foo.md exceeds 200 lines' },
    ];
    const searchOpenIssues = vi.fn().mockReturnValue(issues);
    const deps = buildDefaultDocsSelfCheckDeps(makeTracker(searchOpenIssues));

    const result = deps.findExistingRefactorIssue('app_docs/feature-foo.md');

    expect(searchOpenIssues).toHaveBeenCalledWith('docs-bloat: app_docs/feature-foo.md', 5);
    expect(result).toBe(42);
  });

  it('returns null when no issue title includes the docPath', () => {
    const issues = [
      { number: 10, title: 'docs-bloat: app_docs/other.md exceeds 200 lines' },
    ];
    const deps = buildDefaultDocsSelfCheckDeps(makeTracker(vi.fn().mockReturnValue(issues)));

    const result = deps.findExistingRefactorIssue('app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('returns null on empty result set', () => {
    const deps = buildDefaultDocsSelfCheckDeps(makeTracker(vi.fn().mockReturnValue([])));

    const result = deps.findExistingRefactorIssue('app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('returns null on throw (fail-open)', () => {
    const deps = buildDefaultDocsSelfCheckDeps(makeTracker(vi.fn(() => { throw new Error('gh failed'); })));

    const result = deps.findExistingRefactorIssue('app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('calls searchOpenIssues with correct options', () => {
    const searchOpenIssues = vi.fn().mockReturnValue([]);
    const deps = buildDefaultDocsSelfCheckDeps(makeTracker(searchOpenIssues));

    deps.findExistingRefactorIssue('app_docs/feature-foo.md');

    expect(searchOpenIssues).toHaveBeenCalledWith('docs-bloat: app_docs/feature-foo.md', 5);
  });
});
