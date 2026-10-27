import { describe, it, expect, vi } from 'vitest';
import { executeMerge } from '../adwMerge';
import type { MergeDeps } from '../adwMerge';
import type { PostMergeRed } from '../core/postMergeVerdict';
import { buildParkComment, ParkReason } from '../forge/parkComment';
import { makeDeps, makeMergeOutcome, makePR, REPO_INFO } from './adwMerge.helpers';

const ADW_ID = 'test-adw-id';
const WORKTREE = '/worktrees/feature-issue-42-abc';

const RED: PostMergeRed = {
  mergedCommits: ['a1b2c3d Add the changelog', 'e4f5a6b Raise the order limit'],
  conflictedFiles: ['src/shared.ts'],
  failures: [{ title: '@adw-42 Orders: Orders over the limit are refused', detail: 'expected status 422, got 201' }],
};

function depsWhoseScenariosFail(overrides: Partial<MergeDeps> = {}): MergeDeps {
  const redOutcome = makeMergeOutcome({
    success: false,
    error: 'the scenarios failed on the branch merged with origin/main',
    mergeAttempts: 0,
    postMergeRed: RED,
  });
  return makeDeps({
    mergeWithConflictResolution: vi.fn<MergeDeps['mergeWithConflictResolution']>().mockResolvedValue(redOutcome),
    ...overrides,
  });
}

const parkEvidence = { reason: ParkReason.PostMergeBddRed, prNumber: makePR().number, baseBranch: makePR().targetBranch, ...RED } as const;

describe('executeMerge — scenarios fail on the branch merged with the base branch', () => {
  it('parks the workflow as human_gated for post_merge_bdd_red', async () => {
    const deps = depsWhoseScenariosFail();

    await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    expect(deps.writeTopLevelState).toHaveBeenCalledTimes(1);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { workflowStage: 'human_gated', parkReason: 'post_merge_bdd_red' });
  });

  it('writes the state before it posts the comment', async () => {
    const deps = depsWhoseScenariosFail();

    await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    const [stateWrittenAt] = vi.mocked(deps.writeTopLevelState).mock.invocationCallOrder;
    const [commentPostedAt] = vi.mocked(deps.commentOnIssue).mock.invocationCallOrder;
    expect(stateWrittenAt).toBeLessThan(commentPostedAt);
  });

  it('posts exactly one comment, the park comment built from the pull request, the base branch and what the loop reported', async () => {
    const deps = depsWhoseScenariosFail();

    await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    expect(deps.commentOnIssue).toHaveBeenCalledWith(42, buildParkComment(ADW_ID, parkEvidence));
  });

  it('ends the run as abandoned for post_merge_bdd_red', async () => {
    const result = await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', depsWhoseScenariosFail());

    expect(result).toEqual({ outcome: 'abandoned', reason: 'post_merge_bdd_red' });
  });

  it('writes neither completed nor merge_blocked, posts no completion or blocked comment, and leaves the board alone', async () => {
    const deps = depsWhoseScenariosFail();

    await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    const states = vi.mocked(deps.writeTopLevelState).mock.calls.map(([, state]) => state.workflowStage);
    expect(states).not.toContain('completed');
    expect(states).not.toContain('merge_blocked');
    const comments = vi.mocked(deps.commentOnIssue).mock.calls.map(([, body]) => body);
    expect(comments.some((body) => body.includes('Workflow Completed') || body.includes('Merge Blocked'))).toBe(false);
    expect(deps.notifyBlockedTransition).not.toHaveBeenCalled();
  });

  it('still writes the state, and still ends the run, when the park comment cannot be posted', async () => {
    const deps = depsWhoseScenariosFail({
      commentOnIssue: vi.fn(() => {
        throw new Error('API rate limit exceeded');
      }),
    });

    const result = await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { workflowStage: 'human_gated', parkReason: 'post_merge_bdd_red' });
    expect(result).toEqual({ outcome: 'abandoned', reason: 'post_merge_bdd_red' });
  });

  it('gives the merge loop a re-run that runs the scenarios of this workflow in its worktree', async () => {
    const deps = depsWhoseScenariosFail();
    const redVerdict = { kind: 'red', failures: RED.failures } as const;
    vi.mocked(deps.rerunScenarios).mockResolvedValue(redVerdict);

    await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    const rerunScenarios = vi.mocked(deps.mergeWithConflictResolution).mock.calls[0]?.[7];
    expect(deps.rerunScenarios).not.toHaveBeenCalled();
    await expect(rerunScenarios?.()).resolves.toBe(redVerdict);
    expect(deps.rerunScenarios).toHaveBeenCalledWith({ issueNumber: 42, adwId: ADW_ID, worktreePath: WORKTREE, logsDir: '/logs/test-adw-id' });
  });

  it('blocks the merge as before when the loop failed without a red re-run', async () => {
    const deps = makeDeps({
      mergeWithConflictResolution: vi
        .fn<MergeDeps['mergeWithConflictResolution']>()
        .mockResolvedValue(makeMergeOutcome({ success: false, error: 'origin/main moved on while the scenarios were re-run' })),
    });

    const result = await executeMerge(42, ADW_ID, REPO_INFO, '/base/repo', deps);

    expect(result).toEqual({ outcome: 'abandoned', reason: 'merge_failed' });
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { workflowStage: 'merge_blocked' });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(42, expect.stringContaining('origin/main moved on while the scenarios were re-run'));
  });
});
