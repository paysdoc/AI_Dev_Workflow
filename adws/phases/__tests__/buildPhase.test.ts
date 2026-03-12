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
      initializeState: vi.fn().mockReturnValue('/mock/state/build-agent'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    shouldExecuteStage: vi.fn().mockReturnValue(true),
    MAX_TOKEN_CONTINUATIONS: 2,
    emptyModelUsageMap: actual.emptyModelUsageMap,
    mergeModelUsageMaps: actual.mergeModelUsageMaps,
  };
});

vi.mock('../../github/workflowCommentsIssue', () => ({
  formatWorkflowComment: vi.fn().mockReturnValue('formatted comment'),
}));

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  runBuildAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Build completed successfully',
    totalCostUsd: 1.0,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.0 } },
  }),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: 'Committed' }),
}));

import { shouldExecuteStage } from '../../core';
import { runBuildAgent, runCommitAgent } from '../../agents';
import { executeBuildPhase } from '../buildPhase';
import type { WorkflowConfig } from '../workflowLifecycle';
import type { RecoveryState, GitHubIssue } from '../../core';
import type { WorkflowContext } from '../../github';
import { makeRepoContext, type MockRepoContext } from './helpers/makeRepoContext';

let repoContext: MockRepoContext;

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
    orchestratorName: 'build-orchestrator',
    recoveryState: {
      lastCompletedStage: null, adwId: null, branchName: null,
      planPath: null, prUrl: null, canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123', branchName: 'feat-issue-42-test' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: '',
    projectConfig: { commands: {} } as any,
    repoContext,
    ...overrides,
  };
}

describe('executeBuildPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan content\n\nBuild steps here');
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: true,
      output: 'Build completed successfully',
      totalCostUsd: 1.0,
      modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.0 } },
    });
  });

  it('reads plan file and runs build agent', async () => {
    const result = await executeBuildPhase(makeConfig());

    expect(result.costUsd).toBe(1.0);
    expect(fs.readFileSync).toHaveBeenCalled();
    expect(runBuildAgent).toHaveBeenCalled();
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
  });

  it('throws when plan file cannot be read', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    await expect(executeBuildPhase(makeConfig())).rejects.toThrow('Cannot read plan file');
  });

  it('throws when build agent fails', async () => {
    vi.mocked(runBuildAgent).mockResolvedValueOnce({
      success: false,
      output: 'Build failed: compilation error',
      totalCostUsd: 0.5,
    });

    await expect(executeBuildPhase(makeConfig())).rejects.toThrow('Build Agent failed');
  });

  it('skips build when stage already completed', async () => {
    vi.mocked(shouldExecuteStage).mockImplementation((stage: string) => {
      if (stage === 'implemented') return false;
      return true;
    });

    await executeBuildPhase(makeConfig());

    expect(runBuildAgent).not.toHaveBeenCalled();
  });

  it('handles token limit continuation', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: false,
        output: 'Partial work done...',
        totalCostUsd: 0.6,
        tokenLimitExceeded: true,
        tokenUsage: { totalInputTokens: 180000, totalOutputTokens: 15000, totalCacheCreationTokens: 0, totalTokens: 195000, maxTokens: 200000, thresholdPercent: 80 },
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Build completed after continuation',
        totalCostUsd: 0.4,
      });

    const result = await executeBuildPhase(makeConfig());

    expect(runBuildAgent).toHaveBeenCalledTimes(2);
    expect(result.costUsd).toBe(1.0);
    // token_limit_recovery comment posted via repoContext
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalled();
  });

  it('throws when token continuations exceed max', async () => {
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: false,
      output: 'Partial',
      totalCostUsd: 0.3,
      tokenLimitExceeded: true,
      tokenUsage: { totalInputTokens: 180000, totalOutputTokens: 15000, totalCacheCreationTokens: 0, totalTokens: 195000, maxTokens: 200000, thresholdPercent: 80 },
    });

    await expect(executeBuildPhase(makeConfig())).rejects.toThrow('exceeded maximum token continuations');
  });

  it('commits implementation when stage should execute', async () => {
    await executeBuildPhase(makeConfig());

    expect(runCommitAgent).toHaveBeenCalled();
  });

  it('skips commit when stage already completed', async () => {
    vi.mocked(shouldExecuteStage).mockImplementation((stage: string) => {
      if (stage === 'implementation_committing') return false;
      return true;
    });

    await executeBuildPhase(makeConfig());

    expect(runCommitAgent).not.toHaveBeenCalled();
  });

  it('accumulates model usage across continuations', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: false,
        output: 'Partial',
        totalCostUsd: 0.3,
        tokenLimitExceeded: true,
        tokenUsage: { totalInputTokens: 180000, totalOutputTokens: 15000, totalCacheCreationTokens: 0, totalTokens: 195000, maxTokens: 200000, thresholdPercent: 80 },
        modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Done',
        totalCostUsd: 0.2,
        modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.2 } },
      });

    const result = await executeBuildPhase(makeConfig());

    expect(result.costUsd).toBe(0.5);
    expect(result.modelUsage['claude-sonnet-4-20250514'].inputTokens).toBe(150);
  });
});
