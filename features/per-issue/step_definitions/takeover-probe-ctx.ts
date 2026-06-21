/**
 * Shared probe context for takeover BDD step definitions.
 *
 * feature-636.steps.ts reads `probeCtx.probe` when building TakeoverDeps.
 * feature-638.steps.ts writes to it via "passes/fails the reuse gate" Given steps.
 * Reset to null in each takeover Given step so scenarios are independent.
 */

import type { WorktreeProbe } from '../../../adws/vcs/worktreeReuseGate.ts';

export interface ProbeCtx {
  probe: WorktreeProbe | null; // null = default healthy (gate passes)
  clearOrphanedLockCalls: number;
  resetCalls: number; // incremented by the When step when resetWorktree is called
}

export const probeCtx: ProbeCtx = {
  probe: null,
  clearOrphanedLockCalls: 0,
  resetCalls: 0,
};

export function healthyProbe(): WorktreeProbe {
  return {
    registration: 'healthy',
    indexLock: 'absent',
    interruptedOp: 'none',
    headOnExpectedBranch: true,
    liveOwner: false,
  };
}
