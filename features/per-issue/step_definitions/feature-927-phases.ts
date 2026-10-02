/**
 * Scripted stand-ins for the phases that run agents or touch git. They append their name to one
 * ordered log and cost nothing. The review loop, the gate and the stop path stay real.
 */

import type { ChorePhases } from '../../../adws/adwChore.tsx';
import type { PlanBuildReviewPhases } from '../../../adws/adwPlanBuildReview.tsx';
import type { PlanBuildTestReviewPhases } from '../../../adws/adwPlanBuildTestReview.tsx';
import type { ReviewIssue } from '../../../adws/agents/reviewAgent.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { world, type ReviewVerdict } from './feature-927-world.ts';

export type AllPhases = ChorePhases & PlanBuildReviewPhases & PlanBuildTestReviewPhases;

// The scenarios name "review", "document", "pull request" and "proof publish"; the rest are free.
const PHASE = {
  install: 'install',
  plan: 'plan',
  scenario: 'scenario',
  alignment: 'alignment',
  build: 'build',
  stepDefinitions: 'step definitions',
  unitTests: 'unit tests',
  scenarioFixLoop: 'scenario fix loop',
  scenarioTest: 'scenario test',
  diffEvaluation: 'diff evaluation',
  review: 'review',
  patch: 'patch',
  document: 'document',
  pullRequest: 'pull request',
  proofPublish: 'proof publish',
} as const;

export const REVIEW_PHASE = PHASE.review;
export const KNOWN_PHASES: readonly string[] = Object.values(PHASE);

type PhaseResult = Record<string, unknown>;

const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };

function loggedPhase(name: string, outcome: () => PhaseResult = () => ({})) {
  return async (): Promise<PhaseResult> => {
    world.phaseLog.push(name);
    return { ...ZERO_COST, ...outcome() };
  };
}

function blockerIssues(count: number): ReviewIssue[] {
  return Array.from({ length: count }, (_, index) => ({
    reviewIssueNumber: index + 1,
    issueDescription: `Blocker ${index + 1} left by the scripted review`,
    issueResolution: 'Fix it',
    issueSeverity: 'blocker' as const,
  }));
}

function verdictForAttempt(attempt: number): ReviewVerdict {
  const { reviewScript } = world;
  if (reviewScript.length === 0) throw new Error('The scenario did not script the review verdicts');
  return reviewScript[Math.min(attempt, reviewScript.length - 1)];
}

// Posts no comment: every comment on the issue must come from the orchestrator itself.
async function reviewPhase(): Promise<PhaseResult> {
  const attempt = world.phaseLog.filter(entry => entry === REVIEW_PHASE).length;
  world.phaseLog.push(REVIEW_PHASE);
  const verdict = verdictForAttempt(attempt);
  return {
    ...ZERO_COST,
    reviewPassed: verdict.passed,
    reviewIssues: blockerIssues(verdict.blockers),
    totalRetries: 0,
  };
}

function diffVerdict(): PhaseResult {
  if (world.diffEscalates === null) {
    throw new Error('The scenario did not say whether the diff judge escalates the chore');
  }
  return { verdict: world.diffEscalates ? 'regression_possible' : 'safe', reason: 'scripted by the scenario' };
}

async function pullRequestPhase(config: WorkflowConfig): Promise<PhaseResult> {
  world.phaseLog.push(PHASE.pullRequest);
  const codeHost = config.repoContext?.codeHost;
  if (!codeHost) throw new Error('The workflow has no code host to open a pull request on');
  const { url, number } = codeHost.createPullRequest({
    title: `Scripted pull request for issue #${config.issueNumber}`,
    body: 'Opened by the scripted pull request phase.',
    sourceBranch: config.branchName,
    targetBranch: codeHost.getDefaultBranch(),
    linkedIssueNumber: config.issueNumber,
  });
  config.ctx.prUrl = url;
  config.ctx.prNumber = number;
  return ZERO_COST;
}

export function buildFakePhases(): AllPhases {
  return {
    executeInstallPhase: loggedPhase(PHASE.install),
    executePlanPhase: loggedPhase(PHASE.plan),
    executeScenarioPhase: loggedPhase(PHASE.scenario),
    executeAlignmentPhase: loggedPhase(PHASE.alignment),
    executeBuildPhase: loggedPhase(PHASE.build),
    executeStepDefPhase: loggedPhase(PHASE.stepDefinitions),
    executeUnitTestPhase: loggedPhase(PHASE.unitTests, () => ({ unitTestsPassed: true, totalRetries: 0 })),
    runScenarioTestFixLoop: loggedPhase(PHASE.scenarioFixLoop, () => ({ scenarioProofPath: 'proof.md', scenarioRetries: 0 })),
    executeScenarioTestPhase: loggedPhase(PHASE.scenarioTest, () => ({ scenarioProof: undefined })),
    executeDiffEvaluationPhase: loggedPhase(PHASE.diffEvaluation, diffVerdict),
    executeReviewPhase: reviewPhase,
    executeReviewPatchCycle: loggedPhase(PHASE.patch),
    executeDocumentPhase: loggedPhase(PHASE.document),
    executePRPhase: pullRequestPhase,
    executeProofPublishPhase: loggedPhase(PHASE.proofPublish),
  } as unknown as AllPhases;
}
