/**
 * The weekly Promotion Proposal pass's defaults, each bound to the launch boundary passed in and read only when called: the
 * proposal listing, a checkout of the default branch, the merge lookup, the analysis agent run in that checkout, and the
 * filing. Nothing is ever committed or pushed from the checkout; it only gives the agent the repository to read.
 */

import { generateAdwId, ensureLogsDirectory, type LaunchBoundary, type LogLevel } from '../core';
import { isSelfHostLaunch } from '../core/selfHostLaunch';
import { runProposalAnalysisAgent } from '../agents/proposalAnalysisAgent';
import { copyClaudeAssetsToWorktree } from '../phases/worktreeSetup';
import type { FeatureFileSource } from '../proof/featureScenarioIndex';
import type { Nomination } from '../promotion/nominationCollector';
import { readPerIssueScenarioFiles } from '../promotion/perIssueScenarioFiles';
import type { CandidateAnalysis, ProposalIssueSpec } from '../promotion/proposalBody';
import type { ProposalIssueRef } from '../promotion/proposalPassDecision';
import { defaultGetMergedAt } from './perIssueScenarioSweep';
import { listPromotionProposals } from './promotionProposalIssues';

export const PROMOTION_PROPOSAL_CHECKOUT_BRANCH = 'chore/promotion-proposal';

const LABEL = 'promotionProposalPass';
const UNLABELLED_COMMENT = 'ADW could not label this Promotion Proposal, so it was closed to keep the pipeline away from it; the next pass files a new one.';

type Logger = (msg: string, level?: LogLevel) => void;

export interface ProposalCheckout {
  readonly worktreePath: string;
  readonly defaultBranch: string;
}

export interface PromotionProposalDefaultDeps {
  /** Every Promotion Proposal of the repository, open or closed; throws when the forge cannot list them. */
  listProposals: () => readonly ProposalIssueRef[];
  /** Null, logged, when no checkout could be made. */
  prepareCheckout: () => ProposalCheckout | null;
  readPerIssueFeatures: (checkout: ProposalCheckout) => readonly FeatureFileSource[];
  /** Null when no merged pull request links the issue. */
  getMergedAt: (issueNumber: number) => Promise<Date | null>;
  /** One analysis per candidate, in candidate order; throws when the agent fails. */
  analyse: (candidates: readonly Nomination[], checkout: ProposalCheckout) => Promise<readonly CandidateAnalysis[]>;
  /** Labels the issue in the order of `spec.labels`; throws, after closing the issue, when a label cannot be applied. */
  fileProposal: (spec: ProposalIssueSpec) => Promise<number>;
  /** Never throws. */
  cleanupCheckout: (checkout: ProposalCheckout) => void;
}

function removeCheckout(boundary: LaunchBoundary): void {
  boundary.gitContext.removeWorktree(PROMOTION_PROPOSAL_CHECKOUT_BRANCH);
}

function removeStaleCheckout(boundary: LaunchBoundary): void {
  try {
    removeCheckout(boundary);
  } catch {
    // Nothing left by an earlier pass is the usual case.
  }
}

function prepareCheckout(boundary: LaunchBoundary, log: Logger): ProposalCheckout | null {
  try {
    const defaultBranch = boundary.providers.codeHost.getDefaultBranch();
    removeStaleCheckout(boundary);
    const worktreePath = boundary.gitContext.createWorktreeForNewBranch(PROMOTION_PROPOSAL_CHECKOUT_BRANCH, defaultBranch);
    return { worktreePath, defaultBranch };
  } catch (error) {
    log(`${LABEL}: could not check out the default branch (${error}) — no Promotion Proposal this cycle`, 'warn');
    return null;
  }
}

/** The analysis only reads the checkout, so the agent gets no credential: no subprocess environment is passed. */
async function analyse(boundary: LaunchBoundary, log: Logger, candidates: readonly Nomination[], checkout: ProposalCheckout): Promise<readonly CandidateAnalysis[]> {
  copyClaudeAssetsToWorktree(checkout.worktreePath, boundary.gitContext);
  const adwId = generateAdwId('promotion-proposal');
  const result = await runProposalAnalysisAgent(candidates, {
    logsDir: ensureLogsDirectory(adwId),
    cwd: checkout.worktreePath,
    phaseName: 'promotionProposal',
    launchContext: { selfHost: isSelfHostLaunch(boundary.gitContext), adwId, gitContext: boundary.gitContext },
  });
  log(`${LABEL}: the Promotion Proposal analysis cost $${(result.totalCostUsd ?? 0).toFixed(4)}`, 'info');
  if (!result.success) throw new Error(`the Promotion Proposal analysis failed: ${result.output}`);
  return result.analyses;
}

async function closeUnlabelledProposal(boundary: LaunchBoundary, log: Logger, issueNumber: number): Promise<void> {
  try {
    await boundary.providers.issueTracker.closeIssue(issueNumber, UNLABELLED_COMMENT);
  } catch (error) {
    log(`${LABEL}: could not close the unlabelled Promotion Proposal #${issueNumber}: ${error}`, 'error');
  }
}

/** `adw:none` comes first in the labels, so the pipeline keeps away from the issue from the first label on. */
async function fileProposal(boundary: LaunchBoundary, log: Logger, spec: ProposalIssueSpec): Promise<number> {
  const { issueTracker } = boundary.providers;
  const issueNumber = issueTracker.createIssue(spec.title, spec.body);
  try {
    spec.labels.forEach((label) => issueTracker.applyLabel(issueNumber, label));
  } catch (error) {
    await closeUnlabelledProposal(boundary, log, issueNumber);
    throw error;
  }
  return issueNumber;
}

function cleanupCheckout(boundary: LaunchBoundary, log: Logger): void {
  try {
    removeCheckout(boundary);
  } catch (error) {
    log(`${LABEL}: could not remove the checkout of ${PROMOTION_PROPOSAL_CHECKOUT_BRANCH}: ${error}`, 'warn');
  }
}

export function makePromotionProposalDefaults(boundary: LaunchBoundary, log: Logger): PromotionProposalDefaultDeps {
  return {
    listProposals: () => listPromotionProposals(boundary.providers.issueTracker, 'all'),
    prepareCheckout: () => prepareCheckout(boundary, log),
    readPerIssueFeatures: (checkout) => readPerIssueScenarioFiles(checkout.worktreePath),
    getMergedAt: (issueNumber) => defaultGetMergedAt(boundary.providers.codeHost, issueNumber),
    analyse: (candidates, checkout) => analyse(boundary, log, candidates, checkout),
    fileProposal: (spec) => fileProposal(boundary, log, spec),
    cleanupCheckout: () => cleanupCheckout(boundary, log),
  };
}
