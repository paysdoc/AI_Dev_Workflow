import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state/plan-agent'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    shouldExecuteStage: vi.fn().mockReturnValue(true),
    emptyModelUsageMap: actual.emptyModelUsageMap,
    OrchestratorId: { Plan: 'plan-orchestrator' },
  };
});

vi.mock('../../github', () => ({
  postWorkflowComment: vi.fn(),
  moveIssueToStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../agents', () => ({
  runPlanAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Plan created successfully',
    totalCostUsd: 0.5,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
  }),
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  planFileExists: vi.fn().mockReturnValue(false),
  readPlanFile: vi.fn().mockReturnValue('# Plan content'),
  correctPlanFileNaming: vi.fn(),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: 'Committed' }),
}));

import { shouldExecuteStage, AgentStateManager } from '../../core';
import { postWorkflowComment, moveIssueToStatus } from '../../github';
import { runPlanAgent, planFileExists, readPlanFile, runCommitAgent } from '../../agents';
import { executePlanPhase, buildContinuationPrompt, MAX_CONTINUATION_OUTPUT_LENGTH } from '../planPhase';
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
    orchestratorName: 'plan-orchestrator',
    recoveryState: {
      lastCompletedStage: null, adwId: null, branchName: null,
      planPath: null, prUrl: null, canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123', branchName: 'feat-issue-42-test' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: '',
    projectConfig: { commands: {} } as any,
    ...overrides,
  };
}

describe('executePlanPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(planFileExists).mockReturnValue(false);
    vi.mocked(readPlanFile).mockReturnValue('# Plan content');
    vi.mocked(runPlanAgent).mockResolvedValue({
      success: true,
      output: 'Plan created successfully',
      totalCostUsd: 0.5,
      modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
    });
  });

  it('runs plan agent and returns cost', async () => {
    const result = await executePlanPhase(makeConfig());

    expect(result.costUsd).toBe(0.5);
    expect(moveIssueToStatus).toHaveBeenCalledWith(42, 'In Progress', undefined);
    expect(runPlanAgent).toHaveBeenCalled();
    expect(postWorkflowComment).toHaveBeenCalledWith(42, 'plan_created', expect.any(Object), undefined);
  });

  it('writes agent state on success', async () => {
    await executePlanPhase(makeConfig());

    expect(AgentStateManager.initializeState).toHaveBeenCalledWith('adw-test-abc123', 'plan-agent', '/mock/state/orchestrator');
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/plan-agent',
      expect.objectContaining({ planFile: 'specs/issue-42-plan.md' }),
    );
  });

  it('throws when plan agent fails', async () => {
    vi.mocked(runPlanAgent).mockResolvedValueOnce({
      success: false, output: 'Plan generation failed', totalCostUsd: 0.1,
    });

    await expect(executePlanPhase(makeConfig())).rejects.toThrow('Plan Agent failed');
  });

  it('skips plan agent when stage already completed', async () => {
    vi.mocked(shouldExecuteStage).mockImplementation((stage: string) => {
      if (stage === 'plan_created') return false;
      return true;
    });

    const result = await executePlanPhase(makeConfig());

    expect(runPlanAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('skips plan agent when plan file already exists', async () => {
    vi.mocked(planFileExists).mockReturnValue(true);

    const result = await executePlanPhase(makeConfig());

    expect(runPlanAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('uses plan file content for comment summary when available', async () => {
    vi.mocked(readPlanFile).mockReturnValue('# Detailed plan content');

    const config = makeConfig();
    await executePlanPhase(config);

    expect(config.ctx.planOutput).toBe('# Detailed plan content');
  });

  it('falls back to agent output when plan file is unreadable', async () => {
    vi.mocked(readPlanFile).mockReturnValue(null);

    const config = makeConfig();
    await executePlanPhase(config);

    expect(config.ctx.planOutput).toBe('Plan created successfully');
  });

  it('commits plan when plan_committing stage should execute', async () => {
    await executePlanPhase(makeConfig());

    expect(runCommitAgent).toHaveBeenCalled();
  });

  it('returns model usage data', async () => {
    const result = await executePlanPhase(makeConfig());

    expect(result.modelUsage).toBeDefined();
    expect(result.modelUsage['claude-sonnet-4-20250514']).toBeDefined();
  });
});

describe('buildContinuationPrompt', () => {
  it('includes original plan and previous output', () => {
    const result = buildContinuationPrompt('# Original Plan', 'Previous work done');

    expect(result).toContain('# Original Plan');
    expect(result).toContain('Previous work done');
    expect(result).toContain('Continuation Context');
  });

  it('truncates long previous output', () => {
    const longOutput = 'x'.repeat(MAX_CONTINUATION_OUTPUT_LENGTH + 1000);

    const result = buildContinuationPrompt('# Plan', longOutput);

    expect(result).toContain('# Plan');
    expect(result.length).toBeLessThan(longOutput.length + 500);
  });

  it('preserves short previous output', () => {
    const shortOutput = 'Short output';

    const result = buildContinuationPrompt('# Plan', shortOutput);

    expect(result).toContain('Short output');
  });
});
