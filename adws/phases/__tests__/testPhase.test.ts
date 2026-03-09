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
    MAX_TEST_RETRY_ATTEMPTS: 3,
    emptyModelUsageMap: actual.emptyModelUsageMap,
    mergeModelUsageMaps: actual.mergeModelUsageMaps,
  };
});

vi.mock('../../github', () => ({
  postWorkflowComment: vi.fn(),
}));

vi.mock('../../agents', () => ({
  runUnitTestsWithRetry: vi.fn().mockResolvedValue({
    passed: true,
    costUsd: 0.3,
    totalRetries: 1,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
  }),
  runE2ETestsWithRetry: vi.fn().mockResolvedValue({
    passed: true,
    costUsd: 0.2,
    totalRetries: 0,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 30, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.2 } },
  }),
}));

import { AgentStateManager } from '../../core';
import { postWorkflowComment } from '../../github';
import { runUnitTestsWithRetry, runE2ETestsWithRetry } from '../../agents';
import { executeTestPhase } from '../testPhase';
import type { WorkflowConfig } from '../workflowLifecycle';
import type { RecoveryState, GitHubIssue } from '../../core';
import type { WorkflowContext } from '../../github';

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
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: 'http://localhost:3000',
    projectConfig: { commands: {} } as any,
    ...overrides,
  };
}

// Spy on process.exit to prevent it from actually killing the test runner
const _mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

describe('executeTestPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs unit and E2E tests and returns combined results', async () => {
    const result = await executeTestPhase(makeConfig());

    expect(result.unitTestsPassed).toBe(true);
    expect(result.e2eTestsPassed).toBe(true);
    expect(result.costUsd).toBe(0.5);
    expect(result.totalRetries).toBe(1);
  });

  it('passes correct config to unit test runner', async () => {
    await executeTestPhase(makeConfig());

    expect(runUnitTestsWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        logsDir: '/mock/logs',
        orchestratorStatePath: '/mock/state/orchestrator',
        maxRetries: 3,
        cwd: '/mock/worktree',
        issueBody: 'Issue body',
      }),
    );
  });

  it('passes application URL to E2E test runner', async () => {
    await executeTestPhase(makeConfig());

    expect(runE2ETestsWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationUrl: 'http://localhost:3000',
      }),
    );
  });

  it('exits process when unit tests fail', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValueOnce({
      passed: false,
      costUsd: 0.4,
      totalRetries: 3,
      failedTests: [],
      modelUsage: {},
    });

    await expect(executeTestPhase(makeConfig())).rejects.toThrow('process.exit called');

    expect(postWorkflowComment).toHaveBeenCalledWith(42, 'error', expect.any(Object), undefined);
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      expect.objectContaining({
        metadata: expect.objectContaining({ unitTestsPassed: false }),
      }),
    );
  });

  it('exits process when E2E tests fail', async () => {
    vi.mocked(runE2ETestsWithRetry).mockResolvedValueOnce({
      passed: false,
      costUsd: 0.5,
      totalRetries: 3,
      failedTests: [],
      modelUsage: {},
    });

    await expect(executeTestPhase(makeConfig())).rejects.toThrow('process.exit called');

    expect(postWorkflowComment).toHaveBeenCalledWith(42, 'error', expect.any(Object), undefined);
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      expect.objectContaining({
        metadata: expect.objectContaining({ unitTestsPassed: true, e2eTestsPassed: false }),
      }),
    );
  });

  it('does not run E2E tests when unit tests fail', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValueOnce({
      passed: false,
      costUsd: 0.4,
      totalRetries: 3,
      failedTests: [],
      modelUsage: {},
    });

    await expect(executeTestPhase(makeConfig())).rejects.toThrow('process.exit called');

    expect(runE2ETestsWithRetry).not.toHaveBeenCalled();
  });

  it('logs state transitions', async () => {
    await executeTestPhase(makeConfig());

    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      'Starting test phase: Unit Tests',
    );
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      'Starting test phase: E2E Tests',
    );
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      'All tests passed',
    );
  });

  it('merges model usage across unit and E2E tests', async () => {
    const result = await executeTestPhase(makeConfig());

    expect(result.modelUsage['claude-sonnet-4-20250514'].inputTokens).toBe(80);
    expect(result.modelUsage['claude-sonnet-4-20250514'].outputTokens).toBe(40);
  });
});
