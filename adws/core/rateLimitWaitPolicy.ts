/**
 * Pure decision: whether a RateLimitError should be ridden out in-process or handed to
 * the pause queue.
 *
 * | rateLimitType         | resetsAt          | reset time vs now               | decision                                   |
 * |------------------------|-------------------|-----------------------------------|---------------------------------------------|
 * | five_hour               | finite number      | later than now (any distance)    | wait_in_process, until = the reset instant  |
 * | five_hour               | finite number      | at or before now (stale)         | wait_in_process, until = now + minWaitMs    |
 * | five_hour               | absent/non-finite  | any                                | enqueue (bare)                              |
 * | anything else, or absent | finite number      | any                                | enqueue, carrying resetsAt                  |
 * | anything else, or absent | absent/non-finite  | any                                | enqueue (bare)                              |
 *
 * A future reset time is waited for exactly, whatever its distance from now: the only
 * escape hatches to the queue are a non-five_hour limit or the absence of a reset time, so
 * no margin is added and there is no upper bound on an in-process wait. minWaitMs is a
 * floor that applies only when the reported reset time is already at or behind the clock,
 * so a stale reset time cannot spin a hot re-run loop that posts a comment every few
 * seconds; it never moves a future reset time.
 */

import type { RateLimitFacts } from '../types/agentTypes';

export enum RateLimitType {
  FiveHour = 'five_hour',
  SevenDay = 'seven_day',
}

export const MIN_RATE_LIMIT_WAIT_MS = 60_000;
export const MAX_SLEEP_SLICE_MS = 60_000;

export type RateLimitWaitDecision =
  | { readonly kind: 'wait_in_process'; readonly until: Date }
  | { readonly kind: 'enqueue'; readonly resetsAt?: number };

/**
 * sleep must be timer-based and must never block the event loop: the orchestrator's
 * heartbeat interval has to keep firing through it. The runner asks for exactly one
 * sleep per in-process wait, so a test clock observes one wait per rejection.
 */
export interface WaitClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export function hasResetTime(facts: RateLimitFacts): facts is RateLimitFacts & { resetsAt: number } {
  return typeof facts.resetsAt === 'number' && Number.isFinite(facts.resetsAt);
}

function enqueueDecision(facts: RateLimitFacts): RateLimitWaitDecision {
  return hasResetTime(facts) ? { kind: 'enqueue', resetsAt: facts.resetsAt } : { kind: 'enqueue' };
}

export function decideRateLimitWait(
  facts: RateLimitFacts,
  now: Date,
  minWaitMs: number = MIN_RATE_LIMIT_WAIT_MS,
): RateLimitWaitDecision {
  if (facts.rateLimitType !== RateLimitType.FiveHour || !hasResetTime(facts)) {
    return enqueueDecision(facts);
  }
  const resetInstant = new Date(facts.resetsAt * 1000);
  return resetInstant.getTime() > now.getTime()
    ? { kind: 'wait_in_process', until: resetInstant }
    : { kind: 'wait_in_process', until: new Date(now.getTime() + minWaitMs) };
}

/**
 * Re-reads the clock between slices so a suspended host or a clock jump is noticed
 * within maxSliceMs instead of only at the end of one long sleep.
 */
export async function sleepUntil(clock: WaitClock, until: Date, maxSliceMs: number = MAX_SLEEP_SLICE_MS): Promise<void> {
  const slice = Math.max(1, maxSliceMs);
  for (;;) {
    const remaining = until.getTime() - clock.now().getTime();
    if (remaining <= 0) return;
    await clock.sleep(Math.min(remaining, slice));
  }
}
