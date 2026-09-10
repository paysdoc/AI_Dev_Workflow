import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findOpenDependencies } from '../triggers/issueDependencies';
import type { IssueTracker } from '../providers/types';

vi.mock('../agents/dependencyExtractionAgent', () => ({
  runDependencyExtractionAgent: vi.fn().mockResolvedValue({ success: false, dependencies: [] }),
}));

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return { ...actual, log: vi.fn() };
});

const mockGetIssueState = vi.fn<(issueNumber: number) => string>();
const fakeTracker: Pick<IssueTracker, 'getIssueState'> = { getIssueState: mockGetIssueState };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findOpenDependencies — fail-closed behavior', () => {
  it('treats a dep as OPEN when getIssueState throws', async () => {
    mockGetIssueState.mockImplementation((dep) => {
      throw new Error(`API rate limit for #${dep}`);
    });

    const result = await findOpenDependencies(
      'Blocked by #10',
      fakeTracker,
    );

    expect(result).toContain(10);
  });

  it('returns all deps as OPEN when all getIssueState calls throw', async () => {
    mockGetIssueState.mockImplementation(() => {
      throw new Error('GitHub API contention');
    });

    const result = await findOpenDependencies(
      'Blocked by #10 and blocked by #20',
      fakeTracker,
    );

    expect(result).toContain(10);
    expect(result).toContain(20);
  });

  it('only includes failed and OPEN deps when some calls succeed', async () => {
    mockGetIssueState.mockImplementation((dep) => {
      if (dep === 10) return 'CLOSED';
      if (dep === 20) throw new Error('API error');
      if (dep === 30) return 'OPEN';
      return 'CLOSED';
    });

    const result = await findOpenDependencies(
      'Blocked by #10, blocked by #20, and blocked by #30',
      fakeTracker,
    );

    expect(result).not.toContain(10);
    expect(result).toContain(20);
    expect(result).toContain(30);
  });

  it('returns empty array when all deps are CLOSED', async () => {
    mockGetIssueState.mockReturnValue('CLOSED');

    const result = await findOpenDependencies(
      'Blocked by #10 and blocked by #20',
      fakeTracker,
    );

    expect(result).toHaveLength(0);
  });

  it('returns empty array when no dependencies exist', async () => {
    const result = await findOpenDependencies(
      'This issue has no blockers.',
      fakeTracker,
    );

    expect(result).toHaveLength(0);
    expect(mockGetIssueState).not.toHaveBeenCalled();
  });
});
