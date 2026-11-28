/**
 * The Promotion Proposal decision pass's defaults, each bound to the launch boundary passed in and read only when called: the
 * proposal and implementation-issue listings, a checkout of the default branch on the dedicated decline branch, the decline
 * landed through an immediately merged pull request, the filing of the implementation issue, the decision record and the
 * close of an expired proposal.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LaunchBoundary, LogLevel } from '../core';
import type { FeatureFileSource } from '../proof/featureScenarioIndex';
import { readPerIssueScenarioFiles } from '../promotion/perIssueScenarioFiles';
import type { DecisionProposalRef } from '../promotion/promotionDecider';
import type { ImplementationIssueRef } from '../promotion/promotionImplementationIssue';
import type { ProposalIssueSpec } from '../promotion/proposalBody';
import { readDecisionRecord } from '../promotion/proposalDecisionRecord';
import { cleanupSweepBase, persistCommitViaPr, prepareSweepBase, type SweepBase, type SweepPersistSpec } from './perIssueSweepPersist';
import { listDecisionProposals, listImplementationIssues } from './promotionProposalIssues';

export const NOMINATION_DECLINE_BRANCH = 'chore/nomination-decline';

const LABEL = 'promotionDecisionPass';
const UNLABELLED_COMMENT = 'ADW could not label this promotion implementation issue, so it was closed to keep the pipeline away from it; the next pass files a new one.';

type Logger = (msg: string, level?: LogLevel) => void;

/** `nothing_to_change` when every declined scenario is already declined or gone, so no pull request is needed. */
export type DeclineLanding = 'landed' | 'nothing_to_change' | 'failed';

export interface NominationDeclineEdit {
  /** Repo-relative. */
  readonly path: string;
  readonly content: string;
}

export interface PromotionDecisionDefaultDeps {
  /** Every Promotion Proposal, open or closed, with its comments and close reason; throws when the forge cannot list them. */
  listProposals: () => readonly DecisionProposalRef[];
  /** Every promotion implementation issue, open or closed; throws when the forge cannot list them. */
  listImplementationIssues: () => readonly ImplementationIssueRef[];
  /** A checkout of the default branch on the decline branch; null, logged, when none could be made. */
  prepareBase: (proposalNumber: number) => SweepBase | null;
  readPerIssueFeatures: (base: SweepBase) => readonly FeatureFileSource[];
  persistDeclines: (proposalNumber: number, edits: readonly NominationDeclineEdit[], base: SweepBase) => Promise<DeclineLanding>;
  /** Labels the issue in the order of `spec.labels`; throws, after closing the issue, when a label cannot be applied. */
  fileImplementationIssue: (spec: ProposalIssueSpec) => Promise<number>;
  /** True only once a decision record can be read back from the proposal's comments. */
  recordDecision: (proposalNumber: number, comment: string) => boolean;
  /** True when the proposal was closed. */
  closeProposal: (proposalNumber: number) => Promise<boolean>;
  /** Never throws. */
  cleanupBase: (base: SweepBase) => void;
}

export function nominationDeclineSpec(proposalNumber: number): SweepPersistSpec {
  return {
    branch: NOMINATION_DECLINE_BRANCH,
    prTitle: `chore: decline the Nominations of Promotion Proposal #${proposalNumber}`,
    prBody:
      `Automated decline of the Nominations the owner did not approve in Promotion Proposal #${proposalNumber}: each such scenario's ` +
      '`@nominated` tag becomes `@nomination-declined`, so the Per-Issue Sweep removes those scenarios on its 14-day rule and no later Promotion Proposal offers them.',
  };
}

function declineCommitMessage(proposalNumber: number): string {
  return `chore: decline the Nominations the owner did not approve in Promotion Proposal #${proposalNumber}`;
}

function commitDeclines(base: SweepBase, proposalNumber: number, edits: readonly NominationDeclineEdit[]): boolean {
  edits.forEach((edit) => fs.writeFileSync(path.join(base.worktreePath, edit.path), edit.content, 'utf-8'));
  return base.ctx.addAndCommitPaths(edits.map((edit) => edit.path), declineCommitMessage(proposalNumber), base.worktreePath);
}

async function persistDeclines(proposalNumber: number, edits: readonly NominationDeclineEdit[], base: SweepBase): Promise<DeclineLanding> {
  if (edits.length === 0) return 'nothing_to_change';
  const landed = await persistCommitViaPr((b) => commitDeclines(b, proposalNumber, edits), base, LABEL);
  return landed ? 'landed' : 'failed';
}

async function closeUnlabelledIssue(boundary: LaunchBoundary, log: Logger, issueNumber: number): Promise<void> {
  try {
    await boundary.providers.issueTracker.closeIssue(issueNumber, UNLABELLED_COMMENT);
  } catch (error) {
    log(`${LABEL}: could not close the unlabelled implementation issue #${issueNumber}: ${error}`, 'error');
  }
}

async function fileImplementationIssue(boundary: LaunchBoundary, log: Logger, spec: ProposalIssueSpec): Promise<number> {
  const { issueTracker } = boundary.providers;
  const issueNumber = issueTracker.createIssue(spec.title, spec.body);
  try {
    spec.labels.forEach((label) => issueTracker.applyLabel(issueNumber, label));
  } catch (error) {
    await closeUnlabelledIssue(boundary, log, issueNumber);
    throw error;
  }
  return issueNumber;
}

/** The port's comment call swallows its own failure, so the record counts only once it is read back. */
function recordDecision(boundary: LaunchBoundary, log: Logger, proposalNumber: number, comment: string): boolean {
  const { issueTracker } = boundary.providers;
  issueTracker.commentOnIssue(proposalNumber, comment);
  try {
    return issueTracker.fetchComments(proposalNumber).some((posted) => readDecisionRecord([posted.body]) !== null);
  } catch (error) {
    log(`${LABEL}: could not read back the comments of Promotion Proposal #${proposalNumber}: ${error}`, 'warn');
    return false;
  }
}

export function makePromotionDecisionDefaults(boundary: LaunchBoundary, log: Logger): PromotionDecisionDefaultDeps {
  return {
    listProposals: () => listDecisionProposals(boundary.providers.issueTracker),
    listImplementationIssues: () => listImplementationIssues(boundary.providers.issueTracker, 'all'),
    prepareBase: (proposalNumber) => prepareSweepBase(boundary, nominationDeclineSpec(proposalNumber)),
    readPerIssueFeatures: (base) => readPerIssueScenarioFiles(base.worktreePath),
    persistDeclines,
    fileImplementationIssue: (spec) => fileImplementationIssue(boundary, log, spec),
    recordDecision: (proposalNumber, comment) => recordDecision(boundary, log, proposalNumber, comment),
    closeProposal: (proposalNumber) => boundary.providers.issueTracker.closeIssue(proposalNumber),
    cleanupBase: cleanupSweepBase,
  };
}
