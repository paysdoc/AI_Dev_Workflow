import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moveIssueToStatus } from '../projectBoardApi';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('../githubAppAuth', () => ({
  isGitHubAppConfigured: () => false,
  refreshTokenIfNeeded: () => undefined,
}));
vi.mock('../hitlBoardNotifier', () => ({ notifyReviewTransition: vi.fn() }));

const REPO_INFO = { owner: 'acme', repo: 'r' };

// Four gh GraphQL responses for a successful Review move:
// 1. find project, 2. find item (current status ≠ Review), 3. status options, 4. mutation
const REVIEW_EXEC_RETURNS = [
  '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_1"}]}}}}',
  '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_1","project":{"id":"PVT_1"},"fieldValueByName":{"name":"In Progress"}}]}}}}}',
  '{"data":{"node":{"field":{"id":"FIELD_1","options":[{"id":"OPT_REVIEW","name":"In Review"},{"id":"OPT_PROG","name":"In Progress"}]}}}}',
  '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"ITEM_1"}}}}',
];

// Same shape but for an "In Progress" target (current status = "To Do" so it doesn't short-circuit)
const INPROGRESS_EXEC_RETURNS = [
  '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_1"}]}}}}',
  '{"data":{"repository":{"issue":{"projectItems":{"nodes":[{"id":"ITEM_1","project":{"id":"PVT_1"},"fieldValueByName":{"name":"To Do"}}]}}}}}',
  '{"data":{"node":{"field":{"id":"FIELD_1","options":[{"id":"OPT_REVIEW","name":"In Review"},{"id":"OPT_PROG","name":"In Progress"}]}}}}',
  '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"ITEM_1"}}}}',
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('moveIssueToStatus — Review notification await-ordering', () => {
  it('awaits notifyReviewTransition before resolving for a Review target', async () => {
    const { execSync } = await import('child_process');
    const { notifyReviewTransition } = await import('../hitlBoardNotifier');
    const execSyncMock = vi.mocked(execSync);
    const notifyMock = vi.mocked(notifyReviewTransition);

    let completed = false;
    execSyncMock
      .mockReturnValueOnce(REVIEW_EXEC_RETURNS[0])
      .mockReturnValueOnce(REVIEW_EXEC_RETURNS[1])
      .mockReturnValueOnce(REVIEW_EXEC_RETURNS[2])
      .mockReturnValueOnce(REVIEW_EXEC_RETURNS[3]);
    notifyMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      completed = true;
    });

    const ok = await moveIssueToStatus(123, 'Review', REPO_INFO);

    expect(ok).toBe(true);
    expect(notifyMock).toHaveBeenCalledOnce();
    // This assertion is RED before Fix #1 (completed is false when void-discarded)
    expect(completed).toBe(true);
  });

  it('does not call notifyReviewTransition for a non-Review target', async () => {
    const { execSync } = await import('child_process');
    const { notifyReviewTransition } = await import('../hitlBoardNotifier');
    const execSyncMock = vi.mocked(execSync);
    const notifyMock = vi.mocked(notifyReviewTransition);

    execSyncMock
      .mockReturnValueOnce(INPROGRESS_EXEC_RETURNS[0])
      .mockReturnValueOnce(INPROGRESS_EXEC_RETURNS[1])
      .mockReturnValueOnce(INPROGRESS_EXEC_RETURNS[2])
      .mockReturnValueOnce(INPROGRESS_EXEC_RETURNS[3]);

    const ok = await moveIssueToStatus(123, 'In Progress', REPO_INFO);

    expect(ok).toBe(true);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
