import { vi } from 'vitest';

import { executeChore, type ChorePhases } from '../adwChore';
import type { WorkflowConfig } from '../phases';

export const BRANCH = 'chore-issue-42-rename-config-keys';
export const PR_URL = 'https://github.com/acme/widget/pull/77';
export const PR_NUMBER = 77;
export const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };

export const BLOCKER = {
  reviewIssueNumber: 1,
  issueDescription: 'broken',
  issueResolution: 'fix it',
  issueSeverity: 'blocker',
};
export const FAILED_REVIEW = { reviewPassed: false, reviewIssues: [BLOCKER] };
export const PASSED_REVIEW = { reviewPassed: true, reviewIssues: [] };
export type ReviewVerdict = typeof FAILED_REVIEW | typeof PASSED_REVIEW;

export const SERVER_OUTPUT = "Error: Cannot find module './routes'";
export const NOT_STARTED = { status: 'not_started' };
export const STARTED = { status: 'started' };
export const FAILED_START = { status: 'failed', command: 'bun run dev --port 4567', healthUrl: 'http://localhost:4567/', output: SERVER_OUTPUT };
export type DevServerStart = typeof NOT_STARTED | typeof STARTED | typeof FAILED_START;

/** Answers with each scripted start in turn, then repeats the last one; the fix loop's run is the first. */
function scriptedStarts(starts: DevServerStart[]) {
  let run = 0;
  return () => starts[Math.min(run++, starts.length - 1)];
}

/** Answers with each scripted verdict in turn, then repeats the last one. */
function scriptedReview(verdicts: ReviewVerdict[]) {
  let attempt = 0;
  return vi.fn(async () => ({ ...ZERO_COST, ...verdicts[Math.min(attempt++, verdicts.length - 1)] }));
}

export function makePhases(diffVerdict: 'regression_possible' | 'safe', reviews: ReviewVerdict[], starts: DevServerStart[] = [NOT_STARTED]) {
  const nextStart = scriptedStarts(starts);
  return {
    executeBaselinePhase: vi.fn(async () => ZERO_COST),
    executeInstallPhase: vi.fn(async () => ZERO_COST),
    executePlanPhase: vi.fn(async () => ZERO_COST),
    executeBuildPhase: vi.fn(async () => ZERO_COST),
    executeStepDefPhase: vi.fn(async () => ZERO_COST),
    executeUnitTestPhase: vi.fn(async () => ({ ...ZERO_COST, unitTestsPassed: true, totalRetries: 0 })),
    runScenarioTestFixLoop: vi.fn(async () => ({ scenarioProofPath: '/proof.md', scenarioRetries: 0, devServer: nextStart() })),
    executeDiffEvaluationPhase: vi.fn(async () => ({ ...ZERO_COST, verdict: diffVerdict, reason: 'test' })),
    executeReviewPhase: scriptedReview(reviews),
    executeReviewPatchCycle: vi.fn(async (_config: unknown, _blockers: Array<{ issueDescription: string }>) => ZERO_COST),
    executeScenarioTestPhase: vi.fn(async () => ({ ...ZERO_COST, scenarioProof: undefined, devServer: nextStart() })),
    executeDocumentPhase: vi.fn(async () => ZERO_COST),
    executePRPhase: vi.fn(async (cfg: WorkflowConfig) => {
      cfg.ctx.prUrl = PR_URL;
      return ZERO_COST;
    }),
  };
}

// The issue has no labels unless a test says otherwise, so a pre-approval that should not happen
// would be visible.
export function makeConfig(labels: string[] = []) {
  const commentOnIssue = vi.fn();
  const approvePullRequest = vi.fn(() => ({ success: true }));
  const config = {
    issueNumber: 42,
    adwId: 'adw-test',
    orchestratorStatePath: '/mock/agents/adw-test/chore',
    ctx: { issueNumber: 42, adwId: 'adw-test', branchName: BRANCH },
    repoContext: {
      issueTracker: { commentOnIssue, fetchLabels: vi.fn(() => labels) },
      codeHost: { approvePullRequest },
    },
  } as unknown as WorkflowConfig;
  return { config, commentOnIssue, approvePullRequest };
}

export async function runChore(
  diffVerdict: 'regression_possible' | 'safe',
  reviews: ReviewVerdict[],
  labels: string[] = [],
  starts: DevServerStart[] = [NOT_STARTED],
) {
  const { config, commentOnIssue, approvePullRequest } = makeConfig(labels);
  const phases = makePhases(diffVerdict, reviews, starts);
  await executeChore(config, phases as unknown as ChorePhases);
  return { config, commentOnIssue, approvePullRequest, phases };
}

export function commentsPosted(commentOnIssue: ReturnType<typeof vi.fn>): string[] {
  return commentOnIssue.mock.calls.map(([, body]) => String(body));
}
