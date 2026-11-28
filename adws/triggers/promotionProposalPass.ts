/**
 * The weekly Promotion Proposal pass of one repository. While no proposal is open and none was filed within the interval,
 * it offers the Nominations of merged issues that no earlier proposal named, each with the analysis the agent writes for it,
 * as one issue the owner decides. It reads a checkout of the default branch it never commits to, and removes that checkout
 * on every exit path.
 *
 * Identity comes entirely from the caller's launch boundary (`deps.boundary`); this module resolves none of its own.
 */

import { log as coreLog, PROMOTION_PROPOSAL_INTERVAL_DAYS, type LaunchBoundary, type LogLevel } from '../core';
import { collectNominations, type Nomination, type NominationKey } from '../promotion/nominationCollector';
import { buildPromotionProposal, type CandidateAnalysis, type PromotionCandidate } from '../promotion/proposalBody';
import { proposalPassBlocker, proposedCandidates, selectProposalCandidates, type ProposalIssueRef, type ProposalPassBlocker } from '../promotion/proposalPassDecision';
import { makePromotionProposalDefaults, type PromotionProposalDefaultDeps, type ProposalCheckout } from './promotionProposalDefaults';

type Logger = (msg: string, level?: LogLevel) => void;

export type PromotionProposalPassDeps = {
  boundary: LaunchBoundary;
  now?: Date;
  intervalDays?: number;
  log?: Logger;
} & Partial<PromotionProposalDefaultDeps>;

export type PromotionProposalSkipReason = 'listing_failed' | 'proposal_open' | 'proposed_recently' | 'no_checkout' | 'no_nominations';

export type PromotionProposalPassOutcome =
  | { readonly kind: 'filed'; readonly issueNumber: number; readonly candidates: readonly NominationKey[] }
  | { readonly kind: 'skipped'; readonly reason: PromotionProposalSkipReason }
  | { readonly kind: 'failed'; readonly detail: string };

interface PassContext {
  readonly deps: PromotionProposalDefaultDeps;
  readonly now: Date;
  readonly log: Logger;
}

const LABEL = 'promotionProposalPass';

function skipped(reason: PromotionProposalSkipReason): PromotionProposalPassOutcome {
  return { kind: 'skipped', reason };
}

function resolvedDeps(deps: PromotionProposalPassDeps, log: Logger): PromotionProposalDefaultDeps {
  const defaults = makePromotionProposalDefaults(deps.boundary, log);
  return {
    listProposals: deps.listProposals ?? defaults.listProposals,
    prepareCheckout: deps.prepareCheckout ?? defaults.prepareCheckout,
    readPerIssueFeatures: deps.readPerIssueFeatures ?? defaults.readPerIssueFeatures,
    getMergedAt: deps.getMergedAt ?? defaults.getMergedAt,
    analyse: deps.analyse ?? defaults.analyse,
    fileProposal: deps.fileProposal ?? defaults.fileProposal,
    cleanupCheckout: deps.cleanupCheckout ?? defaults.cleanupCheckout,
  };
}

function listedProposals({ deps, log }: PassContext): readonly ProposalIssueRef[] | null {
  try {
    return deps.listProposals();
  } catch (error) {
    log(`${LABEL}: could not list the Promotion Proposals (${error}) — not filing one this cycle`, 'warn');
    return null;
  }
}

function blockerLine(blocker: ProposalPassBlocker, intervalDays: number): string {
  if (blocker.kind === 'proposal_open') return `${LABEL}: Promotion Proposal #${blocker.issueNumber} is still open — not filing another`;
  const filedOn = blocker.createdAt.toISOString().slice(0, 10);
  return `${LABEL}: Promotion Proposal #${blocker.issueNumber} was filed on ${filedOn}, less than ${intervalDays} days ago — not filing another`;
}

function promotionCandidate(nomination: Nomination, analysis: CandidateAnalysis | undefined): PromotionCandidate {
  if (!analysis) throw new Error(`the analysis gave nothing for #${nomination.issueNumber} "${nomination.scenarioName}"`);
  const { issueNumber, scenarioName, featurePath } = nomination;
  return { issueNumber, scenarioName, featurePath, qualification: analysis.qualification, fit: analysis.fit, overlaps: analysis.overlaps };
}

async function selectedNominations(checkout: ProposalCheckout, proposals: readonly ProposalIssueRef[], { deps, log }: PassContext): Promise<readonly Nomination[]> {
  const nominations = await collectNominations({ features: deps.readPerIssueFeatures(checkout), getMergedAt: deps.getMergedAt });
  const { selected, deferred } = selectProposalCandidates(nominations, proposedCandidates(proposals));
  if (deferred > 0) log(`${LABEL}: ${deferred} more Nomination(s) wait for a later Promotion Proposal`, 'info');
  return selected;
}

async function proposeFrom(checkout: ProposalCheckout, proposals: readonly ProposalIssueRef[], context: PassContext): Promise<PromotionProposalPassOutcome> {
  const { deps, now, log } = context;
  const selected = await selectedNominations(checkout, proposals, context);
  if (selected.length === 0) {
    log(`${LABEL}: no Nomination of a merged issue awaits a Promotion Proposal — not filing one`, 'info');
    return skipped('no_nominations');
  }

  const analyses = await deps.analyse(selected, checkout);
  const candidates = selected.map((nomination, position) => promotionCandidate(nomination, analyses[position]));
  const issueNumber = await deps.fileProposal(buildPromotionProposal(candidates, now));
  log(`${LABEL}: filed Promotion Proposal #${issueNumber} with ${candidates.length} candidate(s)`, 'success');
  return { kind: 'filed', issueNumber, candidates: selected.map(({ issueNumber: issue, scenarioName }) => ({ issueNumber: issue, scenarioName })) };
}

/** Never throws: a forge, checkout, analysis or filing failure ends the pass for this cycle, and the next cycle retries. */
export async function runPromotionProposalPass(passDeps: PromotionProposalPassDeps): Promise<PromotionProposalPassOutcome> {
  const log = passDeps.log ?? coreLog;
  const context: PassContext = { deps: resolvedDeps(passDeps, log), now: passDeps.now ?? new Date(), log };
  const intervalDays = passDeps.intervalDays ?? PROMOTION_PROPOSAL_INTERVAL_DAYS;

  const proposals = listedProposals(context);
  if (proposals === null) return skipped('listing_failed');

  const blocker = proposalPassBlocker(proposals, context.now, intervalDays);
  if (blocker) {
    log(blockerLine(blocker, intervalDays), 'info');
    return skipped(blocker.kind);
  }

  const checkout = context.deps.prepareCheckout();
  if (checkout === null) return skipped('no_checkout');
  try {
    return await proposeFrom(checkout, proposals, context);
  } catch (error) {
    log(`${LABEL}: pass failed, no Promotion Proposal filed: ${error}`, 'error');
    return { kind: 'failed', detail: String(error) };
  } finally {
    context.deps.cleanupCheckout(checkout);
  }
}
