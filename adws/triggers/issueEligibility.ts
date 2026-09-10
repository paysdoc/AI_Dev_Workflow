/**
 * Shared issue eligibility checker.
 *
 * Combines dependency checking and concurrency limiting into a single
 * eligibility result. Used by both webhook and cron triggers.
 */

import type { BoundProviders } from '../providers/types';
import { findOpenDependencies } from './issueDependencies';
import { isConcurrencyLimitReached } from './concurrencyGuard';
import { log } from '../core';

/** The provider surface an eligibility check needs. */
export type EligibilityProviders = Pick<BoundProviders, 'issueTracker' | 'codeHost'>;

/** Result of an issue eligibility check. */
export interface EligibilityResult {
  eligible: boolean;
  reason?: 'open_dependencies' | 'concurrency_limit';
  blockingIssues?: number[];
}

/**
 * Checks whether an issue is eligible for processing.
 * 1. Checks for open dependencies — if any, returns ineligible.
 * 2. Checks concurrency limit — if reached, returns ineligible.
 * 3. If both pass, returns eligible.
 */
export async function checkIssueEligibility(
  issueNumber: number,
  issueBody: string,
  providers: EligibilityProviders,
): Promise<EligibilityResult> {
  log(`Checking eligibility for issue #${issueNumber}`);

  // Check dependencies first
  const openDeps = await findOpenDependencies(issueBody, providers.issueTracker);
  if (openDeps.length > 0) {
    return {
      eligible: false,
      reason: 'open_dependencies',
      blockingIssues: openDeps,
    };
  }

  // Check concurrency limit
  const limitReached = await isConcurrencyLimitReached(providers);
  if (limitReached) {
    return {
      eligible: false,
      reason: 'concurrency_limit',
    };
  }

  return { eligible: true };
}
