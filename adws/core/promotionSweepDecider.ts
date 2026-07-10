/**
 * Pure lifecycle decider for the promotion sweep. No I/O — every input is a
 * pre-computed fact; the decider only maps facts to a single `PromotionAction`.
 *
 * Covers the full lifecycle: `originate` (issue #740) plus `decline | redrive
 * | withdraw` (issue #741, the reconcile half) — a tagged, in-flight
 * candidate reconciled against its tracking issue/PR.
 *
 * Decision table:
 *
 * | tagState  | meetsThreshold | reconcile            | action    |
 * |-----------|----------------|----------------------|-----------|
 * | any       | any            | merged               | done      |
 * | none      | true           | no-issue             | originate |
 * | none      | false          | no-issue             | leave     |
 * | none      | any            | open/closed/blocked  | leave     |
 * | suggested | any            | open                 | leave     |
 * | suggested | any            | closed-unmerged      | decline   |
 * | suggested | any            | blocked              | decline   |
 * | suggested | true           | no-issue             | redrive   |
 * | suggested | false          | no-issue             | withdraw  |
 * | declined  | any            | (non-merged)         | leave     |
 *
 * `merged` wins over every other input (a candidate already promoted is done
 * regardless of a stale on-file tag or a re-scored threshold) — but `merged`
 * is a decider-level fact only; the shell never produces it, because a
 * promoted file's build step moves it out of `features/per-issue/`, so it is
 * never handed to this decider at all (see `promotionReconcileLink.ts`'s
 * docblock). "Done" is realized by that absence, not by a reconcile fact —
 * `merged`/`done` stay in the type surface (and this file's exhaustive tests)
 * for a stable contract, deliberately unreachable from the shell.
 *
 * `originate` requires all three of: no existing tag, a qualifying score, and
 * no promotion issue already tracking it. A `suggested` (in-flight) file
 * reconciles against its tracker: a closed-unmerged or `adw:blocked` tracker
 * is a terminal rejection (`decline`); a missing tracker (crash-stranded)
 * either re-files (`redrive`, still qualifying) or withdraws (`withdraw`,
 * score has dropped below threshold since it was suggested). Terminal
 * `declined` and everything else left unmentioned above leaves the file
 * untouched.
 */

import type { PromotionTagState } from './promotionTagState';

export type { PromotionTagState };

export type ReconcileFact = 'no-issue' | 'open' | 'merged' | 'closed-unmerged' | 'blocked';

export type PromotionAction = 'originate' | 'leave' | 'done' | 'decline' | 'redrive' | 'withdraw';

export interface PromotionDecisionInput {
  tagState: PromotionTagState;
  meetsThreshold: boolean;
  reconcile: ReconcileFact;
}

export function decidePromotionAction(input: PromotionDecisionInput): PromotionAction {
  const { tagState, meetsThreshold, reconcile } = input;

  if (reconcile === 'merged') return 'done';

  if (tagState === 'none') {
    return meetsThreshold && reconcile === 'no-issue' ? 'originate' : 'leave';
  }

  if (tagState === 'suggested') {
    if (reconcile === 'closed-unmerged' || reconcile === 'blocked') return 'decline';
    if (reconcile === 'no-issue') return meetsThreshold ? 'redrive' : 'withdraw';
    return 'leave';
  }

  return 'leave';
}
