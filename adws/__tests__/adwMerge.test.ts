import { describe, it, expect, vi } from 'vitest';
import { executeMerge, type MergeDeps, type MergeRunResult } from '../adwMerge';
import type { AgentState } from '../types/agentTypes';
import { mergeWithConflictResolution } from '../triggers/autoMergeHandler';
import { commentOnIssue, commentOnPR } from '../github';
import { getPlanFilePath, planFileExists } from '../agents';

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO_INFO = { owner: 'acme', repo: 'myrepo' };

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'awaiting_merge',
    ...overrides,
  };
}

function makePR(overrides: {
  number?: number;
  state?: string;
  headRefName?: string;
  baseRefName?: string;
} = {}) {
  return {
    number: 7,
    state: 'OPEN',
    headRefName: 'feature-issue-42-abc',
    baseRefName: 'main',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<MergeDeps> = {}): MergeDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(makeState()),
    findOrchestratorStatePath: vi.fn().mockReturnValue('/agents/test-adw-id/sdlc-orchestrator'),
    readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-issue-42-abc' })),
    findPRByBranch: vi.fn().mockReturnValue(makePR()),
    ensureWorktree: vi.fn().mockReturnValue('/worktrees/feature-issue-42-abc'),
    ensureLogsDirectory: vi.fn().mockReturnValue('/logs/test-adw-id'),
    mergeWithConflictResolution: vi.fn<typeof mergeWithConflictResolution>().mockResolvedValue({ success: true }),
    writeTopLevelState: vi.fn(),
    commentOnIssue: vi.fn<typeof commentOnIssue>(),
    commentOnPR: vi.fn<typeof commentOnPR>(),
    getPlanFilePath: vi.fn<typeof getPlanFilePath>().mockReturnValue('specs/issue-42-plan.md'),
    planFileExists: vi.fn<typeof planFileExists>().mockReturnValue(false),
    ...overrides,
  };
}

// ── Missing / invalid state ──────────────────────────────────────────────────

describe('executeMerge — missing state', () => {
  it('returns abandoned when top-level state file is not found', async () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_state_file');
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('returns abandoned when workflowStage is not awaiting_merge', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'completed' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toContain('unexpected_stage');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('returns abandoned when orchestrator state path is not found', async () => {
    const deps = makeDeps({ findOrchestratorStatePath: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_orchestrator_state');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('returns abandoned when branchName is missing from orchestrator state', async () => {
    const deps = makeDeps({
      readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: undefined })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_branch_name');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('returns abandoned when no PR is found for the branch', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_pr_found');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });
});

// ── Already merged PR ────────────────────────────────────────────────────────

describe('executeMerge — already merged PR', () => {
  it('writes completed and posts completion comment when PR is already MERGED', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('already_merged');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'completed' });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Workflow Completed'),
      REPO_INFO,
    );
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
  });
});

// ── Closed PR (not merged) ───────────────────────────────────────────────────

describe('executeMerge — closed PR', () => {
  it('writes abandoned when PR is CLOSED without merge', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'CLOSED' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('pr_closed');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
  });
});

// ── Successful merge ─────────────────────────────────────────────────────────

describe('executeMerge — successful merge', () => {
  it('calls mergeWithConflictResolution with correct args and writes completed', async () => {
    const deps = makeDeps();

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('merged');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      7,               // prNumber
      REPO_INFO,
      'feature-issue-42-abc', // branchName (headBranch)
      'main',          // baseBranch
      '/worktrees/feature-issue-42-abc', // worktreePath
      'test-adw-id',
      '/logs/test-adw-id',
      '',              // specPath (planFileExists returns false)
    );
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'completed' });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Workflow Completed'),
      REPO_INFO,
    );
  });

  it('includes specPath when plan file exists', async () => {
    const deps = makeDeps({
      planFileExists: vi.fn().mockReturnValue(true),
      getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      expect.any(Number),
      REPO_INFO,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'test-adw-id',
      expect.any(String),
      'specs/issue-42-plan.md',
    );
  });
});

// ── Failed merge ─────────────────────────────────────────────────────────────

describe('executeMerge — failed merge', () => {
  it('writes abandoned and comments on PR when merge fails', async () => {
    const deps = makeDeps({
      mergeWithConflictResolution: vi.fn<typeof mergeWithConflictResolution>().mockResolvedValue({
        success: false,
        error: 'Conflict detected and could not be resolved',
      }),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('merge_failed');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
    expect(deps.commentOnPR).toHaveBeenCalledWith(
      7,
      expect.stringContaining('Auto-merge failed'),
      REPO_INFO,
    );
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('includes last error in the PR failure comment', async () => {
    const deps = makeDeps({
      mergeWithConflictResolution: vi.fn<typeof mergeWithConflictResolution>().mockResolvedValue({
        success: false,
        error: 'merge conflict in file.txt',
      }),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    const commentArg = (deps.commentOnPR as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(commentArg).toContain('merge conflict in file.txt');
  });
});

// ── Worktree error ───────────────────────────────────────────────────────────

describe('executeMerge — worktree error', () => {
  it('writes abandoned when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git error'); }),
    });

    const result: MergeRunResult = await executeMerge(42, 'test-adw-id', REPO_INFO, deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('worktree_error');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
  });
});
