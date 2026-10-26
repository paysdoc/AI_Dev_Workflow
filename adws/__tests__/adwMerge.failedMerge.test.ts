import { describe, it, expect, vi } from 'vitest';
import { executeMerge } from '../adwMerge';
import { makeDeps, makeMergeOutcome, REPO_INFO } from './adwMerge.helpers';
import type { MergeDeps } from '../adwMerge';
import type { MergeOutcome } from '../triggers/autoMergeHandler';

describe('executeMerge — failed merge', () => {
  it('writes merge_blocked and comments on issue when merge fails', async () => {
    const deps = makeDeps({
      mergeWithConflictResolution: vi.fn<MergeDeps['mergeWithConflictResolution']>().mockResolvedValue(makeMergeOutcome({
        success: false,
        error: 'Conflict detected and could not be resolved',
      })),
    });

    const result = await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    expect(result.outcome).toBe('abandoned');
    expect(result.reason).toBe('merge_failed');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', { workflowStage: 'merge_blocked' });
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('Merge Blocked'),
    );
    expect(deps.commentOnIssue).toHaveBeenCalledWith(
      42,
      expect.stringContaining('## Retry'),
    );
  });

  it('includes last error in the issue failure comment', async () => {
    const deps = makeDeps({
      mergeWithConflictResolution: vi.fn<MergeDeps['mergeWithConflictResolution']>().mockResolvedValue(makeMergeOutcome({
        success: false,
        error: 'merge conflict in file.txt',
      })),
    });

    await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);

    const commentArg = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(commentArg).toContain('merge conflict in file.txt');
  });

  async function blockedComment(outcome: MergeOutcome): Promise<string> {
    const deps = makeDeps({
      mergeWithConflictResolution: vi.fn<MergeDeps['mergeWithConflictResolution']>().mockResolvedValue(outcome),
    });
    await executeMerge(42, 'test-adw-id', REPO_INFO, '/base/repo', deps);
    return (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  }

  it('states the real number of merge attempts and that resolution did not run after stale refusals the local merge check did not back', async () => {
    const comment = await blockedComment(makeMergeOutcome({
      success: false,
      error: 'GraphQL: Base branch was modified',
      mergeAttempts: 5,
      conflictResolutionRan: false,
      localMergeCheck: 'clean',
    }));

    expect(comment).toContain('Merge Blocked');
    expect(comment).toContain('## Retry');
    expect(comment).toContain('Merge attempts: 5');
    expect(comment).toContain('Conflict resolution: did not run');
    expect(comment).toContain('Local merge check: clean against `origin/main`');
    expect(comment).toContain('Last error: GraphQL: Base branch was modified');
    expect(comment).not.toContain('multiple conflict-resolution attempts');
  });

  it('states that resolution ran and that the local merge check found conflicts', async () => {
    const comment = await blockedComment(makeMergeOutcome({
      success: false,
      error: 'merge conflict in file.txt',
      mergeAttempts: 2,
      conflictResolutionRan: true,
      localMergeCheck: 'conflicts',
    }));

    expect(comment).toContain('Merge attempts: 2');
    expect(comment).toContain('Conflict resolution: ran');
    expect(comment).toContain('Local merge check: found conflicts with `origin/main`');
  });

  it('says the local merge check could not run, and leaves out the last error when there is none', async () => {
    const comment = await blockedComment(makeMergeOutcome({
      success: false,
      mergeAttempts: 0,
      conflictResolutionRan: false,
      localMergeCheck: 'unavailable',
    }));

    expect(comment).toContain('Merge attempts: 0');
    expect(comment).toContain('could not run');
    expect(comment).not.toContain('Last error:');
  });

  it('cuts the last error to 500 characters', async () => {
    const comment = await blockedComment(makeMergeOutcome({ success: false, error: `${'x'.repeat(500)}TAIL` }));

    expect(comment).toContain(`Last error: ${'x'.repeat(500)}`);
    expect(comment).not.toContain('TAIL');
  });
});

