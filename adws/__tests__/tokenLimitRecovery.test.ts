import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import {
  executeBuildPhase,
  type WorkflowConfig,
} from '../workflowPhases';
import { RecoveryState, GitHubIssue } from '../types/dataTypes';
import { getDefaultProjectConfig } from '../core/projectConfig';
import { WorkflowContext } from '../github/workflowCommentsIssue';
import { OrchestratorId } from '../core/constants';

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
    },
    shouldExecuteStage: vi.fn().mockReturnValue(true),
    hasUncommittedChanges: vi.fn().mockReturnValue(false),
    getNextStage: vi.fn().mockReturnValue('classified'),
    MAX_TEST_RETRY_ATTEMPTS: 5,
    MAX_REVIEW_RETRY_ATTEMPTS: 3,
    MAX_TOKEN_CONTINUATIONS: 3,
  };
});

vi.mock('../github', () => ({
  fetchGitHubIssue: vi.fn(),
  fetchPRDetails: vi.fn(),
  getUnaddressedComments: vi.fn(),
  postWorkflowComment: vi.fn(),
  postPRWorkflowComment: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
  detectRecoveryState: vi.fn(),
  getDefaultBranch: vi.fn().mockReturnValue('main'),
  fetchAndResetToRemote: vi.fn(),
  ensureWorktree: vi.fn(),
  getWorktreeForBranch: vi.fn(),
  mergeLatestFromDefaultBranch: vi.fn(),
  copyEnvToWorktree: vi.fn(),
  inferIssueTypeFromBranch: vi.fn(),
}));

vi.mock('../agents', () => ({
  runPlanAgent: vi.fn(),
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-1-adw-test123-sdlc_planner-test.md'),
  planFileExists: vi.fn().mockReturnValue(false),
  runBuildAgent: vi.fn(),
  runPrReviewPlanAgent: vi.fn(),
  runPrReviewBuildAgent: vi.fn(),
  runGenerateBranchNameAgent: vi.fn(),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: 'committed' }),
  runUnitTestsWithRetry: vi.fn(),
  runE2ETestsWithRetry: vi.fn(),
  runReviewWithRetry: vi.fn(),
}));

vi.mock('../core/issueClassifier', () => ({
  classifyGitHubIssue: vi.fn(),
}));

import { AgentStateManager } from '../core';
import { postWorkflowComment } from '../github';
import { runBuildAgent } from '../agents';
import { makeRepoContext, type MockRepoContext } from '../phases/__tests__/helpers/makeRepoContext';

let mockRepoContext: MockRepoContext;

function createMockIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: 'Test issue',
    body: 'Test body',
    state: 'open',
    author: { login: 'test', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    url: 'https://github.com/test/repo/issues/1',
    ...overrides,
  };
}

function createRecoveryState(overrides: Partial<RecoveryState> = {}): RecoveryState {
  return {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
    ...overrides,
  };
}

function createWorkflowConfig(overrides: Partial<WorkflowConfig> = {}): WorkflowConfig {
  return {
    issueNumber: 1,
    adwId: 'test-adw-id',
    issue: createMockIssue(),
    issueType: '/feature',
    worktreePath: '/mock/worktree',
    defaultBranch: 'main',
    logsDir: '/mock/logs',
    orchestratorStatePath: '/mock/state/path',
    orchestratorName: OrchestratorId.Plan,
    recoveryState: createRecoveryState(),
    ctx: { issueNumber: 1, adwId: 'test-adw-id' } as WorkflowContext,
    branchName: 'feature/issue-1-test',
    applicationUrl: 'http://localhost:3000',
    projectConfig: getDefaultProjectConfig(),
    repoContext: mockRepoContext,
    ...overrides,
  };
}

describe('executeBuildPhase - token limit recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoContext = makeRepoContext();
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan content');
  });

  it('recovers from token limit on first call and succeeds on second', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: true,
        output: 'Partial implementation output',
        tokenLimitExceeded: true,
        totalCostUsd: 0.5,
        tokenUsage: {
          totalInputTokens: 100000,
          totalOutputTokens: 60000,
          totalCacheCreationTokens: 20000,
          totalTokens: 180000,
          maxTokens: 200000,
          thresholdPercent: 0.9,
        },
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 100000,
            outputTokens: 60000,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 20000,
            costUSD: 0.5,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Build completed successfully',
        totalCostUsd: 0.3,
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 50000,
            outputTokens: 20000,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 5000,
            costUSD: 0.3,
          },
        },
      });

    const config = createWorkflowConfig();
    const result = await executeBuildPhase(config);

    // Verify two build agent calls were made
    expect(runBuildAgent).toHaveBeenCalledTimes(2);

    // Verify recovery comment was posted via repoContext
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalled();

    // Verify costs are accumulated
    expect(result.costUsd).toBeCloseTo(0.8);

    // Verify continuation prompt includes previous output
    const secondCallArgs = vi.mocked(runBuildAgent).mock.calls[1];
    const continuationPlan = secondCallArgs[2]; // planContent arg
    expect(continuationPlan).toContain('Partial implementation output');
    expect(continuationPlan).toContain('Continue implementing');
    expect(continuationPlan).toContain('Do NOT re-do work');
  });

  it('throws error when max continuations are exhausted', async () => {
    // All calls return tokenLimitExceeded
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: true,
      output: 'Partial output',
      tokenLimitExceeded: true,
      totalCostUsd: 0.5,
      tokenUsage: {
        totalInputTokens: 100000,
        totalOutputTokens: 60000,
        totalCacheCreationTokens: 20000,
        totalTokens: 180000,
        maxTokens: 200000,
        thresholdPercent: 0.9,
      },
      modelUsage: {},
    });

    const config = createWorkflowConfig();

    await expect(executeBuildPhase(config)).rejects.toThrow('maximum token continuations');

    // Should have been called 4 times: 1 initial + 3 continuations, with the 4th triggering the error
    expect(runBuildAgent).toHaveBeenCalledTimes(4);

    // Recovery comments posted for each continuation via repoContext
    // 3 token_limit_recovery + 1 implementing = 4 total comment calls
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalled();
    const commentCalls = vi.mocked(mockRepoContext.issueTracker.commentOnIssue).mock.calls;
    expect(commentCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('does not trigger recovery when agent completes normally', async () => {
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: true,
      output: 'Build completed',
      totalCostUsd: 1.0,
      modelUsage: {},
    });

    const config = createWorkflowConfig();
    const result = await executeBuildPhase(config);

    expect(runBuildAgent).toHaveBeenCalledTimes(1);
    expect(result.costUsd).toBe(1.0);

    // No recovery comment should be posted
    const recoveryCommentCalls = vi.mocked(postWorkflowComment).mock.calls.filter(
      ([, stage]) => stage === 'token_limit_recovery'
    );
    expect(recoveryCommentCalls).toHaveLength(0);
  });

  it('saves partial state to agent state on token limit', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: true,
        output: 'Partial output',
        tokenLimitExceeded: true,
        totalCostUsd: 0.5,
        tokenUsage: {
          totalInputTokens: 90000,
          totalOutputTokens: 70000,
          totalCacheCreationTokens: 20000,
          totalTokens: 180000,
          maxTokens: 200000,
          thresholdPercent: 0.9,
        },
        modelUsage: {},
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Done',
        totalCostUsd: 0.3,
        modelUsage: {},
      });

    const config = createWorkflowConfig();
    await executeBuildPhase(config);

    // Verify state was saved with token usage inside metadata
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/path',
      expect.objectContaining({
        metadata: expect.objectContaining({
          tokenUsage: expect.objectContaining({
            totalTokens: 180000,
          }),
        }),
      })
    );
  });

  it('throws when build agent fails without token limit', async () => {
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: false,
      output: 'Build error',
      totalCostUsd: 0,
    });

    const config = createWorkflowConfig();
    await expect(executeBuildPhase(config)).rejects.toThrow('Build Agent failed');
  });

  it('accumulates model usage across continuations', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: true,
        output: 'Partial',
        tokenLimitExceeded: true,
        totalCostUsd: 0.5,
        tokenUsage: {
          totalInputTokens: 90000,
          totalOutputTokens: 70000,
          totalCacheCreationTokens: 20000,
          totalTokens: 180000,
          maxTokens: 200000,
          thresholdPercent: 0.9,
        },
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 90000,
            outputTokens: 70000,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 20000,
            costUSD: 0.5,
          },
        },
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Done',
        totalCostUsd: 0.3,
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 50000,
            outputTokens: 20000,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 5000,
            costUSD: 0.3,
          },
        },
      });

    const config = createWorkflowConfig();
    const result = await executeBuildPhase(config);

    // Model usage should be merged
    const opusUsage = result.modelUsage['claude-opus-4-6'];
    expect(opusUsage).toBeDefined();
    expect(opusUsage.inputTokens).toBe(140000); // 90000 + 50000
    expect(opusUsage.outputTokens).toBe(90000); // 70000 + 20000
  });
});
