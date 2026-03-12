import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state/kpi-agent'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    emptyModelUsageMap: actual.emptyModelUsageMap,
  };
});

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  runKpiAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Updated app_docs/agentic_kpis.md',
    totalCostUsd: 0.05,
    modelUsage: { 'claude-haiku-4-5-20251001': { inputTokens: 20, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.05 } },
  }),
}));

import { AgentStateManager, emptyModelUsageMap } from '../../core';
import { runKpiAgent } from '../../agents';
import { executeKpiPhase } from '../kpiPhase';
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
    orchestratorName: 'orchestrator',
    recoveryState: {
      lastCompletedStage: null, adwId: null, branchName: null,
      planPath: null, prUrl: null, canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: '',
    projectConfig: { commands: {} } as any,
    ...overrides,
  };
}

describe('executeKpiPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs KPI agent and returns cost/modelUsage', async () => {
    const result = await executeKpiPhase(makeConfig());

    expect(result.costUsd).toBe(0.05);
    expect(result.modelUsage).toBeDefined();
    expect(result.modelUsage['claude-haiku-4-5-20251001']).toBeDefined();
  });

  it('initializes agent state with kpi-agent identifier', async () => {
    await executeKpiPhase(makeConfig());

    expect(AgentStateManager.initializeState).toHaveBeenCalledWith(
      'adw-test-abc123', 'kpi-agent', '/mock/state/orchestrator',
    );
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/kpi-agent',
      expect.objectContaining({ agentName: 'kpi-agent' }),
    );
  });

  it('passes correct arguments to runKpiAgent', async () => {
    await executeKpiPhase(makeConfig());

    expect(runKpiAgent).toHaveBeenCalledWith(
      'adw-test-abc123',
      '/mock/logs',
      42,
      '/feature',
      'specs/issue-42-plan.md',
      ['adw_plan_iso'],
      '/mock/state/kpi-agent',
      '/mock/worktree',
      'Issue body',
    );
  });

  it('builds allAdws with only adw_plan_iso when reviewRetries is 0', async () => {
    await executeKpiPhase(makeConfig(), 0);

    const callArgs = vi.mocked(runKpiAgent).mock.calls[0];
    expect(callArgs[5]).toEqual(['adw_plan_iso']);
  });

  it('builds allAdws with only adw_plan_iso when reviewRetries is undefined', async () => {
    await executeKpiPhase(makeConfig());

    const callArgs = vi.mocked(runKpiAgent).mock.calls[0];
    expect(callArgs[5]).toEqual(['adw_plan_iso']);
  });

  it('builds allAdws with adw_plan_iso + N adw_patch_iso entries when reviewRetries is N', async () => {
    await executeKpiPhase(makeConfig(), 3);

    const callArgs = vi.mocked(runKpiAgent).mock.calls[0];
    expect(callArgs[5]).toEqual(['adw_plan_iso', 'adw_patch_iso', 'adw_patch_iso', 'adw_patch_iso']);
  });

  it('does NOT throw when KPI agent fails', async () => {
    vi.mocked(runKpiAgent).mockResolvedValueOnce({
      success: false,
      output: 'KPI tracking failed',
      totalCostUsd: 0.01,
    });

    const result = await executeKpiPhase(makeConfig());

    expect(result.costUsd).toBe(0.01);
  });

  it('returns zero cost when KPI agent throws an exception', async () => {
    vi.mocked(runKpiAgent).mockRejectedValueOnce(new Error('Unexpected error'));

    const result = await executeKpiPhase(makeConfig());

    expect(result.costUsd).toBe(0);
    expect(result.modelUsage).toEqual(emptyModelUsageMap());
  });

  it('logs error when KPI agent fails', async () => {
    const { log } = await import('../../core');
    vi.mocked(runKpiAgent).mockResolvedValueOnce({
      success: false,
      output: 'KPI tracking failed',
      totalCostUsd: 0.01,
    });

    await executeKpiPhase(makeConfig());

    expect(log).toHaveBeenCalledWith(expect.stringContaining('KPI Agent failed'), 'warn');
  });

  it('writes failure state when agent fails but does not throw', async () => {
    vi.mocked(runKpiAgent).mockResolvedValueOnce({
      success: false,
      output: 'Failed',
      totalCostUsd: 0.01,
    });

    await executeKpiPhase(makeConfig());

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/kpi-agent',
      expect.objectContaining({
        execution: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('returns model usage data on success', async () => {
    const result = await executeKpiPhase(makeConfig());

    expect(result.modelUsage['claude-haiku-4-5-20251001']).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0.05,
    });
  });
});
