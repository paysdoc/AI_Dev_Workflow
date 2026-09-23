import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
  AgentStateManager: {
    appendLog: vi.fn(),
    initializeState: vi.fn(() => '/tmp/state'),
  },
  emptyModelUsageMap: vi.fn(() => ({})),
  mergeModelUsageMaps: vi.fn((a, b) => ({ ...a, ...b })),
}));

vi.mock('../../cost', () => ({
  createPhaseCostRecords: vi.fn(() => []),
  PhaseCostStatus: { Success: 'success', Failed: 'failed' },
}));

vi.mock('../../agents/planAgent', () => ({
  getPlanFilePath: vi.fn(() => '/tmp/plan.md'),
}));

vi.mock('../../agents/reviewAgent', () => ({
  runReviewAgent: vi.fn(),
}));

vi.mock('../phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

import { executeReviewPhase } from '../reviewPhase';
import { log } from '../../core';
import { runReviewAgent } from '../../agents/reviewAgent';
import type { WorkflowConfig } from '../workflowInit';

const mockLog = vi.mocked(log);
const mockRunReviewAgent = vi.mocked(runReviewAgent);

const defaultReviewAgentResult = {
  success: true,
  output: '',
  sessionId: 's',
  totalCostUsd: 0.01,
  modelUsage: {},
  passed: true,
  blockerIssues: [],
  reviewResult: { success: true, reviewSummary: 'LGTM', reviewIssues: [], screenshots: [] },
};

const failedBlocker = {
  reviewIssueNumber: 1,
  issueDescription: 'Bug in logic',
  issueResolution: 'Fix it',
  issueSeverity: 'blocker' as const,
};

interface MakeConfigOptions {
  labels?: string[];
  canApprove?: boolean;
  canApproveThrows?: boolean;
  fetchLabelsThrows?: boolean;
  approveResult?: { success: boolean; error?: string };
  /** Pass `null` for "no PR url" — `undefined` falls back to the default PR url below. */
  prUrl?: string | null;
}

function makeConfig(opts: MakeConfigOptions = {}) {
  const {
    labels = [],
    canApprove = true,
    canApproveThrows = false,
    fetchLabelsThrows = false,
    approveResult = { success: true },
    prUrl = 'https://github.com/test/repo/pull/7',
  } = opts;

  const fetchLabels = vi.fn(() => {
    if (fetchLabelsThrows) throw new Error('JiraIssueTracker.fetchLabels is not implemented');
    return labels;
  });
  const canApprovePullRequests = vi.fn(() => {
    if (canApproveThrows) throw new Error('CodeHost.canApprovePullRequests is not implemented');
    return canApprove;
  });
  const approvePullRequest = vi.fn(() => approveResult);

  const config = {
    orchestratorStatePath: '/tmp/orch-state',
    issueNumber: 42,
    issue: {
      id: '42',
      number: 42,
      title: 'Test',
      body: '',
      state: 'OPEN',
      author: 'test',
      labels: [],
      comments: [],
      createdAt: '2026-01-01T00:00:00Z',
      url: 'https://github.com/test/repo/issues/42',
    },
    ctx: prUrl ? { prUrl } : {},
    logsDir: '/tmp/logs',
    worktreePath: '/tmp/worktree',
    adwId: 'test-adw',
    repoContext: {
      issueTracker: { fetchLabels },
      codeHost: { canApprovePullRequests, approvePullRequest },
      cwd: '/tmp',
      repoId: { owner: 'test', repo: 'repo', platform: 'github' },
    },
  } as unknown as WorkflowConfig;

  return { config, fetchLabels, canApprovePullRequests, approvePullRequest };
}

function findLogLine(level: string, predicate: (msg: string) => boolean): boolean {
  return mockLog.mock.calls.some(([msg, lvl]) => lvl === level && typeof msg === 'string' && predicate(msg));
}

beforeEach(() => {
  mockLog.mockReset();
  mockRunReviewAgent.mockReset();
  mockRunReviewAgent.mockResolvedValue(defaultReviewAgentResult);
});

describe('executeReviewPhase — hitl approval gate', () => {
  it('Case 1: hitl present → approvePullRequest not called, labels read live, skip logged', async () => {
    const { config, fetchLabels, approvePullRequest } = makeConfig({ labels: ['hitl'] });

    const result = await executeReviewPhase(config, '');

    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(fetchLabels).toHaveBeenCalledWith(42);
    expect(result.reviewPassed).toBe(true);
    expect(findLogLine('info', (msg) => msg.includes('PR #7') && msg.includes('issue #42') && msg.includes('hitl'))).toBe(true);
  });

  it('Case 2: no labels → approvePullRequest called exactly once with 7', async () => {
    const { config, approvePullRequest } = makeConfig({ labels: [] });

    const result = await executeReviewPhase(config, '');

    expect(approvePullRequest).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(7);
    expect(result.reviewPassed).toBe(true);
  });

  it('Case 3: other labels only → approved once (guards .includes semantics, not "any label")', async () => {
    const { config, approvePullRequest } = makeConfig({ labels: ['adw:bug'] });

    await executeReviewPhase(config, '');

    expect(approvePullRequest).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(7);
  });

  it('Case 4: approval failure → non-fatal, review still passed, warn logged', async () => {
    const { config } = makeConfig({ labels: [], approveResult: { success: false, error: 'boom' } });

    const result = await executeReviewPhase(config, '');

    expect(result.reviewPassed).toBe(true);
    expect(findLogLine('warn', (msg) => msg.includes('non-fatal'))).toBe(true);
  });

  it('Case 5: refused capability probe → approvePullRequest and fetchLabels not called, review still passed', async () => {
    const { config, fetchLabels, approvePullRequest } = makeConfig({ canApproveThrows: true });

    const result = await executeReviewPhase(config, '');

    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(fetchLabels).not.toHaveBeenCalled();
    expect(result.reviewPassed).toBe(true);
  });

  it('Case 6: refused label read → approvePullRequest not called, review still passed, warn names the issue', async () => {
    const { config, approvePullRequest } = makeConfig({ fetchLabelsThrows: true });

    const result = await executeReviewPhase(config, '');

    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(result.reviewPassed).toBe(true);
    expect(findLogLine('warn', (msg) => msg.includes('issue #42'))).toBe(true);
  });

  it('Case 7: review failed → neither fetchLabels nor approvePullRequest called', async () => {
    mockRunReviewAgent.mockResolvedValue({ ...defaultReviewAgentResult, passed: false, blockerIssues: [failedBlocker] });
    const { config, fetchLabels, approvePullRequest } = makeConfig({ labels: [] });

    const result = await executeReviewPhase(config, '');

    expect(fetchLabels).not.toHaveBeenCalled();
    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(result.reviewPassed).toBe(false);
  });

  it('Case 8: no PR url → nothing consulted, nothing approved', async () => {
    const { config, fetchLabels, approvePullRequest } = makeConfig({ prUrl: null });

    const result = await executeReviewPhase(config, '');

    expect(fetchLabels).not.toHaveBeenCalled();
    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(result.reviewPassed).toBe(true);
  });
});
