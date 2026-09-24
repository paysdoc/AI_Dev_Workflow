import { log } from '../core/logger';
import type { CodeHost } from '@paysdoc/devplatform';
import { bodyLinksIssue } from './issueLinkMarker';

export interface LinkedPRRef {
  readonly number: number;
  readonly body: string;
  readonly state: string;
  readonly mergedAt: string | null;
}

/**
 * Returns true when at least one PR in `prs` links `issueNumber` via a
 * recognised closing keyword (see issueLinkMarker) and is merged
 * (`mergedAt != null`) or CLOSED.
 */
export function hasLinkedMergedOrClosedPR(
  issueNumber: number,
  prs: readonly LinkedPRRef[],
): boolean {
  return prs.some(
    (pr) =>
      bodyLinksIssue(pr.body, issueNumber) &&
      (pr.mergedAt != null || pr.state === 'CLOSED'),
  );
}

/**
 * Returns [] on error to allow callers to degrade gracefully.
 */
export function fetchLinkedPRs(codeHost: Pick<CodeHost, 'listPullRequests'>): LinkedPRRef[] {
  try {
    return [...codeHost.listPullRequests()];
  } catch (error) {
    log(`Failed to fetch PRs for linked-PR detection: ${error}`, 'error');
    return [];
  }
}
