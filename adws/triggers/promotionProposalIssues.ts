/**
 * The Promotion Proposals and promotion implementation issues of a repository as the forge lists them, shared by the weekly
 * pass, which decides from all proposals whether to file another, the decision pass, which acts on each decided or expired
 * one, and the Per-Issue Sweep, which keeps the candidates of the undecided proposals and the scenarios of the open
 * implementation issues.
 */

import type { IssueListEntry, IssueTracker } from '@paysdoc/devplatform';
import type { LogLevel } from '../core';
import { ADW_PROMOTION_PROPOSAL_LABEL, ADW_REGRESSION_PROMOTION_LABEL } from '../core/adwLabels';
import type { NominationKey } from '../promotion/nominationCollector';
import { sweepExemptCandidates, type DecisionProposalRef, type ProposalCloseReason } from '../promotion/promotionDecider';
import type { ImplementationIssueRef } from '../promotion/promotionImplementationIssue';
import type { ProposalIssueRef } from '../promotion/proposalPassDecision';

/** No `sort:` qualifier: the forge's test shadow reads only `label:` and `reason:` qualifiers, and every other word as text the title or body must hold. */
export const PROMOTION_PROPOSAL_SEARCH = `label:"${ADW_PROMOTION_PROPOSAL_LABEL}"`;
/** The forge's port carries no close reason, so its issue search reads it, one listing per reason. */
export const PROPOSAL_NOT_PLANNED_SEARCH = `${PROMOTION_PROPOSAL_SEARCH} reason:"not planned"`;
export const PROPOSAL_COMPLETED_SEARCH = `${PROMOTION_PROPOSAL_SEARCH} reason:completed`;
export const PROMOTION_IMPLEMENTATION_SEARCH = `label:"${ADW_REGRESSION_PROMOTION_LABEL}"`;
/** About two years of weekly proposals. */
export const PROPOSAL_LIST_LIMIT = 100;

type Logger = (msg: string, level?: LogLevel) => void;
type IssueLister = Pick<IssueTracker, 'listIssues'>;

function carriesLabel(entry: IssueListEntry, name: string): boolean {
  return (entry.labels ?? []).some((label) => label.name === name);
}

function carriesProposalLabel(entry: IssueListEntry): boolean {
  return carriesLabel(entry, ADW_PROMOTION_PROPOSAL_LABEL);
}

function proposalRef({ number, body, state, createdAt }: IssueListEntry): ProposalIssueRef {
  return { number, body: body ?? '', state, createdAt };
}

/** Throws when the forge cannot list issues; the caller owns the swallow policy. */
export function listPromotionProposals(issueTracker: IssueLister, state: 'open' | 'all'): readonly ProposalIssueRef[] {
  return issueTracker
    .listIssues({ fields: ['number', 'body', 'state', 'labels', 'createdAt'], state, search: PROMOTION_PROPOSAL_SEARCH, limit: PROPOSAL_LIST_LIMIT })
    .filter(carriesProposalLabel)
    .map(proposalRef);
}

/** A proposal listed as not planned reads so even when it is also listed as completed: a decline is the safe side. */
export function closeReasonOf(number: number, notPlanned: ReadonlySet<number>, completed: ReadonlySet<number>): ProposalCloseReason {
  if (notPlanned.has(number)) return 'not_planned';
  if (completed.has(number)) return 'completed';
  return 'unread';
}

function closedProposalNumbers(issueTracker: IssueLister, search: string): ReadonlySet<number> {
  const closed = issueTracker.listIssues({ fields: ['number', 'labels'], state: 'closed', search, limit: PROPOSAL_LIST_LIMIT });
  return new Set(closed.filter(carriesProposalLabel).map((entry) => entry.number));
}

/** Every Promotion Proposal, open or closed, with its comments and the reason it was closed for. Throws when the forge cannot list. */
export function listDecisionProposals(issueTracker: IssueLister): readonly DecisionProposalRef[] {
  const proposals = issueTracker
    .listIssues({ fields: ['number', 'body', 'state', 'labels', 'createdAt', 'comments'], state: 'all', search: PROMOTION_PROPOSAL_SEARCH, limit: PROPOSAL_LIST_LIMIT })
    .filter(carriesProposalLabel);
  const notPlanned = closedProposalNumbers(issueTracker, PROPOSAL_NOT_PLANNED_SEARCH);
  const completed = closedProposalNumbers(issueTracker, PROPOSAL_COMPLETED_SEARCH);
  return proposals.map((entry) => ({
    ...proposalRef(entry),
    closeReason: closeReasonOf(entry.number, notPlanned, completed),
    comments: (entry.comments ?? []).map((comment) => comment.body),
  }));
}

/** Throws when the forge cannot list issues. */
export function listImplementationIssues(issueTracker: IssueLister, state: 'open' | 'all'): readonly ImplementationIssueRef[] {
  return issueTracker
    .listIssues({ fields: ['number', 'body', 'state', 'labels'], state, search: PROMOTION_IMPLEMENTATION_SEARCH, limit: PROPOSAL_LIST_LIMIT })
    .filter((entry) => carriesLabel(entry, ADW_REGRESSION_PROMOTION_LABEL))
    .map(({ number, body, state: issueState }) => ({ number, body: body ?? '', state: issueState }));
}

/** Throws when the forge cannot list issues. */
export function readSweepExemptCandidates(issueTracker: IssueLister): readonly NominationKey[] {
  return sweepExemptCandidates(listDecisionProposals(issueTracker), listImplementationIssues(issueTracker, 'open'));
}

/** True, logged, when the issue of a stale Per-Issue Scenario is among `exempt`: the sweep keeps the file this cycle. */
export function keptForPromotion(featurePath: string, issueNumber: number, exempt: ReadonlySet<number>, log: Logger): boolean {
  if (!exempt.has(issueNumber)) return false;
  log(`perIssueScenarioSweep: keeping stale scenario ${featurePath} (issue #${issueNumber}): a candidate of an undecided Promotion Proposal or of an open promotion implementation issue`, 'info');
  return true;
}

/** The issues whose stale Per-Issue Scenario the sweep keeps, or null, logged, when the open proposals cannot be read. Never throws. */
export function readSweepExemptIssues(read: () => readonly NominationKey[], log: Logger): ReadonlySet<number> | null {
  try {
    return new Set(read().map((candidate) => candidate.issueNumber));
  } catch (error) {
    log(`perIssueScenarioSweep: could not read the open Promotion Proposal (${error}) — nothing removed this cycle`, 'warn');
    return null;
  }
}
