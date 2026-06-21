import { describe, it, expect } from 'vitest';
import { decideWorktreeReuse } from '../worktreeReuseGate';
import type { WorktreeProbe } from '../worktreeReuseGate';

function healthyProbe(overrides: Partial<WorktreeProbe> = {}): WorktreeProbe {
  return {
    registration: 'healthy',
    indexLock: 'absent',
    interruptedOp: 'none',
    headOnExpectedBranch: true,
    liveOwner: false,
    ...overrides,
  };
}

describe('decideWorktreeReuse', () => {
  describe('reuse cases', () => {
    it('all-clear probe → reuse', () => {
      expect(decideWorktreeReuse(healthyProbe())).toEqual({ reuse: true });
    });

    it('orphaned index.lock, otherwise healthy → reuse (stale lock does not block)', () => {
      expect(decideWorktreeReuse(healthyProbe({ indexLock: 'orphaned' }))).toEqual({ reuse: true });
    });
  });

  describe('reset cases', () => {
    const resetCases: Array<[string, Partial<WorktreeProbe>, string]> = [
      ['live owner',           { liveOwner: true },                         'live_owner'],
      ['live-held lock',       { indexLock: 'live_held' },                  'index_lock_live_held'],
      ['interrupted rebase',   { interruptedOp: 'rebase' },                 'interrupted_rebase'],
      ['interrupted merge',    { interruptedOp: 'merge' },                  'interrupted_merge'],
      ['interrupted cherry-pick', { interruptedOp: 'cherry_pick' },         'interrupted_cherry_pick'],
      ['wrong HEAD',           { headOnExpectedBranch: false },              'wrong_head'],
      ['locked registration',  { registration: 'locked' },                  'worktree_locked'],
      ['prunable registration',{ registration: 'prunable' },                'worktree_prunable'],
      ['missing registration', { registration: 'missing' },                 'worktree_missing'],
    ];

    it.each(resetCases)('%s → reset with correct reason', (_label, overrides, reason) => {
      const result = decideWorktreeReuse(healthyProbe(overrides));
      expect(result).toEqual({ reuse: false, reason });
    });
  });

  describe('precedence', () => {
    it('liveOwner beats wrong_head (confirmed-dead check is first guard)', () => {
      const result = decideWorktreeReuse(healthyProbe({ liveOwner: true, headOnExpectedBranch: false }));
      expect(result).toEqual({ reuse: false, reason: 'live_owner' });
    });

    it('liveOwner beats interrupted rebase', () => {
      const result = decideWorktreeReuse(healthyProbe({ liveOwner: true, interruptedOp: 'rebase' }));
      expect(result).toEqual({ reuse: false, reason: 'live_owner' });
    });

    it('live_held lock beats interrupted merge (operability before registration)', () => {
      const result = decideWorktreeReuse(healthyProbe({ indexLock: 'live_held', interruptedOp: 'merge' }));
      expect(result).toEqual({ reuse: false, reason: 'index_lock_live_held' });
    });

    it('interrupted rebase beats wrong_head', () => {
      const result = decideWorktreeReuse(healthyProbe({ interruptedOp: 'rebase', headOnExpectedBranch: false }));
      expect(result).toEqual({ reuse: false, reason: 'interrupted_rebase' });
    });
  });
});
