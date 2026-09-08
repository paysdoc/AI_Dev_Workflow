import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveIssueToStatus } from '../projectBoardApi';

vi.mock('../gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
}));
// Production code now calls createGhRepoApi(gitContextForRepo(repoInfo)).moveIssueToStatus(...)
// rather than calling .moveIssueToStatus(...) straight off gitContextForRepo's return value.
// Mock createGhRepoApi as an identity pass-through so the fake context object below is
// returned unchanged.
vi.mock('../../providers/github/ghRepoApi', () => ({
  createGhRepoApi: vi.fn((ctx) => ctx),
}));
vi.mock('../hitlBoardNotifier', () => ({ notifyReviewTransition: vi.fn() }));

import { gitContextForRepo } from '../gitContextFactory';
import { notifyReviewTransition } from '../hitlBoardNotifier';

const REPO_INFO = { owner: 'acme', repo: 'r' };

const mockMoveIssueToStatus = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gitContextForRepo).mockReturnValue({ moveIssueToStatus: mockMoveIssueToStatus } as unknown as ReturnType<typeof gitContextForRepo>);
});

describe('moveIssueToStatus — Review notification await-ordering', () => {
  it('awaits notifyReviewTransition before resolving for a Review target', async () => {
    const notifyMock = vi.mocked(notifyReviewTransition);
    let completed = false;
    mockMoveIssueToStatus.mockReturnValue(true);
    notifyMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      completed = true;
    });

    const ok = await moveIssueToStatus(123, 'Review', REPO_INFO);

    expect(ok).toBe(true);
    expect(notifyMock).toHaveBeenCalledOnce();
    expect(completed).toBe(true);
  });

  it('does not call notifyReviewTransition for a non-Review target', async () => {
    mockMoveIssueToStatus.mockReturnValue(true);
    const ok = await moveIssueToStatus(123, 'In Progress', REPO_INFO);
    expect(ok).toBe(true);
    expect(vi.mocked(notifyReviewTransition)).not.toHaveBeenCalled();
  });

  it('returns false when moveIssueToStatus returns false', async () => {
    mockMoveIssueToStatus.mockReturnValue(false);
    const ok = await moveIssueToStatus(123, 'Review', REPO_INFO);
    expect(ok).toBe(false);
    expect(vi.mocked(notifyReviewTransition)).not.toHaveBeenCalled();
  });
});
