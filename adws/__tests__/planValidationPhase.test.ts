/**
 * Unit tests for the Plan Validation phase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowConfig } from '../phases/workflowLifecycle';
import type { ValidationResult } from '../agents/validationAgent';
import type { ResolutionResult } from '../agents/resolutionAgent';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
    MAX_VALIDATION_RETRY_ATTEMPTS: 3,
    AgentStateManager: {
      appendLog: vi.fn(),
      writeState: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2024-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2024-01-01', completedAt: '2024-01-01' }),
    },
    emptyModelUsageMap: actual.emptyModelUsageMap,
    mergeModelUsageMaps: actual.mergeModelUsageMaps,
  };
});

vi.mock('../agents', () => ({
  readPlanFile: vi.fn(),
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-1-plan.md'),
  findScenarioFiles: vi.fn(),
  runValidationAgent: vi.fn(),
  runResolutionAgent: vi.fn(),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: '', totalCostUsd: 0 }),
}));

vi.mock('../phases/phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

import { executePlanValidationPhase } from '../phases/planValidationPhase';
import {
  readPlanFile,
  findScenarioFiles,
  runValidationAgent,
  runResolutionAgent,
  runCommitAgent,
} from '../agents';
import { postIssueStageComment } from '../phases/phaseCommentHelpers';
import { AgentStateManager } from '../core';

const mockReadPlanFile = vi.mocked(readPlanFile);
const mockFindScenarioFiles = vi.mocked(findScenarioFiles);
const mockRunValidationAgent = vi.mocked(runValidationAgent);
const mockRunResolutionAgent = vi.mocked(runResolutionAgent);
const mockRunCommitAgent = vi.mocked(runCommitAgent);
const mockPostIssueStageComment = vi.mocked(postIssueStageComment);

function makeValidationResult(aligned: boolean, mismatches: ValidationResult['mismatches'] = []): ValidationResult {
  return { aligned, mismatches, summary: aligned ? 'Aligned' : 'Mismatches found' };
}

function makeAgentValidationResult(aligned: boolean): Awaited<ReturnType<typeof runValidationAgent>> {
  return {
    success: true,
    output: '{}',
    totalCostUsd: 0.1,
    validationResult: makeValidationResult(aligned, aligned ? [] : [{ type: 'plan_only', description: 'Missing scenario' }]),
  };
}

function makeAgentResolutionResult(): Awaited<ReturnType<typeof runResolutionAgent>> {
  return {
    success: true,
    output: '{}',
    totalCostUsd: 0.2,
    resolutionResult: {
      resolved: true,
      decisions: [{ mismatch: 'Missing scenario', action: 'updated_plan', reasoning: 'Updated plan to match issue' }],
    } satisfies ResolutionResult,
  };
}

function makeConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    orchestratorStatePath: '/mock/orchestrator',
    adwId: 'test-adw-id',
    issueNumber: 1,
    issue: {
      number: 1,
      title: 'Test issue',
      body: 'Test body',
      state: 'open',
      author: { login: 'test', isBot: false },
      assignees: [],
      labels: [],
      comments: [],
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
      url: 'https://github.com/test/repo/issues/1',
    },
    issueType: '/feature',
    worktreePath: '/mock/worktree',
    logsDir: '/mock/logs',
    repoContext: undefined,
    ctx: {
      issueNumber: 1,
      adwId: 'test-adw-id',
    },
    recoveryState: {
      lastCompletedStage: null,
      adwId: null,
      branchName: null,
      planPath: null,
      prUrl: null,
      canResume: false,
    },
    orchestratorName: 'orchestrator',
    branchName: 'feature-1',
    ...overrides,
  } as WorkflowConfig;
}

describe('executePlanValidationPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPlanFile.mockReturnValue('# Implementation Plan\n\n## Feature X\nDo something');
    mockFindScenarioFiles.mockReturnValue(['/mock/worktree/features/test.feature']);
  });

  describe('no scenario files found', () => {
    it('returns zero cost and skips validation when no scenario files exist', async () => {
      mockFindScenarioFiles.mockReturnValue([]);
      const config = makeConfig();
      const result = await executePlanValidationPhase(config);
      expect(result.costUsd).toBe(0);
      expect(mockRunValidationAgent).not.toHaveBeenCalled();
    });

    it('logs the skip reason', async () => {
      mockFindScenarioFiles.mockReturnValue([]);
      const { log } = await import('../core');
      const mockLog = vi.mocked(log);
      await executePlanValidationPhase(makeConfig());
      expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Skipping'), 'info');
    });
  });

  describe('plan file not found', () => {
    it('throws an error when plan file cannot be read', async () => {
      mockReadPlanFile.mockReturnValue(null);
      mockFindScenarioFiles.mockReturnValue(['/a.feature']);
      await expect(executePlanValidationPhase(makeConfig())).rejects.toThrow(/Cannot read plan file/);
    });
  });

  describe('happy path: aligned on first attempt', () => {
    it('returns cost from the validation agent', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      const result = await executePlanValidationPhase(makeConfig());
      expect(result.costUsd).toBe(0.1);
    });

    it('does not run the resolution agent', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      await executePlanValidationPhase(makeConfig());
      expect(mockRunResolutionAgent).not.toHaveBeenCalled();
    });

    it('posts plan_validating and plan_validated stage comments when repoContext exists', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      const repoContext = {
        issueTracker: { commentOnIssue: vi.fn(), moveToStatus: vi.fn() },
        codeHost: { commentOnMergeRequest: vi.fn() },
      };
      const config = makeConfig({ repoContext: repoContext as unknown as WorkflowConfig['repoContext'] });
      await executePlanValidationPhase(config);
      expect(mockPostIssueStageComment).toHaveBeenCalledWith(repoContext, 1, 'plan_validating', expect.anything());
      expect(mockPostIssueStageComment).toHaveBeenCalledWith(repoContext, 1, 'plan_validated', expect.anything());
    });

    it('does not post stage comments when repoContext is undefined', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      await executePlanValidationPhase(makeConfig({ repoContext: undefined }));
      expect(mockPostIssueStageComment).not.toHaveBeenCalled();
    });
  });

  describe('resolution path: mismatched then resolved', () => {
    it('runs the resolution agent when validation finds mismatches', async () => {
      mockRunValidationAgent
        .mockResolvedValueOnce(makeAgentValidationResult(false))
        .mockResolvedValueOnce(makeAgentValidationResult(true));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      await executePlanValidationPhase(makeConfig());
      expect(mockRunResolutionAgent).toHaveBeenCalledOnce();
    });

    it('accumulates costs across validation + resolution + re-validation', async () => {
      mockRunValidationAgent
        .mockResolvedValueOnce({ ...makeAgentValidationResult(false), totalCostUsd: 0.1 })
        .mockResolvedValueOnce({ ...makeAgentValidationResult(true), totalCostUsd: 0.15 });
      mockRunResolutionAgent.mockResolvedValue({ ...makeAgentResolutionResult(), totalCostUsd: 0.2 });

      const result = await executePlanValidationPhase(makeConfig());
      expect(result.costUsd).toBeCloseTo(0.45, 5);
    });

    it('commits updated artifacts after resolution when decisions are present', async () => {
      mockRunValidationAgent
        .mockResolvedValueOnce(makeAgentValidationResult(false))
        .mockResolvedValueOnce(makeAgentValidationResult(true));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      await executePlanValidationPhase(makeConfig());
      expect(mockRunCommitAgent).toHaveBeenCalled();
    });

    it('posts plan_resolving and plan_resolved comments when repoContext provided', async () => {
      mockRunValidationAgent
        .mockResolvedValueOnce(makeAgentValidationResult(false))
        .mockResolvedValueOnce(makeAgentValidationResult(true));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      const repoContext = {
        issueTracker: { commentOnIssue: vi.fn(), moveToStatus: vi.fn() },
        codeHost: { commentOnMergeRequest: vi.fn() },
      };
      await executePlanValidationPhase(makeConfig({ repoContext: repoContext as unknown as WorkflowConfig['repoContext'] }));

      expect(mockPostIssueStageComment).toHaveBeenCalledWith(repoContext, 1, 'plan_resolving', expect.anything());
      expect(mockPostIssueStageComment).toHaveBeenCalledWith(repoContext, 1, 'plan_resolved', expect.anything());
    });
  });

  describe('max attempts exceeded', () => {
    it('throws after MAX_VALIDATION_RETRY_ATTEMPTS failed resolution cycles', async () => {
      // Initial validation + 3 re-validations all return mismatched
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(false));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      await expect(executePlanValidationPhase(makeConfig())).rejects.toThrow(/failed after/i);
    });

    it('posts plan_validation_failed comment when max attempts exceeded', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(false));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      const repoContext = {
        issueTracker: { commentOnIssue: vi.fn(), moveToStatus: vi.fn() },
        codeHost: { commentOnMergeRequest: vi.fn() },
      };
      await expect(
        executePlanValidationPhase(makeConfig({ repoContext: repoContext as unknown as WorkflowConfig['repoContext'] }))
      ).rejects.toThrow();

      expect(mockPostIssueStageComment).toHaveBeenCalledWith(
        repoContext,
        1,
        'plan_validation_failed',
        expect.anything()
      );
    });
  });

  describe('state management', () => {
    it('logs to orchestrator state at start', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      await executePlanValidationPhase(makeConfig());
      expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
        '/mock/orchestrator',
        expect.stringContaining('plan validation')
      );
    });

    it('initializes agent state for validation-agent', async () => {
      mockRunValidationAgent.mockResolvedValue(makeAgentValidationResult(true));
      await executePlanValidationPhase(makeConfig());
      expect(AgentStateManager.initializeState).toHaveBeenCalledWith('test-adw-id', 'validation-agent', '/mock/orchestrator');
    });

    it('initializes agent state for resolution-agent when resolution runs', async () => {
      mockRunValidationAgent
        .mockResolvedValueOnce(makeAgentValidationResult(false))
        .mockResolvedValueOnce(makeAgentValidationResult(true));
      mockRunResolutionAgent.mockResolvedValue(makeAgentResolutionResult());

      await executePlanValidationPhase(makeConfig());
      expect(AgentStateManager.initializeState).toHaveBeenCalledWith('test-adw-id', 'resolution-agent', '/mock/orchestrator');
    });
  });
});
