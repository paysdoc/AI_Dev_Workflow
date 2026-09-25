/**
 * Pure pause-queue decider. No I/O, clock or environment reads — the clock and the strike
 * budget are inputs. Ownership (the scanning cron's repo identity) is a seam left for a
 * later slice: `PauseQueueDecisionInput` is an object precisely so that field can be added
 * without touching a call site; no ownership rule is implemented here.
 *
 * Decision table (top to bottom; the reset gate is evaluated before the verdict, so a probe
 * result taken while an entry is still waiting can neither strike nor resume it):
 *
 * | entry.resetsAt vs now          | probe.verdict      | action                                        |
 * |---------------------------------|--------------------|------------------------------------------------|
 * | parses and later than now       | any                 | skip_before_reset                              |
 * | absent, unparseable, or past    | clear               | resume                                         |
 * | absent, unparseable, or past    | limited             | refresh_reset (carries resetsAt/rateLimitType  |
 * |                                  |                     |   when the probe reports a reset time; bare    |
 * |                                  |                     |   otherwise — never a strike)                  |
 * | absent, unparseable, or past    | failed / unknown    | count_strike while failures + 1 < budget       |
 * | absent, unparseable, or past    | failed / unknown    | evict once failures + 1 >= budget              |
 *
 * A `limited` verdict can never reach count_strike/evict — that branch is structurally
 * unreachable, not merely untested.
 */

import type { PausedWorkflow } from '../core/pauseQueue';
import { resetsAtIsoFromEpochSeconds } from '../core/pauseQueue';
import type { ProbeClassification, ProbeOutcome } from './rateLimitProbe';

export type StrikeVerdict = Extract<ProbeOutcome, 'failed' | 'unknown'>;

export type PauseQueueAction =
  | { readonly kind: 'skip_before_reset'; readonly resetsAt: string }
  | { readonly kind: 'resume' }
  | { readonly kind: 'refresh_reset'; readonly resetsAt?: string; readonly rateLimitType?: string }
  | { readonly kind: 'count_strike'; readonly probeFailures: number; readonly verdict: StrikeVerdict }
  | { readonly kind: 'evict'; readonly probeFailures: number; readonly verdict: StrikeVerdict };

export interface PauseQueueDecisionInput {
  readonly entry: PausedWorkflow;
  readonly probe: ProbeClassification;
  readonly now: Date;
  readonly maxProbeFailures: number;
}

/** Unparseable (undefined, empty, or NaN) is treated as absent — never freezes an entry. */
export function parseResetsAt(resetsAt: string | undefined): number | null {
  if (!resetsAt) return null;
  const parsed = Date.parse(resetsAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Exactly at the reset time the entry is due (`>`, not `>=`). */
export function isBeforeReset(entry: Pick<PausedWorkflow, 'resetsAt'>, now: Date): boolean {
  const parsed = parseResetsAt(entry.resetsAt);
  return parsed !== null && parsed > now.getTime();
}

function refreshAction(probe: ProbeClassification): PauseQueueAction {
  if (typeof probe.resetsAt !== 'number' || !Number.isFinite(probe.resetsAt)) {
    return { kind: 'refresh_reset' };
  }
  return {
    kind: 'refresh_reset',
    resetsAt: resetsAtIsoFromEpochSeconds(probe.resetsAt),
    ...(typeof probe.rateLimitType === 'string' ? { rateLimitType: probe.rateLimitType } : {}),
  };
}

function strikeAction(entry: PausedWorkflow, verdict: StrikeVerdict, maxProbeFailures: number): PauseQueueAction {
  const probeFailures = (entry.probeFailures ?? 0) + 1;
  return probeFailures < maxProbeFailures
    ? { kind: 'count_strike', probeFailures, verdict }
    : { kind: 'evict', probeFailures, verdict };
}

export function decidePauseQueueAction(input: PauseQueueDecisionInput): PauseQueueAction {
  const { entry, probe, now, maxProbeFailures } = input;

  if (isBeforeReset(entry, now)) {
    return { kind: 'skip_before_reset', resetsAt: entry.resetsAt as string };
  }

  switch (probe.verdict) {
    case 'clear':
      return { kind: 'resume' };
    case 'limited':
      return refreshAction(probe);
    case 'failed':
    case 'unknown':
      return strikeAction(entry, probe.verdict, maxProbeFailures);
    default: {
      const exhaustive: never = probe.verdict;
      throw new Error(`Unhandled probe verdict: ${String(exhaustive)}`);
    }
  }
}
