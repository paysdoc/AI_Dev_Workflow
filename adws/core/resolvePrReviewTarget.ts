import { extractLatestAdwId } from './workflowCommentParsing';

export interface PrReviewTargetInput {
  readonly issueNumber: number | null;
  readonly title: string;
}

export interface PrReviewTargetDeps {
  readonly fetchIssueComments: (issueNumber: number) => { body: string }[];
  readonly generateAdwId: (summary?: string) => string;
}

export type PrReviewTarget =
  | { readonly kind: 'reuse'; readonly issueNumber: number; readonly adwId: string }
  | { readonly kind: 'fresh'; readonly issueNumber: number; readonly adwId: string }
  | { readonly kind: 'skip'; readonly reason: string };

export function resolvePrReviewTarget(pr: PrReviewTargetInput, deps: PrReviewTargetDeps): PrReviewTarget {
  if (pr.issueNumber === null) {
    return { kind: 'skip', reason: 'not-issue-linked' };
  }
  const existing = extractLatestAdwId(deps.fetchIssueComments(pr.issueNumber));
  if (existing !== null) {
    return { kind: 'reuse', issueNumber: pr.issueNumber, adwId: existing };
  }
  return { kind: 'fresh', issueNumber: pr.issueNumber, adwId: deps.generateAdwId(pr.title) };
}
