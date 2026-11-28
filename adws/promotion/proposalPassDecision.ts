/**
 * Pure. What the weekly Promotion Proposal pass decides from the proposals the forge lists: whether it may file one, and which
 * Nominations it offers. The week is measured from the newest proposal on the forge, so a cron restart cannot reset it.
 */

import { NominationState, type Nomination, type NominationKey } from './nominationCollector.ts';
import { isSameCandidate, readProposalCandidates } from './proposalBody.ts';

/** Keeps one proposal, and the one analysis run behind it, small; the rest wait for a later proposal. */
export const MAX_PROPOSAL_CANDIDATES = 12;

const DAY_MS = 86_400_000;

export interface ProposalIssueRef {
  readonly number: number;
  readonly body: string;
  /** 'OPEN' or 'CLOSED', compared without case; absent ⇒ open. */
  readonly state?: string;
  /** ISO 8601; a proposal without a readable one takes no part in the weekly rhythm. */
  readonly createdAt?: string;
}

export type ProposalPassBlocker =
  | { readonly kind: 'proposal_open'; readonly issueNumber: number }
  | { readonly kind: 'proposed_recently'; readonly issueNumber: number; readonly createdAt: Date };

export interface ProposalCandidateSelection {
  readonly selected: readonly Nomination[];
  /** Nominations awaiting a proposal beyond the cap, offered by a later one. */
  readonly deferred: number;
}

interface DatedProposal {
  readonly issueNumber: number;
  readonly createdAt: Date;
}

export function isOpenProposal(ref: Pick<ProposalIssueRef, 'state'>): boolean {
  return ref.state === undefined || ref.state.toUpperCase() === 'OPEN';
}

function datedProposal(ref: ProposalIssueRef): DatedProposal | null {
  const createdAt = new Date(ref.createdAt ?? Number.NaN);
  return Number.isNaN(createdAt.getTime()) ? null : { issueNumber: ref.number, createdAt };
}

function isDated(proposal: DatedProposal | null): proposal is DatedProposal {
  return proposal !== null;
}

function newestDated(proposals: readonly ProposalIssueRef[]): DatedProposal | null {
  const dated = proposals.map(datedProposal).filter(isDated);
  if (dated.length === 0) return null;
  return dated.reduce((newest, proposal) => (proposal.createdAt.getTime() > newest.createdAt.getTime() ? proposal : newest));
}

/** Null when the pass may file: no proposal is open and none was filed less than `intervalDays` before `now`. */
export function proposalPassBlocker(proposals: readonly ProposalIssueRef[], now: Date, intervalDays: number): ProposalPassBlocker | null {
  const open = proposals.filter(isOpenProposal);
  if (open.length > 0) return { kind: 'proposal_open', issueNumber: Math.min(...open.map((proposal) => proposal.number)) };

  const newest = newestDated(proposals);
  if (newest === null || now.getTime() - newest.createdAt.getTime() >= intervalDays * DAY_MS) return null;
  return { kind: 'proposed_recently', ...newest };
}

function withoutDuplicates(keys: readonly NominationKey[], key: NominationKey): readonly NominationKey[] {
  return keys.some((known) => isSameCandidate(known, key)) ? keys : [...keys, key];
}

function candidatesOf(proposal: ProposalIssueRef): readonly NominationKey[] {
  return readProposalCandidates(proposal.body).map(({ issueNumber, scenarioName }) => ({ issueNumber, scenarioName }));
}

/** Every candidate any listed proposal named, open or closed, once each. */
export function proposedCandidates(proposals: readonly ProposalIssueRef[]): readonly NominationKey[] {
  return proposals.flatMap(candidatesOf).reduce(withoutDuplicates, []);
}

/** The Nominations awaiting a proposal that no listed proposal named, in the collector's order, capped. */
export function selectProposalCandidates(nominations: readonly Nomination[], alreadyProposed: readonly NominationKey[]): ProposalCandidateSelection {
  const awaiting = nominations
    .filter((nomination) => nomination.state === NominationState.AwaitingProposal)
    .filter((nomination) => !alreadyProposed.some((key) => isSameCandidate(key, nomination)));
  return { selected: awaiting.slice(0, MAX_PROPOSAL_CANDIDATES), deferred: Math.max(0, awaiting.length - MAX_PROPOSAL_CANDIDATES) };
}
