/**
 * Shared cron launch-context flag for cron-tick BDD step definitions.
 *
 * The Given phrase "the cron holds no launch context" is registered exactly once
 * (feature-769.steps.ts) — Cucumber treats two identical literal registrations as
 * globally ambiguous regardless of which feature file invokes them, so
 * feature-810.steps.ts cannot register its own copy. This module is the seam
 * between them: feature-769's launch-context Givens publish the flag, and
 * feature-810's docs-index-sweep dispatch When reads it to decide whether to hand
 * `runDocsIndexSweepTick` a sweep thunk or the `null` that models "no launch
 * GitContext available". Same precedent as takeover-probe-ctx.ts — a tiny shared
 * state module rather than one step file reaching into another's private ctx.
 *
 * `null` means no launch-context Given ran in this scenario. Both consuming files'
 * After hooks call `resetCronLaunchContext()` so scenarios stay independent.
 */

export interface CronLaunchContextCtx {
  hasLaunchContext: boolean | null;
}

export const cronLaunchContextCtx: CronLaunchContextCtx = {
  hasLaunchContext: null,
};

export function resetCronLaunchContext(): void {
  cronLaunchContextCtx.hasLaunchContext = null;
}
