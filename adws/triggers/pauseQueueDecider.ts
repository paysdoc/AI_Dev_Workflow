/**
 * Pure pause-queue decider. No I/O, clock or environment reads — the clock and the strike
 * budget are inputs.
 *
 * Ownership: an entry belongs to the cron whose launch identity matches the target repo
 * recorded on the entry (`--target-repo` in `extraArgs`), compared case-insensitively; an
 * entry recording no target repo belongs to the self-host cron. A cron that does not own
 * an entry can never strike, refresh, resume or evict it.
 *
 * Decision table (top to bottom; ownership is evaluated before the reset gate, and the
 * reset gate before the verdict, so a probe result taken by a non-owner or while an entry
 * is still waiting can neither strike nor resume it):
 *
 * | entry owned by scanning cron?   | entry.resetsAt vs now | probe.verdict    | action                                        |
 * |----------------------------------|------------------------|------------------|------------------------------------------------|
 * | no                                | any                     | any              | skip_not_owner                                 |
 * | yes                               | parses and later than now | any          | skip_before_reset                              |
 * | yes                               | absent, unparseable, or past | clear     | resume                                         |
 * | yes                               | absent, unparseable, or past | limited   | refresh_reset (carries resetsAt/rateLimitType  |
 * |                                   |                         |                  |   when the probe reports a reset time; bare    |
 * |                                   |                         |                  |   otherwise — never a strike)                  |
 * | yes                               | absent, unparseable, or past | failed / unknown | count_strike while failures + 1 < budget  |
 * | yes                               | absent, unparseable, or past | failed / unknown | evict once failures + 1 >= budget         |
 *
 * A `limited` verdict can never reach count_strike/evict — that branch is structurally
 * unreachable, not merely untested.
 */

import type { PausedWorkflow } from '../core/pauseQueue';
import { resetsAtIsoFromEpochSeconds } from '../core/pauseQueue';
import type { ProbeClassification, ProbeOutcome } from './rateLimitProbe';
import type { RepoIdentity } from '../types/agentTypes';
import { sameRepoIdentity } from '../core/repoIdentityCrossCheck';

export type StrikeVerdict = Extract<ProbeOutcome, 'failed' | 'unknown'>;

export type PauseQueueAction =
  | { readonly kind: 'skip_not_owner' }
  | { readonly kind: 'skip_before_reset'; readonly resetsAt: string }
  | { readonly kind: 'resume' }
  | { readonly kind: 'refresh_reset'; readonly resetsAt?: string; readonly rateLimitType?: string }
  | { readonly kind: 'count_strike'; readonly probeFailures: number; readonly verdict: StrikeVerdict }
  | { readonly kind: 'evict'; readonly probeFailures: number; readonly verdict: StrikeVerdict };

/**
 * The scanning cron's own launch identity. `selfHost` is true for a cron launched without
 * `--target-repo`; `repoId` is the identity that cron resolved at startup.
 */
export interface ScanningCronIdentity {
  readonly repoId: RepoIdentity;
  readonly selfHost: boolean;
}

export interface PauseQueueDecisionInput {
  readonly entry: PausedWorkflow;
  readonly probe: ProbeClassification;
  readonly now: Date;
  readonly maxProbeFailures: number;
  readonly scanningCron: ScanningCronIdentity;
}

/**
 * Total read of the entry's `--target-repo`: never mutates, never terminates the process,
 * unlike `parseTargetRepoArgs` (which splices its array and quits on a malformed value —
 * unusable inside a pure, total decider that a queue entry must never be able to kill). A
 * non-array `extraArgs` or a non-string value after the flag reads as `null`, exactly like a
 * missing or malformed one, because every cron runs this read over every entry in its
 * ownership filter — a throw here would let one malformed entry abort every cron's tick on
 * the host.
 */
function parseEntryTargetRepo(extraArgs: readonly string[] | undefined): RepoIdentity | null {
  if (!Array.isArray(extraArgs)) return null;
  const flagIndex = extraArgs.indexOf('--target-repo');
  if (flagIndex === -1) return null;
  const value = extraArgs[flagIndex + 1];
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/** Pure and total — the same predicate the scanner's probe gate filters entries with. */
export function isOwnedByScanningCron(entry: Pick<PausedWorkflow, 'extraArgs'>, scanningCron: ScanningCronIdentity): boolean {
  const entryRepo = parseEntryTargetRepo(entry.extraArgs);
  return entryRepo === null ? scanningCron.selfHost : sameRepoIdentity(entryRepo, scanningCron.repoId);
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
  const { entry, probe, now, maxProbeFailures, scanningCron } = input;

  if (!isOwnedByScanningCron(entry, scanningCron)) {
    return { kind: 'skip_not_owner' };
  }

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
