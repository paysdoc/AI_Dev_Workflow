import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    AgentStateManager: {
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state/document-agent'),
      createExecutionState: vi.fn().mockReturnValue({ status: 'running', startedAt: '2025-01-01' }),
      completeExecution: vi.fn().mockReturnValue({ status: 'completed', startedAt: '2025-01-01' }),
    },
    emptyModelUsageMap: actual.emptyModelUsageMap,
  };
});

vi.mock('../../github/workflowCommentsIssue', () => ({
  formatWorkflowComment: vi.fn().mockReturnValue('formatted comment'),
}));

vi.mock('../../agents', () => ({
  getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
  runDocumentAgent: vi.fn().mockResolvedValue({
    success: true,
    output: 'Documentation created at app_docs/feature-login.md',
    totalCostUsd: 0.2,
    docPath: 'app_docs/feature-login.md',
    modelUsage: { 'claude-sonnet-4-20250514': { inputTokens: 40, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.2 } },
  }),
  runCommitAgent: vi.fn().mockResolvedValue({ success: true, output: 'Committed docs' }),
}));

import { AgentStateManager } from '../../core';
import { runDocumentAgent, runCommitAgent } from '../../agents';
import { executeDocumentPhase } from '../documentPhase';
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
    orchestratorName: 'document-orchestrator',
    recoveryState: {
      lastCompletedStage: null, adwId: null, branchName: null,
      planPath: null, prUrl: null, canResume: false,
    } as RecoveryState,
    ctx: { issueNumber: 42, adwId: 'adw-test-abc123' } as WorkflowContext,
    branchName: 'feat-issue-42-test',
    applicationUrl: '',
    projectConfig: { commands: {} } as any,
    repoContext,
    ...overrides,
  };
}

describe('executeDocumentPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoContext = makeRepoContext();
  });

  it('runs document agent and returns cost', async () => {
    const result = await executeDocumentPhase(makeConfig());

    expect(result.costUsd).toBe(0.2);
    expect(runDocumentAgent).toHaveBeenCalledWith(
      'adw-test-abc123',
      '/mock/logs',
      'specs/issue-42-plan.md',
      undefined,
      '/mock/state/document-agent',
      '/mock/worktree',
      'Issue body',
    );
  });

  it('posts document_running and document_completed comments via repoContext', async () => {
    await executeDocumentPhase(makeConfig());

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledTimes(2);
  });

  it('initializes agent state', async () => {
    await executeDocumentPhase(makeConfig());

    expect(AgentStateManager.initializeState).toHaveBeenCalledWith(
      'adw-test-abc123', 'document-agent', '/mock/state/orchestrator',
    );
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/document-agent',
      expect.objectContaining({ agentName: 'document-agent' }),
    );
  });

  it('commits documentation after successful generation', async () => {
    await executeDocumentPhase(makeConfig());

    expect(runCommitAgent).toHaveBeenCalledWith(
      'document-agent', '/feature', expect.any(String),
      '/mock/logs', undefined, '/mock/worktree', 'Issue body',
    );
  });

  it('throws when document agent fails', async () => {
    vi.mocked(runDocumentAgent).mockResolvedValueOnce({
      success: false,
      output: 'Documentation generation failed',
      totalCostUsd: 0.05,
      docPath: '',
    });

    await expect(executeDocumentPhase(makeConfig())).rejects.toThrow('Document Agent failed');
  });

  it('posts document_failed comment on failure via repoContext', async () => {
    vi.mocked(runDocumentAgent).mockResolvedValueOnce({
      success: false,
      output: 'Failed',
      totalCostUsd: 0.05,
      docPath: '',
    });

    await expect(executeDocumentPhase(makeConfig())).rejects.toThrow();

    expect(repoContext.issueTracker.commentOnIssue).toHaveBeenCalledWith(42, 'formatted comment');
  });

  it('writes failure state when agent fails', async () => {
    vi.mocked(runDocumentAgent).mockResolvedValueOnce({
      success: false,
      output: 'Failed',
      totalCostUsd: 0.05,
      docPath: '',
    });

    await expect(executeDocumentPhase(makeConfig())).rejects.toThrow();

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(
      '/mock/state/document-agent',
      expect.objectContaining({
        execution: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('passes screenshots dir when provided', async () => {
    await executeDocumentPhase(makeConfig(), '/mock/screenshots');

    expect(runDocumentAgent).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String),
      '/mock/screenshots',
      expect.any(String), expect.any(String), expect.any(String),
    );
  });

  it('returns model usage data', async () => {
    const result = await executeDocumentPhase(makeConfig());

    expect(result.modelUsage).toBeDefined();
    expect(result.modelUsage['claude-sonnet-4-20250514']).toBeDefined();
  });

  it('logs doc path on success', async () => {
    await executeDocumentPhase(makeConfig());

    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/mock/state/orchestrator',
      expect.stringContaining('Documentation created'),
    );
  });
});
