import { describe, it, expect, vi } from 'vitest';
import { executeMerge } from '../adwMerge';
import { makeDeps, makeState, makePR, REPO_INFO } from './adwMerge.helpers';
import type { MergeRunResult } from '../adwMerge';

describe('executeMerge — missing state', () => {
  it('returns abandoned when top-level state file is not found', async () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_state_file');
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('returns abandoned when workflowStage is not awaiting_merge', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'completed' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toContain('unexpected_stage');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('returns abandoned when orchestrator state path is not found', async () => {
    const deps = makeDeps({ findOrchestratorStatePath: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_orchestrator_state');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('returns abandoned when branchName is missing from orchestrator state', async () => {
    const deps = makeDeps({
      readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: undefined })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_branch_name');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
  });

  it('stays awaiting_merge on first no_pr_found miss (attempt 1 of 3)', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(null) });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_pr_found');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'awaiting_merge', mergeRetryCount: 1 });
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('stays awaiting_merge on second no_pr_found miss (attempt 2 of 3)', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ mergeRetryCount: 1 })),
      findPRByBranch: vi.fn().mockReturnValue(null),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_pr_found');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'awaiting_merge', mergeRetryCount: 2 });
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('escalates to merge_blocked on third no_pr_found miss (attempt 3 of 3)', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ mergeRetryCount: 2 })),
      findPRByBranch: vi.fn().mockReturnValue(null),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('no_pr_found_blocked');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'merge_blocked', mergeRetryCount: 3 });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Merge Blocked'),
    );
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('## Retry'),
    );
  });
});

describe('executeMerge — already merged PR', () => {
  it('writes completed and posts completion comment when PR is already MERGED', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('already_merged');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'completed', mergeRetryCount: 0 });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Workflow Completed'),
    );
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
  });
});

describe('executeMerge — closed PR', () => {
  it('writes discarded and notifies blocked when PR is CLOSED without merge', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'CLOSED' })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('pr_closed');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'discarded' });
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
    expect(deps.notifyBlockedTransition).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 42, repoInfo: REPO_INFO, source: 'discarded' }),
    );
  });

  it('does not call notifyBlockedTransition for merged PRs', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(deps.notifyBlockedTransition).not.toHaveBeenCalled();
  });
});

describe('executeMerge — successful merge', () => {
  it('calls mergeWithConflictResolution with correct args and writes completed', async () => {
    const deps = makeDeps();

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('merged');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      7,
      'feature-issue-42-abc',
      'main',
      '/worktrees/feature-issue-42-abc',
      'test-adw-id',
      '/logs/test-adw-id',
      '',              // specPath (planFileExists returns false)
    );
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'completed', mergeRetryCount: 0 });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Workflow Completed'),
    );
  });

  it('includes specPath when plan file exists', async () => {
    const deps = makeDeps({
      planFileExists: vi.fn().mockReturnValue(true),
      getPlanFilePath: vi.fn().mockReturnValue('specs/issue-42-plan.md'),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      'test-adw-id',
      expect.any(String),
      'specs/issue-42-plan.md',
    );
  });
});

describe('executeMerge — worktree error', () => {
  it('writes abandoned when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git error'); }),
    });

    const result: MergeRunResult = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('worktree_error');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'abandoned' });
    expect(deps.mergeWithConflictResolution).not.toHaveBeenCalled();
  });
});

describe('executeMerge — branchName resolution (issue #530)', () => {
  it('regression: resolves branchName from top-level state when orchestrator path is null', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-issue-530-top-level' })),
      findOrchestratorStatePath: vi.fn().mockReturnValue(null),
      findPRByBranch: vi.fn().mockReturnValue(makePR({ sourceBranch: 'feature-issue-530-top-level' })),
      ensureWorktree: vi.fn().mockReturnValue('/worktrees/feature-issue-530-top-level'),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).not.toBe('no_branch_name');
    expect(result.reason).not.toBe('no_orchestrator_state');
    expect(deps.findOrchestratorStatePath).not.toHaveBeenCalled();
    expect(deps.findPRByBranch).toHaveBeenCalledWith('feature-issue-530-top-level');
    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      expect.any(Number), 'feature-issue-530-top-level',
      expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String),
    );
  });

  it('regression: resolves branchName from top-level state when orchestrator state has no branchName', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-issue-530-top-level' })),
      readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: undefined })),
      findPRByBranch: vi.fn().mockReturnValue(makePR({ sourceBranch: 'feature-issue-530-top-level' })),
      ensureWorktree: vi.fn().mockReturnValue('/worktrees/feature-issue-530-top-level'),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.findOrchestratorStatePath).not.toHaveBeenCalled();
    expect(deps.findPRByBranch).toHaveBeenCalledWith('feature-issue-530-top-level');
  });

  it('precedence: top-level branchName wins when both stores differ', async () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-top-level-A' })),
      readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-orchestrator-B' })),
      findPRByBranch: vi.fn().mockReturnValue(makePR({ sourceBranch: 'feature-top-level-A' })),
      ensureWorktree: vi.fn().mockReturnValue('/worktrees/feature-top-level-A'),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.findOrchestratorStatePath).not.toHaveBeenCalled();
    expect(deps.findPRByBranch).toHaveBeenCalledWith('feature-top-level-A');
    expect(deps.findPRByBranch).not.toHaveBeenCalledWith('feature-orchestrator-B');
  });

  it('fallback: uses orchestrator branchName when top-level state has none', async () => {
    const deps = makeDeps();
    // Default makeDeps: top-level has no branchName; orchestrator has 'feature-issue-42-abc'

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('completed');
    expect(deps.findOrchestratorStatePath).toHaveBeenCalled();
    expect(deps.mergeWithConflictResolution).toHaveBeenCalledWith(
      expect.any(Number), 'feature-issue-42-abc',
      expect.any(String), expect.any(String), expect.any(String), expect.any(String), expect.any(String),
    );
  });
});

