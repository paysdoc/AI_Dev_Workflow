/**
 * Pure reconciliation matcher for the promotion sweep. Parses the
 * `Promotes: feature-N` back-link marker from a promotion issue's body,
 * finds the canonical linked tracker (lowest-issue-number tie-break) across
 * an injected ALL-STATE set of `regression-promotion` issues, and classifies
 * it into the full `ReconcileFact` union: an `adw:blocked`-labelled tracker
 * is `blocked`; otherwise an open tracker is `open` and a closed one is
 * `closed-unmerged`; no linked tracker at all is `no-issue`. (The `gh issue
 * list` call itself is injected by the shell — this module does no I/O.)
 *
 * `merged` is deliberately never produced here — a merged promotion's file
 * has left `features/per-issue/` and so is never handed to this function at
 * all; "done" is realized by that absence, not by a reconcile fact (see
 * `promotionSweepDecider.ts`'s docblock).
 */

import type { ReconcileFact } from './promotionSweepDecider';
import { ADW_BLOCKED_LABEL } from '../github/labelManager';

const PROMOTES_MARKER_RE = /^\s*Promotes:\s*(feature-\d+)\s*$/m;

export interface PromotionIssueRef {
  number: number;
  body: string;
  /** 'OPEN' | 'CLOSED' from `gh --json state` (uppercase; compared case-insensitively). Absent ⇒ treated as open. */
  state?: string;
  /** From `gh --json labels`. */
  labels?: readonly { name: string }[];
}

function issueIsOpen(ref: PromotionIssueRef): boolean {
  return ref.state === undefined || ref.state.toUpperCase() === 'OPEN';
}

function issueIsBlocked(ref: PromotionIssueRef): boolean {
  return (ref.labels ?? []).some(l => l.name === ADW_BLOCKED_LABEL);
}

/** Extracts the `feature-N` id from a `Promotes: feature-N` marker line, or null when absent. */
export function parsePromotesMarker(body: string): string | null {
  const match = PROMOTES_MARKER_RE.exec(body);
  return match ? match[1] : null;
}

/**
 * Returns the issue number of the promotion issue linked to `feature` via its
 * `Promotes:` marker, or null when none is linked. When more than one issue
 * promotes the same feature (a duplicate-filing edge case), the lowest issue
 * number wins — the earliest-filed issue is the canonical tracker, regardless
 * of state.
 */
export function reconcilePromotionLink(feature: string, issues: readonly PromotionIssueRef[]): number | null {
  const candidates = issues
    .filter(issue => parsePromotesMarker(issue.body) === feature)
    .map(issue => issue.number);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * Classifies `feature`'s canonical linked tracker (if any) into the full
 * `ReconcileFact` union the decider consumes. `merged` is never produced
 * here — see this module's header docblock.
 */
export function reconcileFactFor(feature: string, issues: readonly PromotionIssueRef[]): ReconcileFact {
  const num = reconcilePromotionLink(feature, issues);
  if (num === null) return 'no-issue';
  const tracker = issues.find(i => i.number === num);
  if (!tracker) return 'no-issue';
  if (issueIsBlocked(tracker)) return 'blocked';
  return issueIsOpen(tracker) ? 'open' : 'closed-unmerged';
}
