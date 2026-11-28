/**
 * Pure. The comment ADW leaves on a Promotion Proposal it acted on. It tells the owner what ADW did, and its hidden marker is
 * the durable record that the proposal was acted on: a proposal that carries one is never acted on again, so a cron restart
 * cannot repeat a decision.
 */

import { codeSpan } from '../core/unusedStepIssueBody.ts';
import type { NominationKey } from './nominationCollector.ts';
import type { DeclineReason } from './promotionDecider.ts';
import { PROMOTION_PROPOSAL_EXPIRY_DAYS } from './proposalBody.ts';

export const PROPOSAL_DECISION_MARKER = 'adw-proposal-decision';

export type DecisionOutcome = 'approved' | 'declined' | 'expired';

export interface DecisionCommentInput {
  readonly outcome: DecisionOutcome;
  readonly reason?: DeclineReason;
  readonly approved: readonly NominationKey[];
  readonly declined: readonly NominationKey[];
  /** Approved, but no longer on the default branch, so not promoted. */
  readonly missing: readonly NominationKey[];
  readonly implementationIssue: number | null;
}

const OUTCOMES: readonly DecisionOutcome[] = ['approved', 'declined', 'expired'];
const DECISION_MARKER = new RegExp(`<!--\\s*${PROPOSAL_DECISION_MARKER}:([\\w-]+)\\s*-->`);

const DECLINE_SUMMARIES: Readonly<Record<DeclineReason, string>> = {
  not_planned: 'This Promotion Proposal was closed as not planned, so ADW declined every candidate.',
  nothing_ticked: 'This Promotion Proposal was closed as completed with nothing ticked, so ADW declined every candidate.',
  expired: `This Promotion Proposal was open for ${PROMOTION_PROPOSAL_EXPIRY_DAYS} days without a decision, so ADW declined every candidate and closed it.`,
};

const UNEXPLAINED_DECLINE = 'ADW declined every candidate of this Promotion Proposal.';

const DECLINED_FOLLOW_UP =
  'The declined scenarios now carry `@nomination-declined`: the Per-Issue Sweep removes them on its 14-day rule, and no later Promotion Proposal offers them.';

/** Text in a name can neither open nor close a hidden comment, so it can never forge a marker. */
function candidateLine({ issueNumber, scenarioName }: NominationKey): string {
  const escaped = scenarioName.replace(/<!--/g, '&lt;!--').replace(/-->/g, '--&gt;');
  return `- #${issueNumber} · ${codeSpan(escaped)}`;
}

function listed(heading: string, keys: readonly NominationKey[]): string[] {
  return keys.length === 0 ? [] : [heading, '', ...keys.map(candidateLine), ''];
}

function scenarios(count: number): string {
  return `${count} scenario${count === 1 ? '' : 's'}`;
}

function approvalSummary({ approved, missing, implementationIssue }: DecisionCommentInput): string {
  const ticked = `ADW approved the ${scenarios(approved.length + missing.length)} ticked when this Promotion Proposal was closed as completed`;
  if (implementationIssue === null) return `${ticked}, but none of them is on the default branch any more, so it filed no implementation issue.`;
  return `${ticked} and filed #${implementationIssue} to move them into the Regression Suite.`;
}

function summaryOf(input: DecisionCommentInput): string {
  if (input.outcome === 'approved') return approvalSummary(input);
  if (input.reason !== undefined) return DECLINE_SUMMARIES[input.reason];
  return input.outcome === 'expired' ? DECLINE_SUMMARIES.expired : UNEXPLAINED_DECLINE;
}

export function buildDecisionComment(input: DecisionCommentInput): string {
  return [
    `**${summaryOf(input)}**`,
    '',
    ...listed('**Approved:**', input.approved),
    ...listed('**Approved, but no longer on the default branch, so not promoted:**', input.missing),
    ...listed('**Declined:**', input.declined),
    ...(input.declined.length > 0 ? [DECLINED_FOLLOW_UP, ''] : []),
    `<!-- ${PROPOSAL_DECISION_MARKER}:${input.outcome} -->`,
  ].join('\n');
}

/** Any marker means the proposal was acted on, so one whose outcome is unknown reads as declined. */
function outcomeIn(comment: string): DecisionOutcome | null {
  const recorded = DECISION_MARKER.exec(comment)?.[1];
  if (recorded === undefined) return null;
  return OUTCOMES.find((outcome) => outcome === recorded) ?? 'declined';
}

/** The outcome of the first comment that holds a decision marker, or null when none does. Never throws. */
export function readDecisionRecord(comments: readonly string[]): DecisionOutcome | null {
  return comments.map(outcomeIn).find((outcome) => outcome !== null) ?? null;
}

export function hasDecisionRecord(comments: readonly string[]): boolean {
  return readDecisionRecord(comments) !== null;
}
