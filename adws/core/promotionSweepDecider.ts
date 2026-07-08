/**
 * Pure lifecycle decider for the promotion sweep. No I/O — every input is a
 * pre-computed fact; the decider only maps facts to a single `PromotionAction`.
 *
 * This slice (issue #740, the originate half) emits only the
 * `originate | leave | done` subset of `PromotionAction`. `decline | redrive |
 * withdraw` — and the `closed-unmerged | blocked` reconciliation facts that
 * would drive them — are the sibling reconcile-path slice; the full unions are
 * declared here for a stable type surface, and every not-yet-handled fact
 * resolves to the conservative `leave` (no-op) so this sweep is correct and
 * idempotent standalone.
 *
 * Decision table:
 *
 * | tagState  | meetsThreshold | reconcile        | action    |
 * |-----------|----------------|------------------|-----------|
 * | any       | any            | merged           | done      |
 * | none      | true           | no-issue         | originate |
 * | *         | *              | *  (else)        | leave     |
 *
 * `merged` wins over every other input (a candidate already promoted is done
 * regardless of a stale on-file tag or a re-scored threshold). `originate`
 * requires all three of: no existing tag, a qualifying score, and no open
 * promotion issue already tracking it. Everything else — below-threshold,
 * already `suggested` (in flight), terminal `declined`, and the deferred
 * `closed-unmerged` / `blocked` facts — leaves the file untouched.
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
  if (input.reconcile === 'merged') return 'done';
  if (input.tagState === 'none' && input.meetsThreshold && input.reconcile === 'no-issue') return 'originate';
  return 'leave';
}
