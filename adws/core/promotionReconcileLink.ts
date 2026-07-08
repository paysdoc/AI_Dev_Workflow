/**
 * Pure reconciliation matcher for the promotion sweep. Parses the
 * `Promotes: feature-N` back-link marker from a promotion issue's body and
 * maps a `feature-N` id to its linked open issue across an injected set of
 * open `regression-promotion` issues (the `gh issue list` call itself is
 * injected by the shell — this module does no I/O).
 */

const PROMOTES_MARKER_RE = /^\s*Promotes:\s*(feature-\d+)\s*$/m;

export interface PromotionIssueRef {
  number: number;
  body: string;
}

/** Extracts the `feature-N` id from a `Promotes: feature-N` marker line, or null when absent. */
export function parsePromotesMarker(body: string): string | null {
  const match = PROMOTES_MARKER_RE.exec(body);
  return match ? match[1] : null;
}

/**
 * Returns the issue number of the open promotion issue linked to `feature` via
 * its `Promotes:` marker, or null when none is linked. When more than one open
 * issue promotes the same feature (a duplicate-filing edge case), the lowest
 * issue number wins — the earliest-filed issue is the canonical tracker.
 */
export function reconcilePromotionLink(feature: string, openIssues: readonly PromotionIssueRef[]): number | null {
  const candidates = openIssues
    .filter(issue => parsePromotesMarker(issue.body) === feature)
    .map(issue => issue.number);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

/** The `open | no-issue` reconciliation-fact subset the originate shell feeds the decider. */
export function reconcileFactFor(feature: string, openIssues: readonly PromotionIssueRef[]): 'open' | 'no-issue' {
  return reconcilePromotionLink(feature, openIssues) !== null ? 'open' : 'no-issue';
}
