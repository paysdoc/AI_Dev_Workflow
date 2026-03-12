import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runReviewWithRetry, ReviewRetryOptions, REVIEW_AGENT_COUNT } from '../reviewRetry';
import { ReviewIssue, ReviewAgentResult } from '../reviewAgent';

vi.mock('../reviewAgent', () => ({
  runReviewAgent: vi.fn(),
}));

vi.mock('../patchAgent', () => ({
  runPatchAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'patched',
    totalCostUsd: 0.5,
  }),
}));

vi.mock('../gitAgent', () => ({
  runCommitAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'committed',
    commitMessage: 'review-agent: feat: patch review issues',
  }),
}));

vi.mock('../../vcs', () => ({
  pushBranch: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    persistTokenCounts: vi.fn(),
    AgentStateManager: {
      readState: vi.fn().mockReturnValue({ adwId: 'adw-123' }),
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state'),
    },
  };
});

vi.mock('../../core/retryOrchestrator', () => ({
  initAgentState: vi.fn().mockReturnValue('/mock/state'),
  trackCost: vi.fn(),
}));

import { runReviewAgent } from '../reviewAgent';
import { runPatchAgent } from '../patchAgent';
import { runCommitAgent } from '../gitAgent';
import { pushBranch } from '../../vcs';

function createBlockerIssue(num: number): ReviewIssue {
  return {
    reviewIssueNumber: num,
    screenshotPath: `/path/to/issue-${num}.png`,
    issueDescription: `Blocker issue ${num}`,
    issueResolution: `Fix issue ${num}`,
    issueSeverity: 'blocker',
  };
}

function createPassingResult(): ReviewAgentResult {
  return {
    success: true, output: '{}', totalCostUsd: 0.5,
    reviewResult: { success: true, reviewSummary: 'All good', reviewIssues: [], screenshots: [] },
    passed: true, blockerIssues: [],
  };
}

function createFailingResult(blockers: ReviewIssue[]): ReviewAgentResult {
  return {
    success: true, output: '{}', totalCostUsd: 0.5,
    reviewResult: {
      success: false,
      reviewSummary: 'Issues found',
      reviewIssues: blockers,
      screenshots: [],
    },
    passed: false,
    blockerIssues: blockers,
  };
}

function createOptions(overrides: Partial<ReviewRetryOptions> = {}): ReviewRetryOptions {
  return {
    adwId: 'adw-123',
    specFile: 'specs/issue-1-plan.md',
    logsDir: '/logs',
    orchestratorStatePath: '/state',
    maxRetries: 3,
    branchName: 'feat-issue-1-test',
    issueType: '/feature',
    issueContext: '{"number": 1}',
    ...overrides,
  };
}

/** Mock all agents for one iteration to return passing results. */
function mockPassingIteration(): void {
  for (let i = 0; i < REVIEW_AGENT_COUNT; i++) {
    vi.mocked(runReviewAgent).mockResolvedValueOnce(createPassingResult());
  }
}

/** Mock all agents for one iteration where one agent finds a blocker. */
function mockFailingIteration(blockers: ReviewIssue[]): void {
  // First agent finds blockers, rest pass
  vi.mocked(runReviewAgent).mockResolvedValueOnce(createFailingResult(blockers));
  for (let i = 1; i < REVIEW_AGENT_COUNT; i++) {
    vi.mocked(runReviewAgent).mockResolvedValueOnce(createPassingResult());
  }
}

/** Mock all agents for one iteration where all agents find the same blocker. */
function mockAllAgentsFailIteration(blockers: ReviewIssue[]): void {
  for (let i = 0; i < REVIEW_AGENT_COUNT; i++) {
    vi.mocked(runReviewAgent).mockResolvedValueOnce(createFailingResult(blockers));
  }
}

describe('runReviewWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('launches REVIEW_AGENT_COUNT agents per iteration', async () => {
    mockPassingIteration();

    await runReviewWithRetry(createOptions());

    expect(runReviewAgent).toHaveBeenCalledTimes(REVIEW_AGENT_COUNT);
  });

  it('returns success when all agents pass on first attempt', async () => {
    mockPassingIteration();

    const result = await runReviewWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
    expect(result.blockerIssues).toHaveLength(0);
    expect(runPatchAgent).not.toHaveBeenCalled();
    expect(runCommitAgent).not.toHaveBeenCalled();
    expect(pushBranch).not.toHaveBeenCalled();
  });

  it('patches blockers, commits, pushes, then passes on second attempt', async () => {
    const blocker = createBlockerIssue(1);
    mockFailingIteration([blocker]);
    mockPassingIteration();

    const result = await runReviewWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(1);
    expect(runPatchAgent).toHaveBeenCalledTimes(1);
    expect(runCommitAgent).toHaveBeenCalledTimes(1);
    expect(pushBranch).toHaveBeenCalledTimes(1);
  });

  it('returns failure when max retries exceeded', async () => {
    const blocker = createBlockerIssue(1);
    mockAllAgentsFailIteration([blocker]);
    mockAllAgentsFailIteration([blocker]);

    const result = await runReviewWithRetry(createOptions({ maxRetries: 2 }));

    expect(result.passed).toBe(false);
    expect(result.totalRetries).toBe(2);
    expect(result.blockerIssues).toHaveLength(1);
    // 2 iterations * REVIEW_AGENT_COUNT agents each
    expect(runReviewAgent).toHaveBeenCalledTimes(2 * REVIEW_AGENT_COUNT);
    expect(runPatchAgent).toHaveBeenCalledTimes(2);
    expect(runCommitAgent).toHaveBeenCalledTimes(2);
    expect(pushBranch).toHaveBeenCalledTimes(2);
  });

  it('calls commit and push after each patch round (before next review)', async () => {
    const blocker = createBlockerIssue(1);
    mockFailingIteration([blocker]);
    mockFailingIteration([blocker]);
    mockPassingIteration();

    await runReviewWithRetry(createOptions({ maxRetries: 3 }));

    // Two rounds of patching before the third (passing) review
    expect(runCommitAgent).toHaveBeenCalledTimes(2);
    expect(pushBranch).toHaveBeenCalledTimes(2);
    expect(pushBranch).toHaveBeenCalledWith('feat-issue-1-test', undefined);
  });

  it('invokes onReviewFailed callback with correct attempt/maxAttempts', async () => {
    const onReviewFailed = vi.fn();
    const blocker = createBlockerIssue(1);
    mockFailingIteration([blocker]);
    mockPassingIteration();

    await runReviewWithRetry(createOptions({ onReviewFailed }));

    expect(onReviewFailed).toHaveBeenCalledWith(1, 3, [blocker]);
  });

  it('accumulates cost across review and patch agents', async () => {
    const blocker = createBlockerIssue(1);
    mockFailingIteration([blocker]);
    mockPassingIteration();

    vi.mocked(runPatchAgent).mockResolvedValue({
      success: true,
      output: 'patched',
      totalCostUsd: 0.7,
    });

    const result = await runReviewWithRetry(createOptions());

    // trackCost is mocked so costUsd stays at 0 (the mock doesn't modify state)
    expect(result.costUsd).toBe(0);
  });

  it('patches multiple blocker issues from merged results in a single round', async () => {
    const blockers = [createBlockerIssue(1), createBlockerIssue(2), createBlockerIssue(3)];
    // All 3 agents find all 3 blockers (deduplication will merge them)
    mockAllAgentsFailIteration(blockers);
    mockPassingIteration();

    await runReviewWithRetry(createOptions());

    // 3 unique blockers after dedup, so 3 patch calls
    expect(runPatchAgent).toHaveBeenCalledTimes(3);
  });

  it('invokes onPatchingIssue callback for each blocker before patching', async () => {
    const onPatchingIssue = vi.fn();
    const blockers = [createBlockerIssue(1), createBlockerIssue(2)];
    // First iteration: one agent finds blockers, rest pass
    mockFailingIteration(blockers);
    // Second iteration: all pass after patching
    mockPassingIteration();

    await runReviewWithRetry(createOptions({ onPatchingIssue }));

    expect(onPatchingIssue).toHaveBeenCalledTimes(2);
    expect(onPatchingIssue).toHaveBeenCalledWith(blockers[0]);
    expect(onPatchingIssue).toHaveBeenCalledWith(blockers[1]);
  });

  it('includes reviewSummary in result when review passes', async () => {
    vi.mocked(runReviewAgent).mockResolvedValue({
      success: true, output: '{}', totalCostUsd: 0.5,
      reviewResult: { success: true, reviewSummary: 'Everything looks good', reviewIssues: [], screenshots: [] },
      passed: true, blockerIssues: [],
    });

    const result = await runReviewWithRetry(createOptions());

    expect(result.reviewSummary).toBe('Everything looks good');
  });

  it('includes reviewSummary in result when review fails after max retries', async () => {
    vi.mocked(runReviewAgent).mockResolvedValue({
      success: true, output: '{}', totalCostUsd: 0.2,
      reviewResult: { success: false, reviewSummary: 'Issues remain', reviewIssues: [], screenshots: [] },
      passed: false, blockerIssues: [createBlockerIssue(1)],
    });

    const result = await runReviewWithRetry(createOptions({ maxRetries: 1 }));

    expect(result.reviewSummary).toBe('Issues remain');
  });

  it('threads applicationUrl through to runReviewAgent', async () => {
    mockPassingIteration();

    await runReviewWithRetry(createOptions({ applicationUrl: 'http://localhost:45678' }));

    // Each of the 3 agents should receive the applicationUrl
    expect(runReviewAgent).toHaveBeenCalledTimes(REVIEW_AGENT_COUNT);
    for (let i = 0; i < REVIEW_AGENT_COUNT; i++) {
      expect(vi.mocked(runReviewAgent).mock.calls[i]).toEqual(
        expect.arrayContaining(['http://localhost:45678'])
      );
    }
  });

  it('passes unique agentIndex to each parallel agent', async () => {
    mockPassingIteration();

    await runReviewWithRetry(createOptions());

    // Verify each agent got a unique index (1, 2, 3)
    for (let i = 0; i < REVIEW_AGENT_COUNT; i++) {
      const call = vi.mocked(runReviewAgent).mock.calls[i];
      // agentIndex is the 8th argument (index 7)
      expect(call[7]).toBe(i + 1);
    }
  });

  it('collects allScreenshots across iterations', async () => {
    const blocker = createBlockerIssue(1);
    // First iteration: one agent finds a blocker and has screenshots
    vi.mocked(runReviewAgent).mockResolvedValueOnce({
      success: true, output: '{}', totalCostUsd: 0.5,
      reviewResult: {
        success: false, reviewSummary: 'Issues found',
        reviewIssues: [blocker], screenshots: ['/path/iter1.png'],
      },
      passed: false, blockerIssues: [blocker],
    });
    for (let i = 1; i < REVIEW_AGENT_COUNT; i++) {
      vi.mocked(runReviewAgent).mockResolvedValueOnce(createPassingResult());
    }
    // Second iteration: all pass with screenshots
    for (let i = 0; i < REVIEW_AGENT_COUNT; i++) {
      vi.mocked(runReviewAgent).mockResolvedValueOnce({
        success: true, output: '{}', totalCostUsd: 0.3,
        reviewResult: {
          success: true, reviewSummary: 'Fixed',
          reviewIssues: [], screenshots: [`/path/iter2_${i}.png`],
        },
        passed: true, blockerIssues: [],
      });
    }

    const result = await runReviewWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.allScreenshots).toContain('/path/iter1.png');
    expect(result.allScreenshots).toContain('/path/iter2_0.png');
  });

  it('collects allSummaries across iterations', async () => {
    const blocker = createBlockerIssue(1);
    mockFailingIteration([blocker]);
    mockPassingIteration();

    const result = await runReviewWithRetry(createOptions());

    // Summaries from both iterations (REVIEW_AGENT_COUNT agents each)
    expect(result.allSummaries.length).toBeGreaterThanOrEqual(REVIEW_AGENT_COUNT);
  });
});
