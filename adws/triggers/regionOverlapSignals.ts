/**
 * Side-effecting boundary for region-overlap serialization.
 *
 * The pure decision lives in regionOverlap.ts. This module performs the GitHub
 * I/O that makes a serialization decision DURABLE and AUDITABLE: it registers an
 * annotated `## Blocked by #N` dependency on the deferred issue and posts a
 * one-time explanatory comment. Enforcement (every cron cycle, via
 * findOpenDependencies) and unblocking (on blocker close, via
 * handleIssueClosedDependencyUnblock) then ride the existing declared-dependency
 * path — no new enforcement code.
 */
import type { IssueTracker } from '../providers/types';
import { log } from '../core';
import type { OverlapDeferral } from './cronIssueFilter';

/** Annotation that makes an auto-added Blocked-by ref identifiable and idempotent. */
export const REGION_OVERLAP_MARKER = '<!-- adw:region-overlap -->';

/** The tracker surface region-overlap registration needs — a bound provider, no repository parameter to get wrong. */
export type RegionOverlapRegistrationDeps = Pick<IssueTracker, 'updateIssueBody' | 'commentOnIssue'>;

/** The annotated blocked-by reference line for a given blocker. */
export function blockedByRef(blockedBy: number): string {
  return `#${blockedBy} ${REGION_OVERLAP_MARKER}`;
}

/**
 * Inserts the annotated ref so BOTH dependency parsers resolve it:
 *  - when a `## Dependencies`/`## Depends on`/`## Blocked by` heading exists,
 *    insert the ref immediately AFTER that first heading line (so the
 *    heading-only parseDependencies used by the unblock path picks it up even
 *    when the section already says "None - can start immediately");
 *  - otherwise append a fresh `## Blocked by` section.
 */
export function buildBlockedByBody(currentBody: string, blockedBy: number): string {
  const ref = blockedByRef(blockedBy);
  const headingPattern = /^## (?:dependencies|depends on|blocked by)\b.*$/im;
  const match = currentBody.match(headingPattern);
  if (match && match.index !== undefined) {
    const insertAt = match.index + match[0].length;
    return `${currentBody.slice(0, insertAt)}\n${ref}${currentBody.slice(insertAt)}`;
  }
  return `${currentBody.trimEnd()}\n\n## Blocked by\n${ref}\n`;
}

/** One-time explanatory comment naming the blocker and the overlapping paths. */
export function formatRegionOverlapComment(deferral: OverlapDeferral): string {
  const paths = deferral.overlapPaths.length > 0
    ? deferral.overlapPaths.map(p => `- \`${p}\``).join('\n')
    : '- (overlapping paths unavailable)';
  return [
    `⏸️ **Deferred behind #${deferral.blockedBy} — overlapping code region**`,
    '',
    `ADW detected that this issue edits code overlapping with #${deferral.blockedBy}, which is `
      + `already in flight. To avoid building on a stale base (and the forced rebase / non-fast-forward `
      + `push deadlock that follows), it has been serialized behind #${deferral.blockedBy} by `
      + `registering a \`## Blocked by\` dependency.`,
    '',
    'Overlapping paths:',
    paths,
    '',
    `This issue will spawn automatically once #${deferral.blockedBy} merges and closes. `
      + `To override, remove the \`${blockedByRef(deferral.blockedBy)}\` line from this issue body.`,
  ].join('\n');
}

/**
 * Idempotently registers the region-overlap blocker on the deferred issue and
 * posts a one-time explanatory comment. Returns true when it registered (first
 * time), false when already present or on a handled failure.
 *
 * Fail-safe: updateIssueBody rethrows, so a write failure is caught and logged —
 * the in-memory deferral already excluded the issue this cycle (no parallel
 * spawn), and the next cycle retries. The comment is posted only on first
 * successful registration, so it is one-time.
 */
export function registerRegionOverlapBlocker(
  deferral: OverlapDeferral,
  currentBody: string,
  tracker: RegionOverlapRegistrationDeps,
): boolean {
  if (currentBody.includes(blockedByRef(deferral.blockedBy))) {
    return false; // already registered — no double-append, no duplicate comment
  }
  try {
    tracker.updateIssueBody(deferral.issueNumber, buildBlockedByBody(currentBody, deferral.blockedBy));
    tracker.commentOnIssue(deferral.issueNumber, formatRegionOverlapComment(deferral));
    log(`Registered region-overlap blocker #${deferral.blockedBy} on issue #${deferral.issueNumber}`, 'success');
    return true;
  } catch (err) {
    log(`Failed to register region-overlap blocker on issue #${deferral.issueNumber}: ${err}`, 'warn');
    return false;
  }
}
