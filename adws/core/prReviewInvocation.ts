/**
 * The pr-review orchestrator's branch→PR/adwId resolution — lifted out of
 * `adwPrReview.tsx`'s `main()` (#820, FINDING 4) so it can run AFTER the
 * launch boundary is built (the boundary provides `findPullRequestByBranch`)
 * and be driven from a test. Returns a result instead of calling
 * `process.exit` — the three branches and their message texts are verbatim
 * from the legacy `resolvePrReviewInvocation`.
 */

import type { AgentState } from '../types/agentTypes';

export interface PrReviewInvocationDeps {
  readTopLevelState(adwId: string): AgentState | null;
  findPullRequestByBranch(branchName: string): { number: number } | null;
  resolveSpawn(prNumber: number): { adwId: string } | null;
}

export type PrReviewInvocation =
  | { readonly kind: 'run'; readonly prNumber: number; readonly adwId: string }
  | { readonly kind: 'skip'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Resolves a pr-review invocation from CLI positionals:
 *  - Canonical form `<issueNumber> <adwId>` — second positional is a non-numeric adwId; resumes via the persisted branch name.
 *  - Manual fallback `<pr-number>` — routed through `deps.resolveSpawn` to find the linked issue's adwId.
 */
export function resolvePrReviewInvocation(positionals: string[], deps: PrReviewInvocationDeps): PrReviewInvocation {
  if (positionals.length >= 2 && isNaN(parseInt(positionals[1], 10))) {
    const adwId = positionals[1];
    const state = deps.readTopLevelState(adwId);
    const branchName = state?.branchName;
    if (!branchName) {
      return { kind: 'error', message: `Resume adwId ${adwId} has no persisted branchName in top-level state` };
    }
    const pr = deps.findPullRequestByBranch(branchName);
    if (!pr) {
      return { kind: 'error', message: `Could not resolve PR for branch ${branchName} (adwId ${adwId})` };
    }
    return { kind: 'run', prNumber: pr.number, adwId };
  }

  const prNumber = parseInt(positionals[0], 10);
  if (isNaN(prNumber)) {
    return { kind: 'error', message: `Invalid PR number: ${positionals[0]}` };
  }
  const target = deps.resolveSpawn(prNumber);
  if (target === null) {
    return { kind: 'skip', message: `PR #${prNumber} is not issue-linked — skipping` };
  }
  return { kind: 'run', prNumber, adwId: target.adwId };
}
