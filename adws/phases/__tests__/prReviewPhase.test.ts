import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state/pr-review-agent'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    emptyModelUsageMap: actual.emptyModelUsageMap,
    OrchestratorId: { PrReview: 'pr-review-orchestrator' },
  };
});

vi.mock('../../github/workflowCommentsPR', () => ({
  formatPRReviewWorkflowComment: vi.fn().mockReturnValue('formatted PR comment'),
}));

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-1-plan.md'),
  runPrReviewPlanAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Review plan created',
    totalCostUsd: 0.2,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 40, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.2 } },
  }),
  runPrReviewBuildAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Review build completed',
    totalCostUsd: 0.3,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 60, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
  }),
}));

import { runPrReviewPlanAgent, runPrReviewBuildAgent } from '../../agents';
import { executePRReviewPlanPhase, executePRReviewBuildPhase } from '../prReviewPhase';
import type { PRReviewWorkflowConfig } from '../prReviewPhase';
import type { PRReviewWorkflowContext } from '../../github';
import { makeRepoContext, type MockRepoContext } from './helpers/makeRepoContext';

let repoContext: MockRepoContext;

function makeConfig(overrides: Partial<PRReviewWorkflowConfig> = {}): PRReviewWorkflowConfig {
  return {
    prNumber: 10,
    issueNumber: 1,
    adwId: 'adw-test-pr10',
    prDetails: {
      number: 10, title: 'Test PR', body: 'PR body', state: 'OPEN',
      headBranch: 'feat-issue-1-test', baseBranch: 'main',
      url: 'https://github.com/o/r/pull/10', issueNumber: 1, reviewComments: [],
    },
    unaddressedComments: [
      { id: 1, author: { login: 'bob', name: null, isBot: false }, body: 'Fix this', path: 'src/a.ts', line: 10, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    ],
    worktreePath: '/mock/worktree',
    logsDir: '/mock/logs',
    orchestratorStatePath: '/mock/state/orchestrator',
    ctx: { issueNumber: 1, adwId: 'adw-test-pr10', prNumber: 10, reviewComments: 1, branchName: 'feat-issue-1-test' } as PRReviewWorkflowContext,
    applicationUrl: 'http://localhost:3000',
    repoContext,
    ...overrides,
  };
}

describe('executePRReviewPlanPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
    vi.mocked(fs.readFileSync).mockReturnValue('# Existing plan');
  });

  it('posts pr_review_planning and pr_review_planned comments via repoContext', async () => {
    await executePRReviewPlanPhase(makeConfig());

    expect(repoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(10, 'formatted PR comment');
    expect(repoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledTimes(2);
  });

  it('runs plan agent and returns cost', async () => {
    const result = await executePRReviewPlanPhase(makeConfig());

    expect(result.costUsd).toBe(0.2);
    expect(result.planOutput).toBe('Review plan created');
    expect(runPrReviewPlanAgent).toHaveBeenCalled();
  });

  it('throws when plan agent fails', async () => {
    vi.mocked(runPrReviewPlanAgent).mockResolvedValueOnce({
      success: false, output: 'Failed', totalCostUsd: 0.1,
    });

    await expect(executePRReviewPlanPhase(makeConfig())).rejects.toThrow('PR Review Plan Agent failed');
  });
});

describe('executePRReviewBuildPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
  });

  it('posts pr_review_implementing and pr_review_implemented via repoContext', async () => {
    await executePRReviewBuildPhase(makeConfig(), 'plan output');

    expect(repoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(10, 'formatted PR comment');
    expect(repoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledTimes(2);
  });

  it('runs build agent and returns cost', async () => {
    const result = await executePRReviewBuildPhase(makeConfig(), 'plan output');

    expect(result.costUsd).toBe(0.3);
    expect(runPrReviewBuildAgent).toHaveBeenCalled();
  });

  it('throws when build agent fails', async () => {
    vi.mocked(runPrReviewBuildAgent).mockResolvedValueOnce({
      success: false, output: 'Build failed', totalCostUsd: 0.1,
    });

    await expect(executePRReviewBuildPhase(makeConfig(), 'plan output')).rejects.toThrow('PR Review Build Agent failed');
  });
});
