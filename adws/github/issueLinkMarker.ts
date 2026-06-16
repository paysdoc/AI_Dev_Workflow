/**
 * Canonical issue-link marker contract for PR bodies.
 *
 * ADW PR bodies reference their originating issue with GitHub closing keywords.
 * The SDLC PR template (.claude/commands/pull_request.md) emits a bare
 * `Implements #N` plus a closing keyword — repo-qualified `Closes owner/repo#N`
 * when the issue lives in a known repo, or the same-repo fallback `Closes #N`.
 *
 * Several consumers must recognise that an arbitrary PR body links a given issue:
 *   - hitlBoardNotifier.findReviewPr (HITL review Slack notification)
 *   - linkedPrDetector.hasLinkedMergedOrClosedPR
 *   - perIssueScenarioSweep (14-day per-issue scenario retention clock)
 *
 * This module is the single source of truth for that match so the keyword set,
 * the optional owner/repo qualifier, and the digit-boundary guard can never
 * drift between call sites again.
 */

/**
 * Builds a regex matching a `Closes`/`Implements` reference to `issueNumber`,
 * tolerating an optional `owner/repo` qualifier between the keyword and `#N`
 * (e.g. `Closes paysdoc/AI_Dev_Workflow#578`), with a trailing digit-boundary
 * guard so `#1` does not match inside `#12`.
 */
export function issueLinkPattern(issueNumber: number): RegExp {
  return new RegExp(`(Closes|Implements) ([\\w.-]+/[\\w.-]+)?#${issueNumber}(?!\\d)`);
}

/** Returns true when `body` links `issueNumber` via a recognised closing keyword. */
export function bodyLinksIssue(body: string | null | undefined, issueNumber: number): boolean {
  return issueLinkPattern(issueNumber).test(body ?? '');
}
