import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../issueDependencies', () => ({
  findOpenDependencies: vi.fn(),
}));

vi.mock('../concurrencyGuard', () => ({
  isConcurrencyLimitReached: vi.fn(),
}));

import { findOpenDependencies } from '../issueDependencies';
import { isConcurrencyLimitReached } from '../concurrencyGuard';
import { checkIssueEligibility } from '../issueEligibility';

const repoInfo = { owner: 'test', repo: 'repo' };

describe('checkIssueEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns eligible when no deps and no concurrency limit', async () => {
    vi.mocked(findOpenDependencies).mockResolvedValue([]);
    vi.mocked(isConcurrencyLimitReached).mockResolvedValue(false);

    const result = await checkIssueEligibility(1, 'body', repoInfo);
    expect(result).toEqual({ eligible: true });
  });

  it('returns ineligible with open dependencies', async () => {
    vi.mocked(findOpenDependencies).mockResolvedValue([42, 10]);
    vi.mocked(isConcurrencyLimitReached).mockResolvedValue(false);

    const result = await checkIssueEligibility(1, 'body', repoInfo);
    expect(result).toEqual({
      eligible: false,
      reason: 'open_dependencies',
      blockingIssues: [42, 10],
    });
  });

  it('returns ineligible when concurrency limit reached', async () => {
    vi.mocked(findOpenDependencies).mockResolvedValue([]);
    vi.mocked(isConcurrencyLimitReached).mockResolvedValue(true);

    const result = await checkIssueEligibility(1, 'body', repoInfo);
    expect(result).toEqual({
      eligible: false,
      reason: 'concurrency_limit',
    });
  });

  it('checks deps first — returns open_dependencies even if concurrency is also exceeded', async () => {
    vi.mocked(findOpenDependencies).mockResolvedValue([5]);
    vi.mocked(isConcurrencyLimitReached).mockResolvedValue(true);

    const result = await checkIssueEligibility(1, 'body', repoInfo);
    expect(result.reason).toBe('open_dependencies');
    // Concurrency check should not be called since deps already failed
    expect(isConcurrencyLimitReached).not.toHaveBeenCalled();
  });

  it('passes repoInfo to both checkers', async () => {
    vi.mocked(findOpenDependencies).mockResolvedValue([]);
    vi.mocked(isConcurrencyLimitReached).mockResolvedValue(false);

    await checkIssueEligibility(1, 'test body', repoInfo);

    expect(findOpenDependencies).toHaveBeenCalledWith('test body', repoInfo);
    expect(isConcurrencyLimitReached).toHaveBeenCalledWith(repoInfo);
  });
});
