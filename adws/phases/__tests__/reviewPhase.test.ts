import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../reviewPhase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reviewPhase')>();
  return actual;
});

vi.mock('../../agents/patchAgent', () => ({
  runPatchAgent: vi.fn(),
}));

vi.mock('../../agents/buildAgent', () => ({
  runBuildAgent: vi.fn(),
}));

vi.mock('../../agents/refactorAgent', () => ({
  runRefactorAgent: vi.fn(),
}));

vi.mock('../../agents/gitAgent', () => ({
  runCommitAgent: vi.fn(),
}));

vi.mock('../../vcs', () => ({
  pushBranch: vi.fn(),
}));

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
  PhaseCostStatus: { Success: 'success' },
}));

vi.mock('../../agents/planAgent', () => ({
  getPlanFilePath: vi.fn(() => '/tmp/plan.md'),
}));

import { executeReviewPatchCycle } from '../reviewPhase';
import { runPatchAgent } from '../../agents/patchAgent';
import { runBuildAgent } from '../../agents/buildAgent';
import { runRefactorAgent } from '../../agents/refactorAgent';
import { runCommitAgent } from '../../agents/gitAgent';
import { pushBranch } from '../../vcs';

const mockPatch = vi.mocked(runPatchAgent);
const mockBuild = vi.mocked(runBuildAgent);
const mockRefactor = vi.mocked(runRefactorAgent);
const mockCommit = vi.mocked(runCommitAgent);
const mockPush = vi.mocked(pushBranch);

const okAgentResult = {
  success: true,
  output: 'done',
  sessionId: 'sess',
  totalCostUsd: 0.01,
  modelUsage: {},
};

const baseConfig = {
  orchestratorStatePath: '/tmp/orch-state',
  issueNumber: 42,
  adwId: 'test-adw',
  issue: {
    number: 42,
    title: 'Test',
    body: '',
    state: 'OPEN',
    author: { login: 'test' },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    url: 'https://github.com/test/test/issues/42',
  },
  issueType: '/feature' as const,
  logsDir: '/tmp/logs',
  worktreePath: '/tmp/worktree',
  branchName: 'feature-issue-42-test',
  ctx: {},
  repoContext: undefined,
} as unknown as Parameters<typeof executeReviewPatchCycle>[0];

const patchBlocker = {
  reviewIssueNumber: 1,
  issueDescription: 'Bug in logic',
  issueResolution: 'Fix it',
  issueSeverity: 'blocker' as const,
};

const patchBlockerExplicit = {
  reviewIssueNumber: 2,
  issueDescription: 'Another bug',
  issueResolution: 'Fix it too',
  issueSeverity: 'blocker' as const,
  remediationStrategy: 'patch' as const,
};

const refactorBlocker = {
  reviewIssueNumber: 3,
  issueDescription: 'file.ts: nesting-depth violation',
  issueResolution: 'Run /refactor on the listed files',
  issueSeverity: 'blocker' as const,
  remediationStrategy: 'refactor' as const,
};

beforeEach(() => {
  mockPatch.mockReset();
  mockBuild.mockReset();
  mockRefactor.mockReset();
  mockCommit.mockReset();
  mockPush.mockReset();

  mockPatch.mockResolvedValue(okAgentResult);
  mockBuild.mockResolvedValue(okAgentResult);
  mockRefactor.mockResolvedValue(okAgentResult);
  mockCommit.mockResolvedValue({ ...okAgentResult, commitMessage: 'fix: review patch' });
  mockPush.mockReturnValue(undefined);
});

describe('executeReviewPatchCycle — blocker splitting', () => {
  it('Case 1: only patch blockers → patchAgent called per blocker, refactorAgent NOT called', async () => {
    await executeReviewPatchCycle(baseConfig, [patchBlocker, patchBlockerExplicit]);
    expect(mockPatch).toHaveBeenCalledTimes(2);
    expect(mockRefactor).not.toHaveBeenCalled();
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('Case 2: only one refactor blocker → patchAgent NOT called, refactorAgent called once', async () => {
    await executeReviewPatchCycle(baseConfig, [refactorBlocker]);
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockRefactor).toHaveBeenCalledTimes(1);
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('Case 3: mixed blockers → patchAgents run before refactor, commit+push once', async () => {
    const callOrder: string[] = [];
    mockPatch.mockImplementation(async () => { callOrder.push('patch'); return okAgentResult; });
    mockRefactor.mockImplementation(async () => { callOrder.push('refactor'); return okAgentResult; });
    mockBuild.mockResolvedValue(okAgentResult);

    await executeReviewPatchCycle(baseConfig, [patchBlocker, patchBlockerExplicit, refactorBlocker]);

    expect(mockPatch).toHaveBeenCalledTimes(2);
    expect(mockRefactor).toHaveBeenCalledTimes(1);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);

    const lastPatchIdx = callOrder.lastIndexOf('patch');
    const refactorIdx = callOrder.indexOf('refactor');
    expect(lastPatchIdx).toBeLessThan(refactorIdx);
  });

  it('Case 4: blocker with no remediationStrategy defaults to patch', async () => {
    await executeReviewPatchCycle(baseConfig, [patchBlocker]);
    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockRefactor).not.toHaveBeenCalled();
  });

  it('buildAgent is called once per refactor blocker', async () => {
    await executeReviewPatchCycle(baseConfig, [refactorBlocker]);
    expect(mockBuild).toHaveBeenCalledTimes(1);
  });

  it('commit and push are always called exactly once per cycle', async () => {
    await executeReviewPatchCycle(baseConfig, [patchBlocker, refactorBlocker]);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
