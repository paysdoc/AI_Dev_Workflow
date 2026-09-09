/**
 * Regression test for criterion 3 (issue #524): two initializeWorkflow calls with the same
 * adwId/issueNumber/issueType and a branch-name agent that would return divergent slugs MUST
 * result in exactly one branch being created and the agent being invoked exactly once.
 *
 * This file is the canonical home for the slug-mismatch-determinism contract at the
 * initializeWorkflow level.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy external dependencies before any imports that might trigger them
// ---------------------------------------------------------------------------

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('abc1234'),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    accessSync: vi.fn(), // pre-flight: Claude CLI check — don't throw
  };
});

const mockGitCtx = vi.hoisted(() => ({
  defaultBranch: vi.fn().mockReturnValue('main'),
  mergeLatestFromDefaultBranch: vi.fn(),
  fetchAndResetToRemote: vi.fn(),
  ensureWorktree: vi.fn().mockReturnValue('/tmp/fake-worktree'),
  getWorktreeForBranch: vi.fn().mockReturnValue(null),
  copyEnvToWorktree: vi.fn(),
  findWorktreeForIssue: vi.fn().mockReturnValue(null),
  headShort: vi.fn().mockReturnValue('abc1234'),
  show: vi.fn(),
}));

vi.mock('../../core/issueRecord', () => ({
  fetchIssueRecord: vi.fn(),
}));

vi.mock('../../core/workflowCommentParsing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/workflowCommentParsing')>()),
  detectRecoveryState: vi.fn(),
}));

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForSync: vi.fn().mockReturnValue(mockGitCtx),
}));

vi.mock('../../core/githubAppAuth', () => ({
  isGitHubAppConfigured: vi.fn().mockReturnValue(false),
  getInstallationToken: vi.fn(),
}));

vi.mock('../../core/environment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/environment')>();
  return {
    ...actual,
    GITHUB_PAT: undefined, // not set in test environment
  };
});

vi.mock('../../vcs', () => ({}));

vi.mock('../branchIdentityFallback', () => ({
  findExistingBranchForIssue: vi.fn().mockReturnValue(null),
  recoverAdwIdForBranch: vi.fn().mockReturnValue(null),
  defaultDeps: { listCandidateBranches: vi.fn().mockReturnValue([]), listAdwIds: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../providers/repoContext', () => ({
  createRepoContext: vi.fn().mockReturnValue(undefined),
}));

// Real implementation by default (preserves existing tests' behaviour exactly);
// individual tests override via mockReturnValueOnce/mockImplementationOnce to
// assert the boundary-providers passthrough deterministically (#794).
vi.mock('../../core/launchGitContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/launchGitContext')>();
  return {
    ...actual,
    buildLaunchBoundary: vi.fn(actual.buildLaunchBoundary),
  };
});

vi.mock('../../core/issueClassifier', () => ({
  classifyGitHubIssue: vi.fn(),
}));

vi.mock('../../core/orchestratorLib', () => ({
  deriveOrchestratorScript: vi.fn().mockReturnValue('adwSdlc.tsx'),
}));

vi.mock('../worktreeSetup', () => ({
  copyClaudeAssetsToWorktree: vi.fn(),
  ensureGitignoreEntry: vi.fn(),
  ensureGitignoreEntries: vi.fn(),
}));

vi.mock('../phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

vi.mock('../upgradeGate', () => ({
  runUpgradeGate: vi.fn().mockResolvedValue({ action: 'proceed' }),
  buildDefaultUpgradeGateDeps: vi.fn(),
}));

vi.mock('../../core/portAllocator', () => ({
  allocateRandomPort: vi.fn().mockResolvedValue(3000),
  isPortAvailable: vi.fn().mockResolvedValue(true),
}));

// Mock agents — runGenerateBranchNameAgent is the key mock for criterion 3.
vi.mock('../../agents', () => ({
  runGenerateBranchNameAgent: vi.fn(),
  // Satisfy any other exports that workflowInit or its transitive deps reference
  runCommitAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------

import { initializeWorkflow } from '../workflowInit';
import { AgentStateManager } from '../../core/agentState';
import { AGENTS_STATE_DIR } from '../../core/config';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { runGenerateBranchNameAgent } from '../../agents';
import { fetchIssueRecord } from '../../core/issueRecord';
import { detectRecoveryState } from '../../core/workflowCommentParsing';
import { classifyGitHubIssue } from '../../core/issueClassifier';
import { createRepoContext } from '../../providers/repoContext';
import { buildLaunchBoundary } from '../../core/launchGitContext';
import type { LaunchBoundary } from '../../core/launchGitContext';
import { Platform } from '../../providers/types';

const mockAgent = vi.mocked(runGenerateBranchNameAgent);
const mockFetchIssue = vi.mocked(fetchIssueRecord);
const mockDetectRecovery = vi.mocked(detectRecoveryState);
const mockClassify = vi.mocked(classifyGitHubIssue);
const mockCreateRepoContext = vi.mocked(createRepoContext);
const mockBuildLaunchBoundary = vi.mocked(buildLaunchBoundary);

function makeFakeBoundary(owner: string, repo: string): LaunchBoundary {
  const repoId = { owner, repo, platform: Platform.GitHub };
  const providers = {
    issueTracker: {},
    codeHost: { getDefaultBranch: vi.fn().mockReturnValue('main') },
    boardManager: {},
  };
  return {
    gitContext: { owner, repo } as unknown as LaunchBoundary['gitContext'],
    repoId,
    providers,
  } as unknown as LaunchBoundary;
}

const BASE_ADW_ID = `test-wfinit-${Date.now()}`;
const ISSUE_NUMBER = 9000;
const FAKE_WORKTREE_PATH = '/tmp/fake-worktree';

const fakeIssue = {
  number: ISSUE_NUMBER,
  title: 'Test issue',
  body: '',
  state: 'open',
  user: { login: 'test' },
  labels: [],
  comments: [],
  createdAt: '',
  updatedAt: '',
  closedAt: null,
  url: '',
  htmlUrl: '',
};

const baseAgentResult = {
  success: true,
  output: '',
  sessionId: 'test-session',
  totalCostUsd: 0,
  modelUsage: {},
};

const nullRecoveryState = {
  lastCompletedStage: null,
  adwId: null,
  branchName: null,
  planPath: null,
  prUrl: null,
  canResume: false,
};

function cleanupAdwId(adwId: string) {
  const dir = join(AGENTS_STATE_DIR, adwId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

beforeEach(() => {
  // Clear call history for all mocks so counts don't accumulate across tests,
  // and reset mockAgent's once-queue so unconsumed entries from one test don't
  // leak into the next (e.g. test 1 adds branchA+branchB but only consumes branchA).
  vi.clearAllMocks();
  mockAgent.mockReset();
  mockFetchIssue.mockResolvedValue(fakeIssue as never);
  mockDetectRecovery.mockReturnValue(nullRecoveryState);
  mockClassify.mockResolvedValue({ issueType: '/feature', success: true } as never);
  mockGitCtx.getWorktreeForBranch.mockReturnValue(null);
  mockGitCtx.findWorktreeForIssue.mockReturnValue(null);
  mockGitCtx.ensureWorktree.mockReturnValue(FAKE_WORKTREE_PATH);
  mockBuildLaunchBoundary.mockReturnValue(makeFakeBoundary('test-owner', 'test-repo'));
});

// ---------------------------------------------------------------------------
// Criterion 3 regression test
// ---------------------------------------------------------------------------

describe('initializeWorkflow determinism — criterion 3 (issue #524)', () => {
  const adwId = `${BASE_ADW_ID}-c3`;

  afterEach(() => cleanupAdwId(adwId));

  it(
    'calls the branch-name agent exactly once across two initialisations with the same adwId',
    async () => {
      const branchA = 'feature-issue-9000-slug-alpha';
      const branchB = 'feature-issue-9000-slug-beta'; // would be returned on second call
      mockAgent
        .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchA })
        .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchB });

      await initializeWorkflow(ISSUE_NUMBER, adwId, 'orchestrator', { issueType: '/feature' });
      await initializeWorkflow(ISSUE_NUMBER, adwId, 'orchestrator', { issueType: '/feature' });

      // Agent must be invoked at most once — the second call uses the persisted name.
      expect(mockAgent).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'both initialisations return the branch name from the first agent call',
    async () => {
      const adwId2 = `${BASE_ADW_ID}-c3b`;
      afterEach(() => cleanupAdwId(adwId2));
      try {
        const branchA = 'feature-issue-9000-slug-first';
        const branchB = 'feature-issue-9000-slug-second';
        mockAgent
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchA })
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchB });

        const cfg1 = await initializeWorkflow(ISSUE_NUMBER, adwId2, 'orchestrator', { issueType: '/feature' });
        const cfg2 = await initializeWorkflow(ISSUE_NUMBER, adwId2, 'orchestrator', { issueType: '/feature' });

        expect(cfg1.branchName).toBe(branchA);
        expect(cfg2.branchName).toBe(branchA); // second call reuses first
      } finally {
        cleanupAdwId(adwId2);
      }
    },
  );

  it(
    'top-level state records branchName from the first agent call',
    async () => {
      const adwId3 = `${BASE_ADW_ID}-c3c`;
      try {
        const branchA = 'feature-issue-9000-slug-state';
        const branchB = 'feature-issue-9000-slug-state-different';
        mockAgent
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchA })
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchB });

        await initializeWorkflow(ISSUE_NUMBER, adwId3, 'orchestrator', { issueType: '/feature' });
        await initializeWorkflow(ISSUE_NUMBER, adwId3, 'orchestrator', { issueType: '/feature' });

        const state = AgentStateManager.readTopLevelState(adwId3);
        expect(state?.branchName).toBe(branchA);
      } finally {
        cleanupAdwId(adwId3);
      }
    },
  );

  it(
    'ensureWorktree is called at most once — only one worktree is created',
    async () => {
      const adwId4 = `${BASE_ADW_ID}-c3d`;
      try {
        const branchA = 'feature-issue-9000-slug-wt';
        const branchB = 'feature-issue-9000-slug-wt-second';
        mockAgent
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchA })
          .mockResolvedValueOnce({ ...baseAgentResult, branchName: branchB });
        // Second call finds the worktree already existing via getWorktreeForBranch.
        mockGitCtx.getWorktreeForBranch
          .mockReturnValueOnce(null)          // first call: no existing worktree
          .mockReturnValueOnce(FAKE_WORKTREE_PATH); // second call: worktree exists

        await initializeWorkflow(ISSUE_NUMBER, adwId4, 'orchestrator', { issueType: '/feature' });
        await initializeWorkflow(ISSUE_NUMBER, adwId4, 'orchestrator', { issueType: '/feature' });

        // ensureWorktree should only be called once (the second call finds the existing worktree).
        expect(mockGitCtx.ensureWorktree).toHaveBeenCalledTimes(1);
        expect(mockGitCtx.ensureWorktree).toHaveBeenCalledWith(branchA, 'main');
      } finally {
        cleanupAdwId(adwId4);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Boundary-providers passthrough (issue #794, AC3 — workflow-init half)
// ---------------------------------------------------------------------------

describe('initializeWorkflow: boundary-providers passthrough to createRepoContext', () => {
  const adwId = `${BASE_ADW_ID}-boundary`;

  afterEach(() => cleanupAdwId(adwId));

  it('passes the boundary\'s providers when the resolved repoId matches the boundary identity', async () => {
    const boundary = makeFakeBoundary('test-owner', 'test-repo');
    mockBuildLaunchBoundary.mockReturnValueOnce(boundary);
    mockAgent.mockResolvedValueOnce({ ...baseAgentResult, branchName: 'feature-issue-9000-boundary-match' });

    await initializeWorkflow(ISSUE_NUMBER, adwId, 'orchestrator', { issueType: '/feature' });

    expect(mockCreateRepoContext).toHaveBeenCalledTimes(1);
    expect(mockCreateRepoContext.mock.calls[0][0].providers).toBe(boundary.providers);
  });

  it('refuses to mint a second provider set when a caller-supplied repoId names a different repository — repoContext falls back to undefined', async () => {
    const boundary = makeFakeBoundary('test-owner', 'test-repo');
    mockBuildLaunchBoundary.mockReturnValueOnce(boundary);
    mockAgent.mockResolvedValueOnce({ ...baseAgentResult, branchName: 'feature-issue-9000-boundary-mismatch' });

    const cfg = await initializeWorkflow(ISSUE_NUMBER, adwId, 'orchestrator', {
      issueType: '/feature',
      repoId: { owner: 'other-owner', repo: 'other-repo', platform: Platform.GitHub },
    });

    // #796 hardens the wrong-repo invariant: a contradicting caller-supplied identity is
    // refused (resolveWorkflowProviders throws, caught by initializeWorkflow's surrounding
    // try/catch) rather than served a second, ad-hoc-minted provider set — supersedes the
    // #794 expectation that createRepoContext still ran with providers: undefined.
    expect(mockCreateRepoContext).not.toHaveBeenCalled();
    expect(cfg.repoContext).toBeUndefined();
  });
});
