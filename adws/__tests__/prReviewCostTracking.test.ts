import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import {
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  type PRReviewWorkflowConfig,
} from '../workflowPhases';
import { PRDetails, PRReviewComment } from '../types/dataTypes';
import { PRReviewWorkflowContext } from '../github/workflowComments';

vi.mock('fs');

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
    ensureLogsDirectory: vi.fn().mockReturnValue('/mock/logs'),
    generateAdwId: vi.fn().mockReturnValue('test-issue-abc123'),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state/path'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2024-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2024-01-01' }),
      readState: vi.fn().mockReturnValue({ metadata: {} }),
    },
    MAX_TEST_RETRY_ATTEMPTS: 5,
    COST_REPORT_CURRENCIES: ['EUR'],
    allocateRandomPort: vi.fn().mockResolvedValue(12345),
    buildCostBreakdown: vi.fn().mockResolvedValue({
      totalCostUsd: 1.5,
      modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 } },
      currencies: [{ currency: 'EUR', amount: 1.35, symbol: '€' }],
    }),
    writeIssueCostCsv: vi.fn(),
    rebuildProjectCostCsv: vi.fn(),
    mergeModelUsageMaps: actual.mergeModelUsageMaps,
    emptyModelUsageMap: actual.emptyModelUsageMap,
    persistTokenCounts: vi.fn(),
  };
});

vi.mock('../github', () => ({
  fetchPRDetails: vi.fn().mockReturnValue({
    number: 42,
    title: 'Test PR',
    body: 'Test PR body',
    state: 'OPEN',
    headBranch: 'feature/issue-10-test',
    baseBranch: 'main',
    url: 'https://github.com/test/repo/pull/42',
    issueNumber: 10,
    reviewComments: [],
  }),
  getUnaddressedComments: vi.fn().mockReturnValue([
    { id: 1, author: { login: 'reviewer', isBot: false }, body: 'Fix this', path: 'src/file.ts', line: 10, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  ]),
  postWorkflowComment: vi.fn(),
  postPRWorkflowComment: vi.fn(),
  getRepoInfo: vi.fn().mockReturnValue({ owner: 'test', repo: 'repo' }),
  moveIssueToStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../vcs', () => ({
  pushBranch: vi.fn(),
  ensureWorktree: vi.fn().mockReturnValue('/mock/worktree'),
  inferIssueTypeFromBranch: vi.fn().mockReturnValue('/feature'),
}));

vi.mock('../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-1-adw-test123-sdlc_planner-test.md'),
  runPrReviewPlanAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'PR Review Plan created',
    totalCostUsd: 0.3,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
  }),
  runPrReviewBuildAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'PR Review Build completed',
    totalCostUsd: 0.8,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.8 } },
  }),
  runCommitAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'commit message',
    commitMessage: 'commit message',
  }),
  runUnitTestsWithRetry: vi.fn(),
  runE2ETestsWithRetry: vi.fn(),
}));

import { AgentStateManager, writeIssueCostCsv, rebuildProjectCostCsv, persistTokenCounts, buildCostBreakdown } from '../core';
import { getRepoInfo } from '../github';
import { runPrReviewPlanAgent, runPrReviewBuildAgent, runUnitTestsWithRetry, runE2ETestsWithRetry } from '../agents';
import { makeRepoContext, type MockRepoContext } from '../phases/__tests__/helpers/makeRepoContext';

let mockRepoContext: MockRepoContext;

function createMockPRDetails(overrides: Partial<PRDetails> = {}): PRDetails {
  return {
    number: 42,
    title: 'Test PR',
    body: 'Test PR body',
    state: 'OPEN',
    headBranch: 'feature/issue-10-test',
    baseBranch: 'main',
    url: 'https://github.com/test/repo/pull/42',
    issueNumber: 10,
    reviewComments: [],
    ...overrides,
  };
}

function createMockPRReviewComments(): PRReviewComment[] {
  return [
    { id: 1, author: { login: 'reviewer', isBot: false }, body: 'Fix this', path: 'src/file.ts', line: 10, createdAt: '2024-01-01', updatedAt: '2024-01-01' },
  ];
}

function createPRReviewWorkflowConfig(overrides: Partial<PRReviewWorkflowConfig> = {}): PRReviewWorkflowConfig {
  return {
    prNumber: 42,
    issueNumber: 10,
    adwId: 'test-adw-id',
    prDetails: createMockPRDetails(),
    unaddressedComments: createMockPRReviewComments(),
    worktreePath: '/mock/worktree',
    logsDir: '/mock/logs',
    orchestratorStatePath: '/mock/state/path',
    applicationUrl: 'http://localhost:12345',
    ctx: {
      issueNumber: 10,
      adwId: 'test-adw-id',
      prNumber: 42,
      reviewComments: 1,
      branchName: 'feature/issue-10-test',
    } as PRReviewWorkflowContext,
    repoContext: mockRepoContext,
    ...overrides,
  };
}

// ============================================================================
// PR Review Cost Tracking Tests
// ============================================================================

describe('PR Review Cost Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoContext = makeRepoContext();
  });

  describe('executePRReviewPlanPhase cost data', () => {
    it('returns costUsd and modelUsage from agent result', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('# Existing plan');
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewPlanPhase(config);

      expect(result.costUsd).toBe(0.3);
      expect(result.modelUsage).toEqual({
        'claude-sonnet-4-20250514': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 },
      });
    });

    it('returns zero cost when agent result has no cost data', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('# Plan');
      vi.mocked(runPrReviewPlanAgent).mockResolvedValue({
        success: true,
        output: 'Plan output',
        totalCostUsd: undefined as unknown as number,
        modelUsage: undefined as unknown as Record<string, never>,
      });
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewPlanPhase(config);

      expect(result.costUsd).toBe(0);
      expect(result.modelUsage).toEqual({});
    });
  });

  describe('executePRReviewBuildPhase cost data', () => {
    it('returns costUsd and modelUsage from agent result', async () => {
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewBuildPhase(config, 'plan output');

      expect(result.costUsd).toBe(0.8);
      expect(result.modelUsage).toEqual({
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.8 },
      });
    });

    it('returns zero cost when agent result has no cost data', async () => {
      vi.mocked(runPrReviewBuildAgent).mockResolvedValue({
        success: true,
        output: 'Build output',
        totalCostUsd: undefined as unknown as number,
        modelUsage: undefined as unknown as Record<string, never>,
      });
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewBuildPhase(config, 'plan output');

      expect(result.costUsd).toBe(0);
      expect(result.modelUsage).toEqual({});
    });
  });

  describe('executePRReviewTestPhase cost data', () => {
    it('aggregates costs from unit and E2E test results', async () => {
      vi.mocked(runUnitTestsWithRetry).mockResolvedValue({
        passed: true,
        failedTests: [],
        totalRetries: 0,
        costUsd: 0.2,
        modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 30, outputTokens: 15, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.2 } },
      });
      vi.mocked(runE2ETestsWithRetry).mockResolvedValue({
        passed: true,
        failedTests: [],
        totalRetries: 0,
        costUsd: 0.4,
        modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 40, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.4 } },
      });
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewTestPhase(config);

      expect(result.costUsd).toBeCloseTo(0.6);
      expect(result.modelUsage['claude-sonnet-4-20250514'].costUSD).toBeCloseTo(0.6);
      expect(result.modelUsage['claude-sonnet-4-20250514'].inputTokens).toBe(70);
      expect(result.modelUsage['claude-sonnet-4-20250514'].outputTokens).toBe(35);
    });

    it('aggregates costs from multiple models', async () => {
      vi.mocked(runUnitTestsWithRetry).mockResolvedValue({
        passed: true,
        failedTests: [],
        totalRetries: 0,
        costUsd: 0.5,
        modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 50, outputTokens: 25, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 } },
      });
      vi.mocked(runE2ETestsWithRetry).mockResolvedValue({
        passed: true,
        failedTests: [],
        totalRetries: 0,
        costUsd: 0.3,
        modelUsage: { 'claude-haiku-3-5-20241022': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
      });
      const config = createPRReviewWorkflowConfig();

      const result = await executePRReviewTestPhase(config);

      expect(result.costUsd).toBe(0.8);
      expect(Object.keys(result.modelUsage)).toHaveLength(2);
      expect(result.modelUsage['claude-sonnet-4-20250514'].costUSD).toBe(0.5);
      expect(result.modelUsage['claude-haiku-3-5-20241022'].costUSD).toBe(0.3);
    });
  });

  describe('completePRReviewWorkflow CSV writing', () => {
    it('calls writeIssueCostCsv and updateProjectCostCsv when modelUsage is provided', async () => {
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };
      const config = createPRReviewWorkflowConfig();

      await completePRReviewWorkflow(config, modelUsage);

      expect(buildCostBreakdown).toHaveBeenCalledWith(modelUsage, expect.any(Array));
      expect(writeIssueCostCsv).toHaveBeenCalledWith(
        process.cwd(),
        'test-repo',
        10,
        'Test PR',
        expect.objectContaining({ totalCostUsd: 1.5 }),
      );
      expect(rebuildProjectCostCsv).toHaveBeenCalledWith(
        process.cwd(),
        'test-repo',
        expect.any(Number),
      );
    });

    it('uses config.repoContext.repoId.repo when available', async () => {
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };
      const customRepoContext = { ...makeRepoContext(), repoId: { ...makeRepoContext().repoId, owner: 'custom-owner', repo: 'custom-repo' } };
      const config = createPRReviewWorkflowConfig({
        repoContext: customRepoContext,
      });

      await completePRReviewWorkflow(config, modelUsage);

      expect(writeIssueCostCsv).toHaveBeenCalledWith(
        process.cwd(),
        'custom-repo',
        10,
        'Test PR',
        expect.anything(),
      );
      expect(getRepoInfo).not.toHaveBeenCalled();
    });

    it('does not write CSVs when modelUsage is undefined', async () => {
      const config = createPRReviewWorkflowConfig();

      await completePRReviewWorkflow(config);

      expect(writeIssueCostCsv).not.toHaveBeenCalled();
      expect(rebuildProjectCostCsv).not.toHaveBeenCalled();
    });

    it('does not write CSVs when modelUsage is an empty object', async () => {
      const config = createPRReviewWorkflowConfig();

      await completePRReviewWorkflow(config, {});

      expect(writeIssueCostCsv).not.toHaveBeenCalled();
      expect(rebuildProjectCostCsv).not.toHaveBeenCalled();
    });

    it('catches and logs CSV write failures without throwing', async () => {
      vi.mocked(writeIssueCostCsv).mockImplementation(() => {
        throw new Error('CSV write failed');
      });
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };
      const config = createPRReviewWorkflowConfig();

      // Should not throw
      await expect(completePRReviewWorkflow(config, modelUsage)).resolves.not.toThrow();
    });

    it('writes cost metadata to state when modelUsage is provided', async () => {
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };
      const config = createPRReviewWorkflowConfig();

      await completePRReviewWorkflow(config, modelUsage);

      expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', expect.objectContaining({
        metadata: expect.objectContaining({
          totalCostUsd: 1.5,
          modelUsage,
        }),
      }));
    });

    it('does not include metadata key when modelUsage is not provided', async () => {
      const config = createPRReviewWorkflowConfig();

      await completePRReviewWorkflow(config);

      expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
        execution: expect.objectContaining({ status: 'completed' }),
      });
    });
  });

  describe('handlePRReviewWorkflowError cost persistence', () => {
    it('calls persistTokenCounts when cost data is provided', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const config = createPRReviewWorkflowConfig();
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };

      handlePRReviewWorkflowError(config, new Error('test error'), 1.5, modelUsage);

      expect(persistTokenCounts).toHaveBeenCalledWith('/mock/state/path', 1.5, modelUsage);

      mockExit.mockRestore();
    });

    it('does not call persistTokenCounts when cost data is not provided', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const config = createPRReviewWorkflowConfig();

      handlePRReviewWorkflowError(config, new Error('test error'));

      expect(persistTokenCounts).not.toHaveBeenCalled();

      mockExit.mockRestore();
    });

    it('still posts error comment and exits when cost data is provided', () => {
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const config = createPRReviewWorkflowConfig();
      const modelUsage = {
        'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
      };

      handlePRReviewWorkflowError(config, new Error('test error'), 1.5, modelUsage);

      expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });
  });
});
