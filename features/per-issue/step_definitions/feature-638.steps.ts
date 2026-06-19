/**
 * BDD step definitions for feature-638.feature
 *
 * §1–§3 exercise the pure worktree-reuse gate (decideWorktreeReuse) directly.
 * §4–§7 extend the feature-636 takeover step harness via the shared probe context.
 * §8    asserts the ADW TypeScript type-check passes (T22 — feature-504.steps.ts).
 * G18   "the ADW codebase is checked out" — ensureCronOnEveryEventSteps.ts.
 *
 * takeover Given/When/Then steps reused from feature-636.steps.ts.
 * New Given steps set probeCtx.probe in the shared context before the When step runs.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { decideWorktreeReuse } from '../../../adws/vcs/worktreeReuseGate.ts';
import type { WorktreeProbe, WorktreeReuseDecision } from '../../../adws/vcs/worktreeReuseGate.ts';
import { probeCtx, healthyProbe } from './takeover-probe-ctx.ts';

// ---------------------------------------------------------------------------
// Gate context (§1–§3: pure gate scenarios only)
// ---------------------------------------------------------------------------

interface GateCtx {
  probe: WorktreeProbe | null;
  decision: WorktreeReuseDecision | null;
}

const gateCtx: GateCtx = { probe: null, decision: null };

function baseHealthyProbe(): WorktreeProbe {
  return {
    registration: 'healthy',
    indexLock: 'absent',
    interruptedOp: 'none',
    headOnExpectedBranch: true,
    liveOwner: false,
  };
}

function faultProbe(fault: string): WorktreeProbe {
  const base = baseHealthyProbe();
  switch (fault) {
    case 'a live-held index.lock':        return { ...base, indexLock: 'live_held' };
    case 'an interrupted rebase':         return { ...base, interruptedOp: 'rebase' };
    case 'an interrupted merge':          return { ...base, interruptedOp: 'merge' };
    case 'an interrupted cherry-pick':    return { ...base, interruptedOp: 'cherry_pick' };
    case 'HEAD on an unexpected branch':  return { ...base, headOnExpectedBranch: false };
    case 'a locked worktree':             return { ...base, registration: 'locked' };
    case 'a prunable worktree':           return { ...base, registration: 'prunable' };
    case 'a live owning process':         return { ...base, liveOwner: true };
    default: throw new Error(`Unknown fault descriptor: "${fault}"`);
  }
}

// ---------------------------------------------------------------------------
// §1–§3 Given steps
// ---------------------------------------------------------------------------

Given('a worktree probe reporting a fully git-operable worktree on the expected branch', function () {
  gateCtx.probe = baseHealthyProbe();
  gateCtx.decision = null;
});

Given('a worktree probe reporting an orphaned index.lock and otherwise git-operable', function () {
  gateCtx.probe = { ...baseHealthyProbe(), indexLock: 'orphaned' };
  gateCtx.decision = null;
});

Given('a worktree probe reporting {string}', function (fault: string) {
  gateCtx.probe = faultProbe(fault);
  gateCtx.decision = null;
});

// ---------------------------------------------------------------------------
// §1–§3 When/Then steps
// ---------------------------------------------------------------------------

When('the worktree-reuse gate decides on the probe', function () {
  assert.ok(gateCtx.probe !== null, 'Expected probe to be set by a Given step');
  gateCtx.decision = decideWorktreeReuse(gateCtx.probe);
});

Then('the gate decides to reuse the worktree in place', function () {
  assert.ok(gateCtx.decision !== null, 'Expected decision to be set');
  assert.strictEqual(gateCtx.decision.reuse, true, `Expected reuse:true but got reuse:${gateCtx.decision.reuse}`);
});

Then('the gate decides the worktree must be reset from the remote', function () {
  assert.ok(gateCtx.decision !== null, 'Expected decision to be set');
  assert.strictEqual(gateCtx.decision.reuse, false, `Expected reuse:false but got reuse:${gateCtx.decision.reuse}`);
});

// ---------------------------------------------------------------------------
// §4–§7 Given steps (set probeCtx.probe; the When step is in feature-636)
// ---------------------------------------------------------------------------

Given("the candidate's worktree passes the reuse gate", function () {
  probeCtx.probe = healthyProbe();
  probeCtx.clearOrphanedLockCalls = 0;
  probeCtx.resetCalls = 0;
});

Given("the candidate's worktree fails the reuse gate", function () {
  probeCtx.probe = { ...baseHealthyProbe(), interruptedOp: 'rebase' };
  probeCtx.clearOrphanedLockCalls = 0;
  probeCtx.resetCalls = 0;
});

Given("the candidate's worktree is still owned by a live process", function () {
  probeCtx.probe = { ...baseHealthyProbe(), liveOwner: true };
  probeCtx.clearOrphanedLockCalls = 0;
  probeCtx.resetCalls = 0;
});

// ---------------------------------------------------------------------------
// §4 Then step: reuse-in-place observable — no reset, derive still called.
// probeCtx.resetCalls is incremented by feature-636's When step on every
// resetWorktree call, so 0 means no reset happened.
// ---------------------------------------------------------------------------

Then("the takeover handler reuses the worktree in place with its uncommitted work preserved", function () {
  assert.strictEqual(
    probeCtx.resetCalls,
    0,
    `Expected no worktree reset (reuse-in-place) but resetWorktree was called ${probeCtx.resetCalls} time(s)`,
  );
});
