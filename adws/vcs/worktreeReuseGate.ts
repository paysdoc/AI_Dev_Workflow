/**
 * worktreeReuseGate — pure decision over Class-A git-operability signals.
 *
 * `decideWorktreeReuse(probe)` returns REUSE only when every signal is healthy.
 * Any single fault returns RESET with a typed reason. No I/O; total over WorktreeProbe.
 *
 * Class-B content health (diff quality, test results) is explicitly out of scope —
 * the existing blocking end-verification + HITL-on-destructive-diffs gate handles that.
 */

export interface WorktreeProbe {
  readonly registration: 'healthy' | 'locked' | 'prunable' | 'missing';
  readonly indexLock: 'absent' | 'orphaned' | 'live_held';
  readonly interruptedOp: 'none' | 'rebase' | 'merge' | 'cherry_pick';
  readonly headOnExpectedBranch: boolean;
  readonly liveOwner: boolean;
}

export type WorktreeResetReason =
  | 'live_owner'
  | 'index_lock_live_held'
  | 'interrupted_rebase'
  | 'interrupted_merge'
  | 'interrupted_cherry_pick'
  | 'wrong_head'
  | 'worktree_locked'
  | 'worktree_prunable'
  | 'worktree_missing';

export type WorktreeReuseDecision =
  | { readonly reuse: true }
  | { readonly reuse: false; readonly reason: WorktreeResetReason };

// Guard clauses in priority order:
//   1. Confirmed-dead precondition (liveOwner)
//   2. Git-operability (lock, interrupted op, HEAD)
//   3. Registration state
// An absent or orphaned lock never blocks reuse.
export function decideWorktreeReuse(probe: WorktreeProbe): WorktreeReuseDecision {
  if (probe.liveOwner) return { reuse: false, reason: 'live_owner' };
  if (probe.indexLock === 'live_held') return { reuse: false, reason: 'index_lock_live_held' };
  if (probe.interruptedOp === 'rebase') return { reuse: false, reason: 'interrupted_rebase' };
  if (probe.interruptedOp === 'merge') return { reuse: false, reason: 'interrupted_merge' };
  if (probe.interruptedOp === 'cherry_pick') return { reuse: false, reason: 'interrupted_cherry_pick' };
  if (!probe.headOnExpectedBranch) return { reuse: false, reason: 'wrong_head' };
  if (probe.registration === 'locked') return { reuse: false, reason: 'worktree_locked' };
  if (probe.registration === 'prunable') return { reuse: false, reason: 'worktree_prunable' };
  if (probe.registration === 'missing') return { reuse: false, reason: 'worktree_missing' };
  return { reuse: true };
}
