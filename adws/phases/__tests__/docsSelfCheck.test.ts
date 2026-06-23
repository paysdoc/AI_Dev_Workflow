import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  execWithRetry: vi.fn(),
}));

vi.mock('../../github', () => ({
  createIssue: vi.fn(),
}));

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn() },
  readFileSync: vi.fn(),
}));

import { buildDefaultDocsSelfCheckDeps } from '../docsSelfCheck';
import { gitContextForRepo } from '../../github/gitContextFactory';

const REPO_INFO = { owner: 'acme', repo: 'webapp' };

function makeCtx(result: string) {
  return { listOpenIssues: vi.fn(() => result) };
}

describe('findExistingRefactorIssueDefault (via buildDefaultDocsSelfCheckDeps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the matching issue number when title includes docPath', () => {
    const issues = [
      { number: 42, title: 'docs-bloat: app_docs/feature-foo.md exceeds 200 lines' },
    ];
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx(JSON.stringify(issues)) as never);

    const deps = buildDefaultDocsSelfCheckDeps();
    const result = deps.findExistingRefactorIssue(REPO_INFO, 'app_docs/feature-foo.md');

    expect(gitContextForRepo).toHaveBeenCalledWith(REPO_INFO);
    expect(result).toBe(42);
  });

  it('returns null when no issue title includes the docPath', () => {
    const issues = [
      { number: 10, title: 'docs-bloat: app_docs/other.md exceeds 200 lines' },
    ];
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx(JSON.stringify(issues)) as never);

    const deps = buildDefaultDocsSelfCheckDeps();
    const result = deps.findExistingRefactorIssue(REPO_INFO, 'app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('returns null on empty result set', () => {
    vi.mocked(gitContextForRepo).mockReturnValue(makeCtx('[]') as never);

    const deps = buildDefaultDocsSelfCheckDeps();
    const result = deps.findExistingRefactorIssue(REPO_INFO, 'app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('returns null on throw (fail-open)', () => {
    vi.mocked(gitContextForRepo).mockReturnValue({ listOpenIssues: vi.fn(() => { throw new Error('gh failed'); }) } as never);

    const deps = buildDefaultDocsSelfCheckDeps();
    const result = deps.findExistingRefactorIssue(REPO_INFO, 'app_docs/feature-foo.md');

    expect(result).toBeNull();
  });

  it('calls listOpenIssues with correct options', () => {
    const ctx = makeCtx('[]');
    vi.mocked(gitContextForRepo).mockReturnValue(ctx as never);

    const deps = buildDefaultDocsSelfCheckDeps();
    deps.findExistingRefactorIssue(REPO_INFO, 'app_docs/feature-foo.md');

    expect(ctx.listOpenIssues).toHaveBeenCalledWith({
      fields: ['number', 'title'],
      search: 'docs-bloat: app_docs/feature-foo.md',
      limit: 5,
    });
  });
});
