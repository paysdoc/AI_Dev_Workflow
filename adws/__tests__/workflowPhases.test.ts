import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  initializeWorkflow,
  executePlanPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  completeWorkflow,
  handleWorkflowError,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  type WorkflowConfig,
  type PRReviewWorkflowConfig,
} from '../workflowPhases';
import { RecoveryState, GitHubIssue, PRDetails, PRReviewComment } from '../types/dataTypes';
import { getDefaultProjectConfig } from '../core/projectConfig';
import { OrchestratorId } from '../core/constants';
import { WorkflowContext, PRReviewWorkflowContext } from '../github/workflowComments';
import { extractBranchNameFromComment } from '../github/workflowCommentsBase';
import { makeRepoContext, type MockRepoContext } from '../phases/__tests__/helpers/makeRepoContext';

vi.mock('fs');

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    log: vi.fn(),
    ensureLogsDirectory: vi.fn().mockReturnValue('/mock/logs'),
    generateAdwId: vi.fn().mockReturnValue('test-issue-abc123'),
    commitPrefixMap: {
      '/feature': 'feat:',
      '/bug': 'fix:',
      '/chore': 'chore:',
      '/pr_review': 'review:',
    },
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
  fetchGitHubIssue: vi.fn().mockResolvedValue({
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
  }),
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
  pushBranch: vi.fn(),
  createPullRequest: vi.fn().mockReturnValue('https://github.com/test/pr/1'),
  detectRecoveryState: vi.fn().mockReturnValue({
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
  }),
  getDefaultBranch: vi.fn().mockReturnValue('main'),
  checkoutDefaultBranch: vi.fn().mockReturnValue('main'),
  ensureWorktree: vi.fn().mockReturnValue('/mock/worktree'),
  getWorktreeForBranch: vi.fn().mockReturnValue(null),
  mergeLatestFromDefaultBranch: vi.fn(),
  copyEnvToWorktree: vi.fn(),
  findWorktreeForIssue: vi.fn().mockReturnValue(null),
  inferIssueTypeFromBranch: vi.fn().mockReturnValue('/feature'),
  getRepoInfo: vi.fn().mockReturnValue({ owner: 'test', repo: 'repo' }),
  moveIssueToStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agents', () => ({
  runPlanAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Plan created',
    totalCostUsd: 0.5,
  }),
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-1-adw-test123-sdlc_planner-test.md'),
  planFileExists: vi.fn().mockReturnValue(false),
  readPlanFile: vi.fn().mockReturnValue(null),
  correctPlanFileNaming: vi.fn().mockReturnValue(null),
  runBuildAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Build completed',
    totalCostUsd: 1.0,
  }),
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
  runGenerateBranchNameAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'feature/issue-1-test',
    branchName: 'feature/issue-1-test',
  }),
  runCommitAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'plan-orchestrator: feat: add implementation plan',
    commitMessage: 'plan-orchestrator: feat: add implementation plan',
  }),
  runUnitTestsWithRetry: vi.fn(),
  runE2ETestsWithRetry: vi.fn(),
  runReviewWithRetry: vi.fn(),
  runPullRequestAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'https://github.com/test/pr/1',
    prUrl: 'https://github.com/test/pr/1',
    totalCostUsd: 0.1,
    modelUsage: {},
  }),
}));

vi.mock('../core/issueClassifier', () => ({
  classifyGitHubIssue: vi.fn().mockResolvedValue({
    issueType: '/feature',
    success: true,
  }),
}));

// Mock createRepoContext — returns the shared mockRepoContext so init tests can assert on it
vi.mock('../providers/repoContext', () => ({
  createRepoContext: vi.fn(),
  loadProviderConfig: vi.fn(),
}));
import { createRepoContext } from '../providers/repoContext';

// Import mocked modules for assertions
import { shouldExecuteStage, hasUncommittedChanges, getNextStage, AgentStateManager, generateAdwId, writeIssueCostCsv, rebuildProjectCostCsv } from '../core';
import {
  fetchPRDetails,
  getUnaddressedComments,
  pushBranch,
  detectRecoveryState,
  checkoutDefaultBranch,
  ensureWorktree,
  getWorktreeForBranch,
  mergeLatestFromDefaultBranch,
  copyEnvToWorktree,
  findWorktreeForIssue,
  inferIssueTypeFromBranch,
} from '../github';
import { runPlanAgent, planFileExists, readPlanFile, runBuildAgent, runPrReviewPlanAgent, runPrReviewBuildAgent, runGenerateBranchNameAgent, runCommitAgent, runUnitTestsWithRetry, runE2ETestsWithRetry, runReviewWithRetry, runPullRequestAgent } from '../agents';
import { classifyGitHubIssue } from '../core/issueClassifier';

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

// Shared mock repoContext for config helpers — reset in beforeEach
let mockRepoContext: MockRepoContext;

beforeEach(() => {
  mockRepoContext = makeRepoContext();
  // Make createRepoContext return the shared mock so initializeWorkflow/initializePRReviewWorkflow
  // produce configs with a repoContext that tests can assert against
  vi.mocked(createRepoContext).mockReturnValue(mockRepoContext);
});

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
    applicationUrl: 'http://localhost:12345',
    projectConfig: getDefaultProjectConfig(),
    repoContext: mockRepoContext,
    ...overrides,
  };
}

describe('initializeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses branch name agent, checkoutDefaultBranch, and ensureWorktree with baseBranch when no cwd provided', async () => {
    vi.mocked(getWorktreeForBranch).mockReturnValue(null);
    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(runGenerateBranchNameAgent).toHaveBeenCalled();
    expect(checkoutDefaultBranch).toHaveBeenCalled();
    expect(ensureWorktree).toHaveBeenCalledWith('feature/issue-1-test', 'main');
    expect(config.worktreePath).toBe('/mock/worktree');
    expect(config.branchName).toBe('feature/issue-1-test');
  });

  it('reuses existing worktree and merges latest when worktree already exists', async () => {
    vi.mocked(getWorktreeForBranch).mockReturnValue('/existing/worktree');
    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(runGenerateBranchNameAgent).toHaveBeenCalled();
    expect(getWorktreeForBranch).toHaveBeenCalledWith('feature/issue-1-test');
    expect(mergeLatestFromDefaultBranch).toHaveBeenCalledWith('main', '/existing/worktree');
    expect(copyEnvToWorktree).toHaveBeenCalledWith('/existing/worktree');
    expect(checkoutDefaultBranch).not.toHaveBeenCalled();
    expect(ensureWorktree).not.toHaveBeenCalled();
    expect(config.worktreePath).toBe('/existing/worktree');
  });

  it('uses provided cwd directly and merges latest changes', async () => {
    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan, {
      cwd: '/provided/path',
    });

    expect(mergeLatestFromDefaultBranch).toHaveBeenCalledWith('main', '/provided/path');
    expect(config.worktreePath).toBe('/provided/path');
    expect(ensureWorktree).not.toHaveBeenCalled();
  });

  it('skips classification when issueType is provided', async () => {
    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan, {
      issueType: '/bug',
    });

    expect(classifyGitHubIssue).not.toHaveBeenCalled();
    expect(config.issueType).toBe('/bug');
  });

  it('posts starting comment on fresh run', async () => {
    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(config.repoContext!.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('restores context and posts resuming comment in recovery mode', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState({
      canResume: true,
      lastCompletedStage: 'classified',
      branchName: 'feature/recovered',
      planPath: '/recovered/plan.md',
      prUrl: 'https://github.com/test/pr/1',
    }));

    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(config.ctx.branchName).toBe('feature/recovered');
    expect(config.ctx.planPath).toBe('/recovered/plan.md');
    expect(config.ctx.prUrl).toBe('https://github.com/test/pr/1');
    expect(getNextStage).toHaveBeenCalledWith('classified');
    expect(config.repoContext!.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('checks for uncommitted changes during recovery', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState({
      canResume: true,
      lastCompletedStage: 'classified',
    }));

    await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(hasUncommittedChanges).toHaveBeenCalled();
  });

  it('generates ADW ID from issue title when adwId is null', async () => {
    const config = await initializeWorkflow(1, null, OrchestratorId.Plan);

    expect(detectRecoveryState).toHaveBeenCalled();
    expect(generateAdwId).toHaveBeenCalledWith('Test issue');
    expect(config.adwId).toBe('test-issue-abc123');

    // Verify detectRecoveryState was called before generateAdwId
    const recoveryCallOrder = vi.mocked(detectRecoveryState).mock.invocationCallOrder[0];
    const generateCallOrder = vi.mocked(generateAdwId).mock.invocationCallOrder[0];
    expect(recoveryCallOrder).toBeLessThan(generateCallOrder);
  });

  it('reuses recovered ADW ID and branch name when recovery state has them', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState({
      canResume: true,
      lastCompletedStage: 'branch_created',
      adwId: 'adw-recovered-id',
      branchName: 'bug-issue-1-adw-recovered-id-fix-login',
    }));
    vi.mocked(getWorktreeForBranch).mockReturnValue('/existing/worktree');

    const config = await initializeWorkflow(1, null, OrchestratorId.Plan);

    expect(generateAdwId).not.toHaveBeenCalled();
    expect(runGenerateBranchNameAgent).not.toHaveBeenCalled();
    expect(config.adwId).toBe('adw-recovered-id');
    expect(config.branchName).toBe('bug-issue-1-adw-recovered-id-fix-login');
  });

  it('generates new ADW ID and branch when no recovery state exists', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState());
    vi.mocked(getWorktreeForBranch).mockReturnValue(null);

    const config = await initializeWorkflow(1, null, OrchestratorId.Plan);

    expect(generateAdwId).toHaveBeenCalledWith('Test issue');
    expect(runGenerateBranchNameAgent).toHaveBeenCalled();
    expect(config.adwId).toBe('test-issue-abc123');
    expect(config.branchName).toBe('feature/issue-1-test');
  });

  it('uses recovered branch name but generates new ADW ID when only branch is recovered', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState({
      canResume: true,
      lastCompletedStage: 'branch_created',
      branchName: 'bug-issue-1-adw-old-id-fix-login',
    }));
    vi.mocked(getWorktreeForBranch).mockReturnValue('/existing/worktree');

    const config = await initializeWorkflow(1, null, OrchestratorId.Plan);

    expect(generateAdwId).toHaveBeenCalledWith('Test issue');
    expect(runGenerateBranchNameAgent).not.toHaveBeenCalled();
    expect(config.branchName).toBe('bug-issue-1-adw-old-id-fix-login');
  });

  it('reuses existing worktree found by issue pattern and skips branch name generation', async () => {
    vi.mocked(findWorktreeForIssue).mockReturnValue({
      worktreePath: '/existing/issue-worktree',
      branchName: 'feature/issue-1-original-name',
    });

    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(runGenerateBranchNameAgent).not.toHaveBeenCalled();
    expect(getWorktreeForBranch).not.toHaveBeenCalled();
    expect(ensureWorktree).not.toHaveBeenCalled();
    expect(checkoutDefaultBranch).not.toHaveBeenCalled();
    expect(mergeLatestFromDefaultBranch).toHaveBeenCalledWith('main', '/existing/issue-worktree');
    expect(copyEnvToWorktree).toHaveBeenCalledWith('/existing/issue-worktree');
    expect(config.worktreePath).toBe('/existing/issue-worktree');
    expect(config.branchName).toBe('feature/issue-1-original-name');
  });

  it('falls back to branch name generation when findWorktreeForIssue returns null', async () => {
    vi.mocked(detectRecoveryState).mockReturnValue(createRecoveryState());
    vi.mocked(findWorktreeForIssue).mockReturnValue(null);
    vi.mocked(getWorktreeForBranch).mockReturnValue(null);

    const config = await initializeWorkflow(1, 'test-id', OrchestratorId.Plan);

    expect(findWorktreeForIssue).toHaveBeenCalledWith('/feature', 1);
    expect(runGenerateBranchNameAgent).toHaveBeenCalled();
    expect(ensureWorktree).toHaveBeenCalled();
    expect(config.branchName).toBe('feature/issue-1-test');
  });
});

describe('executePlanPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(planFileExists).mockReturnValue(false);
  });

  it('executes all plan stages and returns cost', async () => {
    const config = createWorkflowConfig();

    const result = await executePlanPhase(config);

    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalled();
    expect(mockRepoContext.issueTracker.moveToStatus).toHaveBeenCalledWith(1, 'In Progress');
    expect(runPlanAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '/feature',
      expect.anything(),
      '/mock/worktree',
      'test-adw-id',
    );
    expect(result.costUsd).toBe(0.5);
  });

  it('skips stages when already completed in recovery', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(false);
    const config = createWorkflowConfig({
      recoveryState: createRecoveryState({
        canResume: true,
        lastCompletedStage: 'plan_committing',
      }),
    });

    const result = await executePlanPhase(config);

    expect(runPlanAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('passes worktreePath to planFileExists', async () => {
    const config = createWorkflowConfig();

    await executePlanPhase(config);

    expect(planFileExists).toHaveBeenCalledWith(1, '/mock/worktree');
  });

  it('sets planOutput from plan file content when file is readable', async () => {
    vi.mocked(readPlanFile).mockReturnValue('# Plan\n\n## Description\nDetailed plan content');
    const config = createWorkflowConfig();

    await executePlanPhase(config);

    expect(readPlanFile).toHaveBeenCalledWith(1, '/mock/worktree');
    expect(config.ctx.planOutput).toBe('# Plan\n\n## Description\nDetailed plan content');
  });

  it('falls back to agent output when plan file cannot be read', async () => {
    vi.mocked(readPlanFile).mockReturnValue(null);
    const config = createWorkflowConfig();

    await executePlanPhase(config);

    expect(readPlanFile).toHaveBeenCalledWith(1, '/mock/worktree');
    expect(config.ctx.planOutput).toBe('Plan created');
  });

  it('throws when plan agent fails', async () => {
    vi.mocked(runPlanAgent).mockResolvedValue({
      success: false,
      output: 'Agent error',
      totalCostUsd: 0,
    });
    const config = createWorkflowConfig();

    await expect(executePlanPhase(config)).rejects.toThrow('Plan Agent failed');
  });
});

describe('executeBuildPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan content');
  });

  it('reads plan content and runs build agent', async () => {
    const config = createWorkflowConfig();

    const result = await executeBuildPhase(config);

    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join('/mock/worktree', 'specs/issue-1-adw-test123-sdlc_planner-test.md'),
      'utf-8'
    );
    expect(runBuildAgent).toHaveBeenCalled();
    expect(result.costUsd).toBe(1.0);
  });

  it('throws when plan file is missing', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    const config = createWorkflowConfig();

    await expect(executeBuildPhase(config)).rejects.toThrow('Cannot read plan file');
  });

  it('passes worktreePath as cwd to runBuildAgent', async () => {
    const config = createWorkflowConfig({ worktreePath: '/custom/worktree' });

    await executeBuildPhase(config);

    expect(runBuildAgent).toHaveBeenCalledWith(
      config.issue,
      '/mock/logs',
      '# Plan content',
      expect.any(Function),
      '/mock/state/path',
      '/custom/worktree'
    );
  });

  it('throws when build agent fails', async () => {
    vi.mocked(runBuildAgent).mockResolvedValue({
      success: false,
      output: 'Build error',
      totalCostUsd: 0,
    });
    const config = createWorkflowConfig();

    await expect(executeBuildPhase(config)).rejects.toThrow('Build Agent failed');
  });

  it('handles token limit recovery and continues with a new agent', async () => {
    vi.mocked(runBuildAgent)
      .mockResolvedValueOnce({
        success: true,
        output: 'Partial work done',
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
      })
      .mockResolvedValueOnce({
        success: true,
        output: 'Build completed',
        totalCostUsd: 0.3,
        modelUsage: {},
      });
    const config = createWorkflowConfig();

    const result = await executeBuildPhase(config);

    expect(runBuildAgent).toHaveBeenCalledTimes(2);
    expect(result.costUsd).toBeCloseTo(0.8);
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalled();
  });
});

describe('executeTestPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes worktreePath as cwd to runUnitTestsWithRetry', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    const config = createWorkflowConfig({ worktreePath: '/custom/worktree' });

    await executeTestPhase(config);

    expect(runUnitTestsWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/custom/worktree',
    }));
  });

  it('passes worktreePath as cwd to runE2ETestsWithRetry', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    const config = createWorkflowConfig({ worktreePath: '/custom/worktree' });

    await executeTestPhase(config);

    expect(runE2ETestsWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/custom/worktree',
    }));
  });

  it('returns test results and accumulated cost', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 1, costUsd: 0.5, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 2, costUsd: 0.3, modelUsage: {} });
    const config = createWorkflowConfig();

    const result = await executeTestPhase(config);

    expect(result.unitTestsPassed).toBe(true);
    expect(result.e2eTestsPassed).toBe(true);
    expect(result.costUsd).toBeCloseTo(0.8);
    expect(result.totalRetries).toBe(3);
  });
});

describe('executePRPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates PR when stage should execute', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    const config = createWorkflowConfig();

    const result = await executePRPhase(config);

    expect(runPullRequestAgent).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      config.adwId,
      config.logsDir,
      undefined,
      config.worktreePath,
      config.issue.body,
    );
    expect(config.ctx.prUrl).toBe('https://github.com/test/pr/1');
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalled();
    expect(result.costUsd).toBeCloseTo(0.1);
  });

  it('skips PR when already completed', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(false);
    const config = createWorkflowConfig();

    const result = await executePRPhase(config);

    expect(runPullRequestAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('commits uncommitted changes before creating PR', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(hasUncommittedChanges).mockReturnValue(true);
    const config = createWorkflowConfig();

    await executePRPhase(config);

    expect(hasUncommittedChanges).toHaveBeenCalledWith('/mock/worktree');
    expect(runCommitAgent).toHaveBeenCalledWith(
      'pre-pr-commit',
      '/feature',
      JSON.stringify(config.issue),
      '/mock/logs',
      undefined,
      '/mock/worktree',
      config.issue.body,
    );

    // Verify commit happens before PR creation
    const commitOrder = vi.mocked(runCommitAgent).mock.invocationCallOrder[0];
    const prOrder = vi.mocked(runPullRequestAgent).mock.invocationCallOrder[0];
    expect(commitOrder).toBeLessThan(prOrder);
  });

  it('skips commit when no uncommitted changes', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
    vi.mocked(hasUncommittedChanges).mockReturnValue(false);
    const config = createWorkflowConfig();

    await executePRPhase(config);

    expect(hasUncommittedChanges).toHaveBeenCalledWith('/mock/worktree');
    expect(runCommitAgent).not.toHaveBeenCalled();
    expect(runPullRequestAgent).toHaveBeenCalled();
  });

  it('commits before PR even when PR stage is skipped', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(false);
    vi.mocked(hasUncommittedChanges).mockReturnValue(true);
    const config = createWorkflowConfig();

    await executePRPhase(config);

    expect(runCommitAgent).toHaveBeenCalledWith(
      'pre-pr-commit',
      '/feature',
      JSON.stringify(config.issue),
      '/mock/logs',
      undefined,
      '/mock/worktree',
      config.issue.body,
    );
    expect(runPullRequestAgent).not.toHaveBeenCalled();
  });
});

describe('completeWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes completion state with metadata and posts completed comment', async () => {
    const config = createWorkflowConfig();

    await completeWorkflow(config, 1.5);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      execution: expect.objectContaining({ status: 'completed' }),
      metadata: { totalCostUsd: 1.5 },
    });
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/path',
      'Workflow completed successfully'
    );
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('includes additional metadata when provided', async () => {
    const config = createWorkflowConfig();

    await completeWorkflow(config, 2.0, { unitTestsPassed: true });

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      execution: expect.objectContaining({ status: 'completed' }),
      metadata: { totalCostUsd: 2.0, unitTestsPassed: true },
    });
  });

  it('moves issue to Review status after posting completion comment', async () => {
    const config = createWorkflowConfig();

    await completeWorkflow(config, 1.5);

    expect(mockRepoContext.issueTracker.moveToStatus).toHaveBeenCalledWith(1, 'Review');
  });

  it('writes cost CSVs to worktree path when no targetRepo (ADW repo issue)', async () => {
    const config = createWorkflowConfig({ worktreePath: '/mock/worktree' });
    const mockModelUsage = { 'claude-sonnet-4-20250514': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 } };

    await completeWorkflow(config, 1.5, undefined, mockModelUsage);

    expect(writeIssueCostCsv).toHaveBeenCalledWith(
      '/mock/worktree',
      expect.any(String),
      config.issueNumber,
      config.issue.title,
      expect.any(Object),
    );
    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(
      '/mock/worktree',
      expect.any(String),
      expect.any(Number),
    );
  });

  it('writes cost CSVs to process.cwd() when targetRepo is set (external repo)', async () => {
    const config = createWorkflowConfig({
      worktreePath: '/mock/external-worktree',
      targetRepo: { owner: 'other', repo: 'app', cloneUrl: 'https://github.com/other/app.git' },
    });
    const mockModelUsage = { 'claude-sonnet-4-20250514': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 2.0 } };

    await completeWorkflow(config, 2.0, undefined, mockModelUsage);

    expect(writeIssueCostCsv).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(String),
      config.issueNumber,
      config.issue.title,
      expect.any(Object),
    );
    expect(rebuildProjectCostCsv).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(String),
      expect.any(Number),
    );
  });
});

describe('handleWorkflowError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts error comment, updates failure state, and exits with code 1', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const config = createWorkflowConfig();

    handleWorkflowError(config, new Error('test error'));

    expect(config.ctx.errorMessage).toBe('Error: test error');
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
    expect(AgentStateManager.writeState).toHaveBeenCalled();
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/path',
      expect.stringContaining('plan-orchestrator workflow failed')
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});

// ============================================================================
// PR Review Workflow Phase Tests
// ============================================================================

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

describe('initializePRReviewWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchPRDetails).mockReturnValue(createMockPRDetails());
    vi.mocked(getUnaddressedComments).mockReturnValue(createMockPRReviewComments());
  });

  it('fetches PR details and returns config', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const config = await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(fetchPRDetails).toHaveBeenCalledWith(42, undefined);
    expect(getUnaddressedComments).toHaveBeenCalledWith(42, undefined);
    expect(config.prNumber).toBe(42);
    expect(config.adwId).toBe('test-adw-id');
    expect(config.prDetails.title).toBe('Test PR');

    mockExit.mockRestore();
  });

  it('exits when PR is closed', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(fetchPRDetails).mockReturnValue(createMockPRDetails({ state: 'CLOSED' }));

    await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
  });

  it('exits when PR is merged', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(fetchPRDetails).mockReturnValue(createMockPRDetails({ state: 'MERGED' }));

    await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
  });

  it('exits when no unaddressed comments', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(getUnaddressedComments).mockReturnValue([]);

    await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(mockExit).toHaveBeenCalledWith(0);

    mockExit.mockRestore();
  });

  it('sets up worktree via ensureWorktree with head branch', async () => {
    const config = await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(ensureWorktree).toHaveBeenCalledWith('feature/issue-10-test');
    expect(config.worktreePath).toBe('/mock/worktree');
  });

  it('initializes orchestrator state with correct metadata', async () => {
    await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(AgentStateManager.initializeState).toHaveBeenCalledWith('test-adw-id', OrchestratorId.PrReview);
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/path',
      expect.objectContaining({
        agentName: OrchestratorId.PrReview,
        metadata: { prNumber: 42, reviewComments: 1 },
      })
    );
  });

  it('posts pr_review_starting comment', async () => {
    const config = await initializePRReviewWorkflow(42, 'test-adw-id');

    expect(config.repoContext!.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('forwards repoInfo to getUnaddressedComments', async () => {
    const repoInfo = { owner: 'ext', repo: 'target' };

    await initializePRReviewWorkflow(42, 'test-adw-id', repoInfo);

    expect(getUnaddressedComments).toHaveBeenCalledWith(42, repoInfo);
  });

  it('generates ADW ID from PR title when adwId is null', async () => {
    const config = await initializePRReviewWorkflow(42, null);

    expect(generateAdwId).toHaveBeenCalledWith('Test PR');
    expect(config.adwId).toBe('test-issue-abc123');
  });
});

describe('executePRReviewPlanPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runPrReviewPlanAgent).mockResolvedValue({
      success: true,
      output: 'PR Review Plan created',
      totalCostUsd: 0.3,
    });
  });

  it('reads existing plan content from file when available', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('# Existing plan');
    const config = createPRReviewWorkflowConfig();

    const result = await executePRReviewPlanPhase(config);

    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.join('/mock/worktree', 'specs/issue-1-adw-test123-sdlc_planner-test.md'),
      'utf-8'
    );
    expect(runPrReviewPlanAgent).toHaveBeenCalledWith(
      config.prDetails,
      config.unaddressedComments,
      '# Existing plan',
      '/mock/logs',
      '/mock/state/path',
      '/mock/worktree',
      config.prDetails.body,
    );
    expect(result.planOutput).toBe('PR Review Plan created');
  });

  it('falls back to PR body when no plan file exists', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewPlanPhase(config);

    expect(runPrReviewPlanAgent).toHaveBeenCalledWith(
      config.prDetails,
      config.unaddressedComments,
      'Test PR body',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      config.prDetails.body,
    );
  });

  it('uses PR body when no issue number', async () => {
    const config = createPRReviewWorkflowConfig({
      issueNumber: 0,
      prDetails: createMockPRDetails({ issueNumber: null }),
    });

    await executePRReviewPlanPhase(config);

    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(runPrReviewPlanAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'Test PR body',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      config.prDetails.body,
    );
  });

  it('throws when plan agent fails', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan');
    vi.mocked(runPrReviewPlanAgent).mockResolvedValue({
      success: false,
      output: 'Agent error',
      totalCostUsd: 0,
    });
    const config = createPRReviewWorkflowConfig();

    await expect(executePRReviewPlanPhase(config)).rejects.toThrow('PR Review Plan Agent failed');
  });

  it('posts planning and planned comments', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('# Plan');
    const config = createPRReviewWorkflowConfig();

    await executePRReviewPlanPhase(config);

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledTimes(2);
  });
});

describe('executePRReviewBuildPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runPrReviewBuildAgent).mockResolvedValue({
      success: true,
      output: 'PR Review Build completed',
      totalCostUsd: 0.8,
    });
  });

  it('calls runPrReviewBuildAgent with plan output', async () => {
    const config = createPRReviewWorkflowConfig();

    await executePRReviewBuildPhase(config, 'Revision plan output');

    expect(runPrReviewBuildAgent).toHaveBeenCalledWith(
      config.prDetails,
      'Revision plan output',
      '/mock/logs',
      expect.any(Function),
      '/mock/state/path',
      '/mock/worktree',
      config.prDetails.body,
    );
  });

  it('throws when build agent fails', async () => {
    vi.mocked(runPrReviewBuildAgent).mockResolvedValue({
      success: false,
      output: 'Build error',
      totalCostUsd: 0,
    });
    const config = createPRReviewWorkflowConfig();

    await expect(executePRReviewBuildPhase(config, 'plan')).rejects.toThrow('PR Review Build Agent failed');
  });

  it('posts implementing and implemented comments', async () => {
    const config = createPRReviewWorkflowConfig();

    await executePRReviewBuildPhase(config, 'plan');

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledTimes(2);
  });
});

describe('executePRReviewTestPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls both unit and E2E test retry functions', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewTestPhase(config);

    expect(runUnitTestsWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      logsDir: '/mock/logs',
      cwd: '/mock/worktree',
    }));
    expect(runE2ETestsWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      logsDir: '/mock/logs',
      cwd: '/mock/worktree',
    }));
  });

  it('posts test_passed comment on success', async () => {
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewTestPhase(config);

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('posts onTestFailed callback with correct PR comment', async () => {
    let capturedCallback: ((attempt: number, maxAttempts: number) => void) | undefined;
    vi.mocked(runUnitTestsWithRetry).mockImplementation(async (opts) => {
      capturedCallback = opts.onTestFailed;
      return { passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} };
    });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewTestPhase(config);
    capturedCallback?.(2, 5);

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('exits with code 1 on unit test max retry failure', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: false, failedTests: ['test1.ts'], totalRetries: 5, costUsd: 0, modelUsage: {} });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewTestPhase(config);

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it('exits with code 1 on E2E test max retry failure', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.mocked(runUnitTestsWithRetry).mockResolvedValue({ passed: true, failedTests: [], totalRetries: 0, costUsd: 0, modelUsage: {} });
    vi.mocked(runE2ETestsWithRetry).mockResolvedValue({ passed: false, failedTests: ['e2e-test1.ts'], totalRetries: 5, costUsd: 0, modelUsage: {} });
    const config = createPRReviewWorkflowConfig();

    await executePRReviewTestPhase(config);

    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});

describe('completePRReviewWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runCommitAgent with inferred issue type', async () => {
    vi.mocked(inferIssueTypeFromBranch).mockReturnValue('/feature');
    const config = createPRReviewWorkflowConfig();

    await completePRReviewWorkflow(config);

    expect(inferIssueTypeFromBranch).toHaveBeenCalledWith('feature/issue-10-test');
    expect(runCommitAgent).toHaveBeenCalledWith(
      OrchestratorId.PrReview,
      '/feature',
      expect.any(String),
      '/mock/logs',
      undefined,
      '/mock/worktree',
      config.prDetails.body,
    );
  });

  it('pushes branch and posts completion comments', async () => {
    const config = createPRReviewWorkflowConfig();

    await completePRReviewWorkflow(config);

    expect(pushBranch).toHaveBeenCalledWith('feature/issue-10-test', '/mock/worktree');
    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
  });

  it('writes successful execution state', async () => {
    const config = createPRReviewWorkflowConfig();

    await completePRReviewWorkflow(config);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith('/mock/state/path', {
      execution: expect.objectContaining({ status: 'completed' }),
    });
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/path',
      'PR Review workflow completed successfully'
    );
  });

  it('moves issue back to Review status after completion', async () => {
    const config = createPRReviewWorkflowConfig();

    await completePRReviewWorkflow(config);

    expect(mockRepoContext.issueTracker.moveToStatus).toHaveBeenCalledWith(10, 'Review');
  });
});

describe('handlePRReviewWorkflowError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts error comment and exits with code 1', () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const config = createPRReviewWorkflowConfig();

    handlePRReviewWorkflowError(config, new Error('test error'));

    expect(config.ctx.errorMessage).toBe('Error: test error');
    expect(mockRepoContext.codeHost.commentOnMergeRequest).toHaveBeenCalledWith(42, expect.any(String));
    expect(AgentStateManager.writeState).toHaveBeenCalled();
    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/path',
      expect.stringContaining('PR Review workflow failed')
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});

// ============================================================================
// extractBranchNameFromComment Tests
// ============================================================================

describe('extractBranchNameFromComment', () => {
  it('extracts feat-prefixed branch name from comment body', () => {
    const comment = 'Branch: `feat-issue-123-adw-abc123-add-user-auth`';
    expect(extractBranchNameFromComment(comment)).toBe('feat-issue-123-adw-abc123-add-user-auth');
  });

  it('extracts bug-prefixed branch name from comment body', () => {
    const comment = 'Branch: `bug-issue-456-adw-xyz789-fix-login-error`';
    expect(extractBranchNameFromComment(comment)).toBe('bug-issue-456-adw-xyz789-fix-login-error');
  });

  it('extracts chore-prefixed branch name from comment body', () => {
    const comment = 'Branch: `chore-issue-789-adw-def456-update-deps`';
    expect(extractBranchNameFromComment(comment)).toBe('chore-issue-789-adw-def456-update-deps');
  });

  it('extracts test-prefixed branch name from comment body', () => {
    const comment = 'Branch: `test-issue-323-adw-ghi789-fix-failing-tests`';
    expect(extractBranchNameFromComment(comment)).toBe('test-issue-323-adw-ghi789-fix-failing-tests');
  });

  it('extracts review-prefixed branch name from comment body', () => {
    const comment = 'Branch: `review-issue-100-adw-jkl012-address-comments`';
    expect(extractBranchNameFromComment(comment)).toBe('review-issue-100-adw-jkl012-address-comments');
  });

  it('returns null for non-matching patterns', () => {
    expect(extractBranchNameFromComment('No branch here')).toBeNull();
    expect(extractBranchNameFromComment('`feature/issue-123-old-format`')).toBeNull();
    expect(extractBranchNameFromComment('`bugfix/issue-456-old-format`')).toBeNull();
  });
});

// ============================================================================
// executeReviewPhase Tests
// ============================================================================

describe('executeReviewPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls runReviewWithRetry with correct config', async () => {
    vi.mocked(runReviewWithRetry).mockResolvedValue({
      passed: true,
      costUsd: 1.5,
      totalRetries: 0,
      blockerIssues: [],
      modelUsage: {},
      allScreenshots: [],
      allSummaries: [],
    });
    const config = createWorkflowConfig();

    const result = await executeReviewPhase(config);

    expect(runReviewWithRetry).toHaveBeenCalledWith(expect.objectContaining({
      adwId: 'test-adw-id',
      specFile: 'specs/issue-1-adw-test123-sdlc_planner-test.md',
      logsDir: '/mock/logs',
      maxRetries: expect.any(Number),
      branchName: 'feature/issue-1-test',
      issueType: '/feature',
      cwd: '/mock/worktree',
    }));
    expect(result.reviewPassed).toBe(true);
    expect(result.costUsd).toBe(1.5);
  });

  it('posts review_running with attempt info and review_passed with summary on success', async () => {
    vi.mocked(runReviewWithRetry).mockResolvedValue({
      passed: true,
      costUsd: 1.0,
      totalRetries: 0,
      blockerIssues: [],
      modelUsage: {},
      reviewSummary: 'All good',
      allScreenshots: [],
      allSummaries: [],
    });
    const config = createWorkflowConfig();

    await executeReviewPhase(config);

    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
    // Should have been called at least twice: review_running and review_passed
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalledTimes(2);
  });

  it('posts review_failed comment with blocker issues when review fails', async () => {
    const blockerIssues = [{
      reviewIssueNumber: 1,
      screenshotPath: '/img/issue.png',
      issueDescription: 'Button broken',
      issueResolution: 'Fix button',
      issueSeverity: 'blocker' as const,
    }];
    vi.mocked(runReviewWithRetry).mockResolvedValue({
      passed: false,
      costUsd: 3.0,
      totalRetries: 3,
      blockerIssues,
      modelUsage: {},
      allScreenshots: [],
      allSummaries: [],
    });
    const config = createWorkflowConfig();

    const result = await executeReviewPhase(config);

    expect(result.reviewPassed).toBe(false);
    expect(mockRepoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(1, expect.any(String));
  });

  it('returns cost and pass/fail status', async () => {
    vi.mocked(runReviewWithRetry).mockResolvedValue({
      passed: true,
      costUsd: 2.5,
      totalRetries: 1,
      blockerIssues: [],
      modelUsage: {},
      allScreenshots: [],
      allSummaries: [],
    });
    const config = createWorkflowConfig();

    const result = await executeReviewPhase(config);

    expect(result.costUsd).toBe(2.5);
    expect(result.reviewPassed).toBe(true);
    expect(result.totalRetries).toBe(1);
  });
});
