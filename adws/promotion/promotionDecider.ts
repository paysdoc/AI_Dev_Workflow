/**
 * Pure. Rules on each Promotion Proposal from its state, its ticked candidates and its age, picks what one decision pass does
 * about the proposals the forge lists, and says which candidates the Per-Issue Sweep keeps. Only a close as completed approves,
 * and only the candidates ticked at that moment; a close the forge's search has not yet read waits, so a lagging index can
 * never turn a "not planned" into an approval.
 */

import type { NominationKey } from './nominationCollector.ts';
import { implementationIssueCandidates, type ImplementationIssueRef } from './promotionImplementationIssue.ts';
import { PROMOTION_PROPOSAL_EXPIRY_DAYS, isSameCandidate, readProposalCandidates, type ProposalCandidateReading } from './proposalBody.ts';
import { hasDecisionRecord, readDecisionRecord } from './proposalDecisionRecord.ts';
import { isOpenProposal, proposedCandidates, type ProposalIssueRef } from './proposalPassDecision.ts';

export enum ProposalState {
  Open = 'open',
  ClosedAsCompleted = 'closed_as_completed',
  ClosedAsNotPlanned = 'closed_as_not_planned',
  ClosedForUnreadReason = 'closed_for_unread_reason',
}

/** How the forge says a closed proposal was closed; `unread` while its search does not list the proposal under either reason. */
export type ProposalCloseReason = 'completed' | 'not_planned' | 'unread';

export enum DeclineReason {
  NotPlanned = 'not_planned',
  NothingTicked = 'nothing_ticked',
  Expired = 'expired',
}

export type PromotionDecision =
  | { readonly kind: 'wait' }
  | { readonly kind: 'approve'; readonly approved: readonly NominationKey[]; readonly declined: readonly NominationKey[] }
  | { readonly kind: 'decline'; readonly reason: DeclineReason; readonly declined: readonly NominationKey[] };

export interface DecisionProposalRef extends ProposalIssueRef {
  /** Ignored while the proposal is open. */
  readonly closeReason: ProposalCloseReason;
  readonly comments: readonly string[];
}

export interface PromotionDecisionInput {
  readonly state: ProposalState;
  readonly candidates: readonly ProposalCandidateReading[];
  /** Null when the forge gave none that parses: such a proposal never expires. */
  readonly createdAt: Date | null;
  readonly now: Date;
}

export type ProposalAction =
  | { readonly kind: 'decide'; readonly proposal: DecisionProposalRef; readonly decision: Exclude<PromotionDecision, { kind: 'wait' }> }
  | { readonly kind: 'close_again'; readonly proposal: DecisionProposalRef };

const DAY_MS = 86_400_000;

const CLOSED_STATES: Readonly<Record<ProposalCloseReason, ProposalState>> = {
  completed: ProposalState.ClosedAsCompleted,
  not_planned: ProposalState.ClosedAsNotPlanned,
  unread: ProposalState.ClosedForUnreadReason,
};

export function proposalStateOf(state: string | undefined, closeReason: ProposalCloseReason): ProposalState {
  return isOpenProposal({ state }) ? ProposalState.Open : CLOSED_STATES[closeReason];
}

function keyOf({ issueNumber, scenarioName }: NominationKey): NominationKey {
  return { issueNumber, scenarioName };
}

function declineAll(reason: DeclineReason, candidates: readonly ProposalCandidateReading[]): PromotionDecision {
  return { kind: 'decline', reason, declined: candidates.map(keyOf) };
}

function hasExpired(createdAt: Date | null, now: Date): boolean {
  return createdAt !== null && now.getTime() - createdAt.getTime() >= PROMOTION_PROPOSAL_EXPIRY_DAYS * DAY_MS;
}

/** Ticks count only once the owner closes the proposal as completed; age decides only a proposal no close has decided. */
export function decidePromotion({ state, candidates, createdAt, now }: PromotionDecisionInput): PromotionDecision {
  if (state === ProposalState.ClosedAsNotPlanned) return declineAll(DeclineReason.NotPlanned, candidates);

  const ticked = candidates.filter((candidate) => candidate.ticked);
  if (state === ProposalState.ClosedAsCompleted && ticked.length === 0) return declineAll(DeclineReason.NothingTicked, candidates);
  if (state === ProposalState.ClosedAsCompleted) {
    return { kind: 'approve', approved: ticked.map(keyOf), declined: candidates.filter((candidate) => !candidate.ticked).map(keyOf) };
  }

  if (hasExpired(createdAt, now)) return declineAll(DeclineReason.Expired, candidates);
  return { kind: 'wait' };
}

function createdAtOf(proposal: ProposalIssueRef): Date | null {
  const createdAt = new Date(proposal.createdAt ?? Number.NaN);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
}

/** A recorded proposal is never decided again; one ADW expired is only closed again while it is still open. */
function actionOf(proposal: DecisionProposalRef, now: Date): ProposalAction | null {
  const recorded = readDecisionRecord(proposal.comments);
  if (recorded !== null) return recorded === 'expired' && isOpenProposal(proposal) ? { kind: 'close_again', proposal } : null;

  const state = proposalStateOf(proposal.state, proposal.closeReason);
  const decision = decidePromotion({ state, candidates: readProposalCandidates(proposal.body), createdAt: createdAtOf(proposal), now });
  return decision.kind === 'wait' ? null : { kind: 'decide', proposal, decision };
}

function isAction(action: ProposalAction | null): action is ProposalAction {
  return action !== null;
}

/** What one pass does about the listed proposals, in ascending proposal number. */
export function proposalActions(proposals: readonly DecisionProposalRef[], now: Date): readonly ProposalAction[] {
  return [...proposals]
    .sort((a, b) => a.number - b.number)
    .map((proposal) => actionOf(proposal, now))
    .filter(isAction);
}

function withoutDuplicates(keys: readonly NominationKey[], key: NominationKey): readonly NominationKey[] {
  return keys.some((known) => isSameCandidate(known, key)) ? keys : [...keys, key];
}

/**
 * The candidates the Per-Issue Sweep keeps: every candidate of a proposal not yet acted on, open or closed, and every scenario
 * an open implementation issue promotes. A decided proposal's declined candidates lose the exemption; its approved ones keep it
 * through their implementation issue until that issue is closed.
 */
export function sweepExemptCandidates(proposals: readonly DecisionProposalRef[], implementationIssues: readonly ImplementationIssueRef[]): readonly NominationKey[] {
  const undecided = proposals.filter((proposal) => !hasDecisionRecord(proposal.comments));
  const promoting = implementationIssues.filter(isOpenProposal).flatMap(implementationIssueCandidates);
  return [...proposedCandidates(undecided), ...promoting].reduce(withoutDuplicates, []);
}
