import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    shouldExecuteStage: vi.fn().mockReturnValue(true),
    hasUncommittedChanges: vi.fn().mockReturnValue(false),
    emptyModelUsageMap: actual.emptyModelUsageMap,
  };
});

vi.mock('../../github/workflowCommentsIssue', () => ({
  formatWorkflowComment: vi.fn().mockReturnValue('formatted comment'),
}));

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: 'Committed' }),
  runPullRequestAgent: vi.fn().mockResolvedValue({
    prUrl: 'https://github.com/o/r/pull/1',
    totalCostUsd: 0.3,
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 60, outputTokens: 30, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 } },
  }),
}));

import { shouldExecuteStage } from '../../core';
import { runPullRequestAgent } from '../../agents';
import { executePRPhase } from '../prPhase';
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
    orchestratorName: 'pr-orchestrator',
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

describe('executePRPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
    vi.mocked(shouldExecuteStage).mockReturnValue(true);
  });

  it('creates PR and returns cost', async () => {
    const result = await executePRPhase(makeConfig());

    expect(result.costUsd).toBe(0.3);
    expect(runPullRequestAgent).toHaveBeenCalled();
  });

  it('posts pr_creating and pr_created comments via repoContext', async () => {
    await executePRPhase(makeConfig());

    // pr_creating + pr_created = 2 calls
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledTimes(2);
  });

  it('skips PR creation when stage already completed', async () => {
    vi.mocked(shouldExecuteStage).mockReturnValue(false);

    const result = await executePRPhase(makeConfig());

    expect(runPullRequestAgent).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('sets prUrl on context after PR creation', async () => {
    const config = makeConfig();
    await executePRPhase(config);

    expect(config.ctx.prUrl).toBe('https://github.com/o/r/pull/1');
  });
});
