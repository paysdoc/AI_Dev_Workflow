/**
 * Pure branch-identity vocabulary for the deterministic fallback.
 *
 * These predicates are the stable, slug-free anchors that let ADW recover an
 * existing branch and its adwId when the canonical comment-based recovery fails.
 * No I/O — all logic is derived from the canonical branchPrefixMap/Aliases.
 */

import type { IssueClassSlashCommand } from '../core';
import { branchPrefixMap, branchPrefixAliases } from '../core';

/**
 * Returns the deterministic, slug-free branch identity for an issue under a classifier.
 *
 * Format: `{prefix}-issue-{N}`, e.g. `feature-issue-641` for `/feature` issue 641.
 * The prefix is drawn from `branchPrefixMap` — never the LLM. This is the stable
 * key the whole fallback uses to discover an existing branch regardless of the slug
 * the original run appended.
 */
export function deterministicBranchName(
  classifier: IssueClassSlashCommand,
  issueNumber: number,
): string {
  return `${branchPrefixMap[classifier]}-issue-${issueNumber}`;
}

/**
 * Returns true when `branchName` belongs to the given issue under the given classifier,
 * ignoring the slug tail but exact on the issue number and prefix.
 *
 * A branch matches when it equals `{prefix}-issue-{N}` (no slug) or starts with
 * `{prefix}-issue-{N}-` (any slug). Both the canonical prefix and the classifier's
 * aliases are accepted. The issue-number boundary is enforced: `feature-issue-641`
 * matches issue 641 but `feature-issue-6410` and `feature-issue-64` do not.
 *
 * A different classifier prefix → false, making re-classification produce a new
 * branch (the intended, accepted outcome).
 */
export function branchMatchesIssue(
  branchName: string,
  classifier: IssueClassSlashCommand,
  issueNumber: number,
): boolean {
  const canonical = branchPrefixMap[classifier];
  const aliases = branchPrefixAliases[classifier];
  const allPrefixes = [canonical, ...aliases];

  for (const prefix of allPrefixes) {
    const base = `${prefix}-issue-${issueNumber}`;
    if (branchName === base || branchName.startsWith(`${base}-`)) {
      return true;
    }
  }

  return false;
}
