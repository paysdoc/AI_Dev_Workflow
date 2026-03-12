import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    MAX_REVIEW_RETRY_ATTEMPTS: 2,
    COST_REPORT_CURRENCIES: ['USD'],
    buildCostBreakdown: vi.fn().mockResolvedValue({ totalUSD: 1.0 }),
    persistTokenCounts: vi.fn(),
    writeIssueCostCsv: vi.fn(),
    rebuildProjectCostCsv: vi.fn(),
    computeEurRate: vi.fn().mockReturnValue(0.93),
  };
});

vi.mock('../../github/workflowCommentsIssue', () => ({
  formatWorkflowComment: vi.fn().mockReturnValue('formatted comment'),
}));

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  runReviewWithRetry: vi.fn().mockResolvedValue({
    passed: true,
    costUsd: 0.4,
    modelUsage: {},
    totalRetries: 1,
    reviewSummary: 'All good',
    blockerIssues: [],
  }),
}));

import { AgentStateManager, persistTokenCounts } from '../../core';
import { completeWorkflow, executeReviewPhase, handleWorkflowError } from '../workflowCompletion';
import type { WorkflowConfig } from '../workflowInit';
import type { RecoveryState, GitHubIssue } from '../../core';
import type { WorkflowContext } from '../../github';
import { makeRepoContext, type MockRepoContext } from './helpers/makeRepoContext';

let repoContext: MockRepoContext;

// Spy on process.exit
const _mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    issueNumber: 42,
    adwId: 'adw-test-abc123',
    issue: {
      number: 42, title: 'Test issue', body: 'Issue body', state: 'OPEN',
      author: { login: 'alice', name: null, isBot: false },
      assignees: [], labels: [], milestone: null, comments: [],
      createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z',
      closedAt: null, url: 'https://github.com/o/r/issues/42',
    } as GitHubIssue,
    issueType: '/feature',
    worktreePath: '/mock/worktree',
    defaultBranch: 'main',
    logsDir: '/mock/logs',
    orchestratorStatePath: '/mock/state/orchestrator',
    orchestratorName: 'test-orchestrator',
    recoveryState: {
      lastCompletedStage: null, adwId: null, branchName: null,
      planPath: null, prUrl: null, canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123', prUrl: 'https://github.com/o/r/pull/1' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: '',
    projectConfig: { commands: {} } as any,
    repoContext,
    ...overrides,
  };
}

describe('completeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
  });

  it('posts completed comment and moves issue to Review via repoContext', async () => {
    await completeWorkflow(makeConfig(), 1.0);

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
    expect(repoContext.issueTracker.moveToStatus).toHaveBeenCalledWith(42, 'Review');
  });

  it('writes completion state', async () => {
    await completeWorkflow(makeConfig(), 1.0);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      expect.objectContaining({
        metadata: expect.objectContaining({ totalCostUsd: 1.0 }),
      }),
    );
  });
});

describe('executeReviewPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
  });

  it('posts review_running comment via repoContext', async () => {
    await executeReviewPhase(makeConfig());

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
  });

  it('returns review results', async () => {
    const result = await executeReviewPhase(makeConfig());

    expect(result.reviewPassed).toBe(true);
    expect(result.costUsd).toBe(0.4);
  });
});

describe('handleWorkflowError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
  });

  it('posts error comment via repoContext and exits', () => {
    expect(() => handleWorkflowError(makeConfig(), new Error('test error'))).toThrow('process.exit called');

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
  });

  it('persists token counts when provided', () => {
    const usage = { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } };

    expect(() => handleWorkflowError(makeConfig(), new Error('test'), 0.5, usage)).toThrow('process.exit called');

    expect(persistTokenCounts).toHaveBeenCalledWith('/mock/state/orchestrator', 0.5, usage);
  });
});
