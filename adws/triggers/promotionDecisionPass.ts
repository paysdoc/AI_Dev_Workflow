/**
 * The Promotion Proposal decision pass of one repository. It acts once on each proposal the owner closed, or left open for 30
 * days: it files one implementation issue for the approved candidates still on the default branch, declines the others
 * through an immediately merged pull request from the dedicated decline branch, closes an expired proposal, and leaves on each
 * proposal the decision record that keeps it from being acted on again, also after a cron restart. A failure on one proposal
 * leaves it without a record, so the next pass acts on it again; the filing and the decline are idempotent for that retry.
 *
 * Identity comes entirely from the caller's launch boundary (`deps.boundary`); this module resolves none of its own.
 */

import { log as coreLog, type LaunchBoundary, type LogLevel } from '../core';
import type { FeatureFileSource } from '../proof/featureScenarioIndex';
import type { NominationKey } from '../promotion/nominationCollector';
import { declineNominations, featureOfCandidate } from '../promotion/nominationDecline';
import { DeclineReason, proposalActions, type DecisionProposalRef, type PromotionDecision, type ProposalAction } from '../promotion/promotionDecider';
import { buildPromotionImplementationIssue, implementationIssueFor, type ApprovedScenario } from '../promotion/promotionImplementationIssue';
import { PROMOTION_PROPOSAL_EXPIRY_DAYS, isSameCandidate } from '../promotion/proposalBody';
import { buildDecisionComment } from '../promotion/proposalDecisionRecord';
import { isOpenProposal } from '../promotion/proposalPassDecision';
import type { SweepBase } from './perIssueSweepPersist';
import { makePromotionDecisionDefaults, type NominationDeclineEdit, type PromotionDecisionDefaultDeps } from './promotionDecisionDefaults';

type Logger = (msg: string, level?: LogLevel) => void;

export type PromotionDecisionPassDeps = {
  boundary: LaunchBoundary;
  now?: Date;
  log?: Logger;
} & Partial<PromotionDecisionDefaultDeps>;

export type ProposalDecisionOutcome =
  | {
      readonly kind: 'approved';
      readonly proposal: number;
      readonly implementationIssue: number | null;
      readonly approved: readonly NominationKey[];
      readonly declined: readonly NominationKey[];
      readonly missing: readonly NominationKey[];
    }
  | { readonly kind: 'declined'; readonly proposal: number; readonly reason: DeclineReason; readonly declined: readonly NominationKey[] }
  | { readonly kind: 'closed_again'; readonly proposal: number }
  | { readonly kind: 'failed'; readonly proposal: number; readonly detail: string };

export type PromotionDecisionPassOutcome =
  | { readonly kind: 'skipped'; readonly reason: 'listing_failed' | 'nothing_to_decide' }
  | { readonly kind: 'acted'; readonly outcomes: readonly ProposalDecisionOutcome[] };

type Approval = Extract<PromotionDecision, { kind: 'approve' }>;
type Decline = Extract<PromotionDecision, { kind: 'decline' }>;

interface PassContext {
  readonly deps: PromotionDecisionDefaultDeps;
  readonly now: Date;
  readonly log: Logger;
}

/** A decided proposal with the checkout of the default branch it is acted on in, and the Per-Issue Scenarios that checkout holds. */
interface DecisionWork {
  readonly proposal: DecisionProposalRef;
  readonly base: SweepBase;
  readonly features: readonly FeatureFileSource[];
  readonly context: PassContext;
}

const LABEL = 'promotionDecisionPass';
const DECLINE_NOT_LANDED = 'the decline pull request did not land; the next pass declines again';

function failed(proposal: number, detail: string): ProposalDecisionOutcome {
  return { kind: 'failed', proposal, detail };
}

function resolvedDeps(deps: PromotionDecisionPassDeps, log: Logger): PromotionDecisionDefaultDeps {
  const defaults = makePromotionDecisionDefaults(deps.boundary, log);
  return {
    listProposals: deps.listProposals ?? defaults.listProposals,
    listImplementationIssues: deps.listImplementationIssues ?? defaults.listImplementationIssues,
    prepareBase: deps.prepareBase ?? defaults.prepareBase,
    readPerIssueFeatures: deps.readPerIssueFeatures ?? defaults.readPerIssueFeatures,
    persistDeclines: deps.persistDeclines ?? defaults.persistDeclines,
    fileImplementationIssue: deps.fileImplementationIssue ?? defaults.fileImplementationIssue,
    recordDecision: deps.recordDecision ?? defaults.recordDecision,
    closeProposal: deps.closeProposal ?? defaults.closeProposal,
    cleanupBase: deps.cleanupBase ?? defaults.cleanupBase,
  };
}

function listedProposals({ deps, log }: PassContext): readonly DecisionProposalRef[] | null {
  try {
    return deps.listProposals();
  } catch (error) {
    log(`${LABEL}: could not list the Promotion Proposals (${error}) — acting on none this cycle`, 'warn');
    return null;
  }
}

function keyOf({ issueNumber, scenarioName }: NominationKey): NominationKey {
  return { issueNumber, scenarioName };
}

function approvedScenario(key: NominationKey, features: readonly FeatureFileSource[]): ApprovedScenario | null {
  const feature = featureOfCandidate(features, key);
  return feature === null ? null : { ...keyOf(key), featurePath: feature.path };
}

function isApprovedScenario(scenario: ApprovedScenario | null): scenario is ApprovedScenario {
  return scenario !== null;
}

function declineEditOf(file: FeatureFileSource, declined: readonly NominationKey[]): NominationDeclineEdit | null {
  const names = declined.filter((key) => featureOfCandidate([file], key) !== null).map((key) => key.scenarioName);
  const edit = declineNominations(file.content, names);
  return edit.declined.length === 0 ? null : { path: file.path, content: edit.content };
}

function isEdit(edit: NominationDeclineEdit | null): edit is NominationDeclineEdit {
  return edit !== null;
}

/** False when the decline pull request did not land; a candidate already declined or gone needs none. */
async function declineCandidates({ proposal, base, features, context }: DecisionWork, declined: readonly NominationKey[]): Promise<boolean> {
  const edits = features.map((file) => declineEditOf(file, declined)).filter(isEdit);
  return (await context.deps.persistDeclines(proposal.number, edits, base)) !== 'failed';
}

/** The lookup by marker line keeps a retry after a crash, or after a failed decline, from filing a second issue. */
async function implementationIssueOf(proposalNumber: number, present: readonly ApprovedScenario[], { deps, log }: PassContext): Promise<number | null> {
  const filed = implementationIssueFor(proposalNumber, deps.listImplementationIssues());
  if (filed !== null) {
    log(`${LABEL}: implementation issue #${filed.number} of Promotion Proposal #${proposalNumber} is already filed`, 'info');
    return filed.number;
  }
  if (present.length === 0) return null;

  const issueNumber = await deps.fileImplementationIssue(buildPromotionImplementationIssue({ proposalNumber, approved: present }));
  log(`${LABEL}: filed implementation issue #${issueNumber} for Promotion Proposal #${proposalNumber} with ${present.length} scenario(s)`, 'success');
  return issueNumber;
}

async function approve(work: DecisionWork, { approved, declined }: Approval): Promise<ProposalDecisionOutcome> {
  const { proposal, features, context } = work;
  const present = approved.map((key) => approvedScenario(key, features)).filter(isApprovedScenario);
  const missing = approved.filter((key) => !present.some((scenario) => isSameCandidate(scenario, key)));
  const implementationIssue = await implementationIssueOf(proposal.number, present, context);
  if (!(await declineCandidates(work, declined))) return failed(proposal.number, DECLINE_NOT_LANDED);

  const promoted = present.map(keyOf);
  context.deps.recordDecision(proposal.number, buildDecisionComment({ outcome: 'approved', approved: promoted, declined, missing, implementationIssue }));
  context.log(
    `${LABEL}: acted on the approval of Promotion Proposal #${proposal.number}: ${promoted.length} promoted, ${declined.length} declined, ${missing.length} no longer on the default branch`,
    'info',
  );
  return { kind: 'approved', proposal: proposal.number, implementationIssue, approved: promoted, declined, missing };
}

async function closeExpired(proposalNumber: number, { deps, log }: PassContext): Promise<void> {
  if (await deps.closeProposal(proposalNumber)) {
    log(`${LABEL}: closed Promotion Proposal #${proposalNumber}: open for ${PROMOTION_PROPOSAL_EXPIRY_DAYS} days without a decision`, 'info');
    return;
  }
  log(`${LABEL}: could not close the expired Promotion Proposal #${proposalNumber} — the next pass closes it again`, 'warn');
}

/**
 * The port can only close as completed, so an expired proposal is closed only once its record is confirmed: ADW's own close
 * can then never be read as the owner's approval.
 */
async function decline(work: DecisionWork, { reason, declined }: Decline): Promise<ProposalDecisionOutcome> {
  const { proposal, context } = work;
  if (!(await declineCandidates(work, declined))) return failed(proposal.number, DECLINE_NOT_LANDED);

  const outcome = reason === DeclineReason.Expired ? 'expired' : 'declined';
  const recorded = context.deps.recordDecision(proposal.number, buildDecisionComment({ outcome, reason, approved: [], declined, missing: [], implementationIssue: null }));
  const closes = reason === DeclineReason.Expired && isOpenProposal(proposal);
  if (closes && !recorded) return failed(proposal.number, 'the decision record could not be confirmed, so the proposal was left open');

  context.log(`${LABEL}: declined ${declined.length} candidate(s) of Promotion Proposal #${proposal.number} (${reason})`, 'info');
  if (closes) await closeExpired(proposal.number, context);
  return { kind: 'declined', proposal: proposal.number, reason, declined };
}

async function decide(proposal: DecisionProposalRef, decision: Approval | Decline, context: PassContext): Promise<ProposalDecisionOutcome> {
  const base = context.deps.prepareBase(proposal.number);
  if (base === null) return failed(proposal.number, 'no checkout of the default branch could be made');
  try {
    const work: DecisionWork = { proposal, base, features: context.deps.readPerIssueFeatures(base), context };
    return decision.kind === 'approve' ? await approve(work, decision) : await decline(work, decision);
  } finally {
    context.deps.cleanupBase(base);
  }
}

async function closeAgain(proposal: DecisionProposalRef, { deps, log }: PassContext): Promise<ProposalDecisionOutcome> {
  if (!(await deps.closeProposal(proposal.number))) return failed(proposal.number, 'the expired proposal could not be closed again');
  log(`${LABEL}: closed Promotion Proposal #${proposal.number} again: ADW declined it as expired`, 'info');
  return { kind: 'closed_again', proposal: proposal.number };
}

async function act(action: ProposalAction, context: PassContext): Promise<ProposalDecisionOutcome> {
  try {
    return action.kind === 'close_again' ? await closeAgain(action.proposal, context) : await decide(action.proposal, action.decision, context);
  } catch (error) {
    context.log(`${LABEL}: could not act on Promotion Proposal #${action.proposal.number}: ${error}`, 'error');
    return failed(action.proposal.number, String(error));
  }
}

/** Never throws: a failure on one proposal is reported in its outcome, and the next proposal is still acted on. */
export async function runPromotionDecisionPass(passDeps: PromotionDecisionPassDeps): Promise<PromotionDecisionPassOutcome> {
  const log = passDeps.log ?? coreLog;
  const context: PassContext = { deps: resolvedDeps(passDeps, log), now: passDeps.now ?? new Date(), log };

  const proposals = listedProposals(context);
  if (proposals === null) return { kind: 'skipped', reason: 'listing_failed' };

  const actions = proposalActions(proposals, context.now);
  if (actions.length === 0) {
    log(`${LABEL}: no Promotion Proposal awaits a decision`, 'info');
    return { kind: 'skipped', reason: 'nothing_to_decide' };
  }

  // One at a time: every decided proposal checks out the same decline branch.
  const outcomes: ProposalDecisionOutcome[] = [];
  for (const action of actions) outcomes.push(await act(action, context));
  return { kind: 'acted', outcomes };
}
