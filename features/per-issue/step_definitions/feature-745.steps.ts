/**
 * Step definitions for feature-745.feature
 *
 * Drives the exported cron dispatch seam (`runPromotionSweepTick`) directly,
 * in-process, with an injected capturing fake in place of the real
 * `runPromotionSweep` — no real git/gh calls, no spawned cron. Importing
 * `trigger_cron.ts` is safe: its entry-script argv guard means the cron loop
 * and `process.exit` never fire on import (the same guard that already lets
 * `../trigger_cron.test.ts` import `runHungDetectorSweep` directly).
 *
 * Self-contained module-private `ctx` per the feature file's step-definition
 * note — does NOT reach into feature-740.steps.ts's or feature-741.steps.ts's
 * ctx or step defs.
 *
 * Registered phrases reused (not redefined here):
 *  - Given  'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then   'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { runPromotionSweepTick } from '../../../adws/triggers/trigger_cron.ts';
import { PROMOTION_SWEEP_INTERVAL_CYCLES } from '../../../adws/core/index.ts';

interface DispatchCtx {
  invocationCount: number;
  sweepShouldThrow: boolean;
  dispatchThrew: boolean;
}

const ctx: DispatchCtx = {
  invocationCount: 0,
  sweepShouldThrow: false,
  dispatchThrew: false,
};

/** Resolves a Gherkin cycle-position phrase to a cycleCount, relative to the imported constant. */
function resolveCycleCount(cyclePosition: string): number {
  switch (cyclePosition) {
    case 'cadence-eligible':
      return PROMOTION_SWEEP_INTERVAL_CYCLES;
    case 'intervening':
      return PROMOTION_SWEEP_INTERVAL_CYCLES + 1;
    case 'pre-cadence':
      return PROMOTION_SWEEP_INTERVAL_CYCLES - 1;
    case 'startup':
      return 1;
    default:
      throw new Error(`Unknown cyclePosition: ${cyclePosition}`);
  }
}

/** Capturing fake sweep: increments ctx's invocation counter and resolves (or throws) per ctx.sweepShouldThrow. */
function fakeSweep(): Promise<unknown> {
  ctx.invocationCount += 1;
  if (ctx.sweepShouldThrow) {
    return Promise.reject(new Error('injected transient promotion-sweep error'));
  }
  return Promise.resolve({ originated: [], redriven: [], declined: [], withdrawn: [], left: [] });
}

After({ tags: '@adw-745' }, function () {
  ctx.invocationCount = 0;
  ctx.sweepShouldThrow = false;
  ctx.dispatchThrew = false;
});

// ── Given ────────────────────────────────────────────────────────────────────

Given('the injected promotion sweep is configured to throw a transient error', function () {
  ctx.sweepShouldThrow = true;
});

// ── When ─────────────────────────────────────────────────────────────────────

When('the cron promotion-sweep dispatch runs for a {string} cron cycle', async function (cyclePosition: string) {
  const cycleCount = resolveCycleCount(cyclePosition);
  try {
    await runPromotionSweepTick(cycleCount, fakeSweep);
    ctx.dispatchThrew = false;
  } catch {
    ctx.dispatchThrew = true;
  }
});

// ── Then ─────────────────────────────────────────────────────────────────────

Then('the promotion sweep is dispatched exactly once', function () {
  assert.strictEqual(ctx.invocationCount, 1, `Expected the injected sweep to be invoked exactly once, got ${ctx.invocationCount}`);
});

Then('the promotion sweep is not dispatched', function () {
  assert.strictEqual(ctx.invocationCount, 0, `Expected the injected sweep never to be invoked, got ${ctx.invocationCount}`);
});

Then('the cron promotion-sweep dispatch completes without raising an error', function () {
  assert.strictEqual(ctx.dispatchThrew, false, 'Expected the dispatch to complete without raising an error');
  assert.ok(ctx.invocationCount > 0, 'Expected the swallow to happen around a real dispatch attempt (invocation count should be > 0), not because the gate was closed');
});
