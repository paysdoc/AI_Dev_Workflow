/**
 * The Promotion Proposals of a repository as the forge lists them, shared by the weekly pass, which decides from all of them
 * whether to file another, and the Per-Issue Sweep, which keeps the candidates of the open ones.
 */

import type { IssueListEntry, IssueTracker } from '@paysdoc/devplatform';
import type { LogLevel } from '../core';
import { ADW_PROMOTION_PROPOSAL_LABEL } from '../core/adwLabels';
import type { NominationKey } from '../promotion/nominationCollector';
import { openProposalCandidates, type ProposalIssueRef } from '../promotion/proposalPassDecision';

/** No `sort:` or other qualifier: the forge's test shadow reads every word but a label qualifier as text the title or body must hold. */
export const PROMOTION_PROPOSAL_SEARCH = `label:"${ADW_PROMOTION_PROPOSAL_LABEL}"`;
/** About two years of weekly proposals. */
export const PROPOSAL_LIST_LIMIT = 100;

type Logger = (msg: string, level?: LogLevel) => void;

function carriesProposalLabel(entry: IssueListEntry): boolean {
  return (entry.labels ?? []).some((label) => label.name === ADW_PROMOTION_PROPOSAL_LABEL);
}

function proposalRef({ number, body, state, createdAt }: IssueListEntry): ProposalIssueRef {
  return { number, body: body ?? '', state, createdAt };
}

/** Throws when the forge cannot list issues; the caller owns the swallow policy. */
export function listPromotionProposals(issueTracker: Pick<IssueTracker, 'listIssues'>, state: 'open' | 'all'): readonly ProposalIssueRef[] {
  return issueTracker
    .listIssues({ fields: ['number', 'body', 'state', 'labels', 'createdAt'], state, search: PROMOTION_PROPOSAL_SEARCH, limit: PROPOSAL_LIST_LIMIT })
    .filter(carriesProposalLabel)
    .map(proposalRef);
}

/** Throws when the forge cannot list issues. */
export function readOpenProposalCandidates(issueTracker: Pick<IssueTracker, 'listIssues'>): readonly NominationKey[] {
  return openProposalCandidates(listPromotionProposals(issueTracker, 'open'));
}

/** True, logged, when the issue of a stale Per-Issue Scenario is among `exempt`: the sweep keeps the file this cycle. */
export function keptForOpenProposal(featurePath: string, issueNumber: number, exempt: ReadonlySet<number>, log: Logger): boolean {
  if (!exempt.has(issueNumber)) return false;
  log(`perIssueScenarioSweep: keeping stale scenario ${featurePath} (issue #${issueNumber}): a candidate of an open Promotion Proposal`, 'info');
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
