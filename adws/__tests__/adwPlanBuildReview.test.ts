import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    MAX_REVIEW_RETRY_ATTEMPTS: 3,
    AgentStateManager: { writeTopLevelState: vi.fn(), writeState: vi.fn() },
    log: vi.fn(),
  };
});

// The real runPhase writes top-level state for named phases, bypassing the mocked core barrel.
vi.mock('../core/phaseRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/phaseRunner')>();
  return {
    ...actual,
    runPhase: vi.fn(async (config, _tracker, fn) => fn(config)),
    runPhasesParallel: vi.fn(async (config, _tracker, fns: Array<(c: unknown) => Promise<unknown>>) =>
      Promise.all(fns.map(fn => fn(config)))),
  };
});

vi.mock('../cost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cost')>();
  return { ...actual, persistTokenCounts: vi.fn() };
});

// A park ends the process, so it never reaches an error handler; the sentinel a test throws for it must not either.
vi.mock('../workflowPhases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workflowPhases')>();
  return {
    ...actual,
    handleWorkflowError: vi.fn((_config: unknown, error: unknown) => {
      throw error;
    }),
  };
});

import { executePlanBuildReview, type PlanBuildReviewPhases } from '../adwPlanBuildReview';
import { AgentStateManager } from '../core';
import { runPhase } from '../core/phaseRunner';
import { persistTokenCounts } from '../cost';
import type { WorkflowConfig } from '../phases';

const BRANCH = 'feature-issue-42-csv-export';
const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };

const BLOCKER = {
  reviewIssueNumber: 1,
  issueDescription: 'broken',
  issueResolution: 'fix it',
  issueSeverity: 'blocker',
};
const FAILED_REVIEW = { reviewPassed: false, reviewIssues: [BLOCKER] };
const PASSED_REVIEW = { reviewPassed: true, reviewIssues: [] };
type ReviewVerdict = typeof FAILED_REVIEW | typeof PASSED_REVIEW;

/** Answers with each scripted verdict in turn, then repeats the last one. */
function scriptedReview(verdicts: ReviewVerdict[]) {
  let attempt = 0;
  return vi.fn(async () => ({ ...ZERO_COST, ...verdicts[Math.min(attempt++, verdicts.length - 1)] }));
}

function makePhases(verdicts: ReviewVerdict[]) {
  return {
    executeBaselinePhase: vi.fn(async () => ZERO_COST),
    executeInstallPhase: vi.fn(async () => ZERO_COST),
    executePlanPhase: vi.fn(async () => ZERO_COST),
    executeScenarioPhase: vi.fn(async () => ZERO_COST),
    executeAlignmentPhase: vi.fn(async () => ZERO_COST),
    executeBuildPhase: vi.fn(async () => ZERO_COST),
    executeUnitTestPhase: vi.fn(async () => ({ ...ZERO_COST, unitTestsPassed: true, totalRetries: 0 })),
    executeScenarioTestPhase: vi.fn(async () => ({ ...ZERO_COST, scenarioProof: undefined })),
    executeReviewPhase: scriptedReview(verdicts),
    executeReviewPatchCycle: vi.fn(async () => ZERO_COST),
    executePRPhase: vi.fn(async () => ZERO_COST),
  };
}

function makeConfig() {
  const commentOnIssue = vi.fn();
  const config = {
    issueNumber: 42,
    adwId: 'adw-test',
    orchestratorStatePath: '/mock/agents/adw-test/plan-build-review',
    ctx: { issueNumber: 42, adwId: 'adw-test', branchName: BRANCH },
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;
  return { config, commentOnIssue };
}

async function runWithReviews(...verdicts: ReviewVerdict[]) {
  const { config, commentOnIssue } = makeConfig();
  const phases = makePhases(verdicts);
  await executePlanBuildReview(config, phases as unknown as PlanBuildReviewPhases);
  return { config, commentOnIssue, phases };
}

function writtenStages(): Array<string | undefined> {
  return vi.mocked(AgentStateManager.writeTopLevelState).mock.calls.map(([, state]) => state.workflowStage);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executePlanBuildReview — the review still has blockers after its last attempt', () => {
  it('attempts the review as often as the retry budget allows, patching between attempts', async () => {
    const { phases } = await runWithReviews(FAILED_REVIEW);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(3);
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
  });

  it('stops at review_failed and never writes awaiting_merge', async () => {
    await runWithReviews(FAILED_REVIEW);

    expect(writtenStages()).toEqual(['review_failed']);
  });

  it('opens no pull request', async () => {
    const { phases } = await runWithReviews(FAILED_REVIEW);

    expect(phases.executePRPhase).not.toHaveBeenCalled();
  });

  it('records the failed verdict in the orchestrator metadata and persists the cost', async () => {
    const { config } = await runWithReviews(FAILED_REVIEW);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ reviewPassed: false, totalReviewRetries: 3 }),
    });
    expect(persistTokenCounts).toHaveBeenCalledWith(config.orchestratorStatePath, 0, expect.any(Object));
  });

  it('tells the issue which branch holds the work and to post ## Retry', async () => {
    const { commentOnIssue } = await runWithReviews(FAILED_REVIEW);

    const retryComment = commentOnIssue.mock.calls
      .map(([, body]) => String(body))
      .find(body => body.includes('## Retry'));
    expect(retryComment, 'no comment tells a human to post ## Retry').toBeDefined();
    expect(retryComment).toContain(BRANCH);
  });
});

describe('executePlanBuildReview — the review passes', () => {
  it('opens the pull request and ends at awaiting_merge', async () => {
    const { phases } = await runWithReviews(PASSED_REVIEW);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(1);
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });

  it('carries on to the pull request when a patch turns the first failed attempt into a pass', async () => {
    const { phases } = await runWithReviews(FAILED_REVIEW, PASSED_REVIEW);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(2);
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(1);
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });
});

class ParkedSignal extends Error {}

describe('executePlanBuildReview — the baseline', () => {
  it('runs first, as the phase named baseline, before the install phase and the plan phase', async () => {
    const { config, phases } = await runWithReviews(PASSED_REVIEW);

    const baseline = phases.executeBaselinePhase.mock.invocationCallOrder[0];
    expect(baseline).toBeLessThan(phases.executeInstallPhase.mock.invocationCallOrder[0]);
    expect(baseline).toBeLessThan(phases.executePlanPhase.mock.invocationCallOrder[0]);
    expect(vi.mocked(runPhase)).toHaveBeenNthCalledWith(1, config, expect.anything(), phases.executeBaselinePhase, 'baseline');
  });

  it('stops the run before any plan is written when it parks the workflow', async () => {
    const { config } = makeConfig();
    const phases = makePhases([PASSED_REVIEW]);
    phases.executeBaselinePhase.mockRejectedValueOnce(new ParkedSignal());

    await expect(executePlanBuildReview(config, phases as unknown as PlanBuildReviewPhases)).rejects.toBeInstanceOf(ParkedSignal);

    expect(phases.executeInstallPhase).not.toHaveBeenCalled();
    expect(phases.executePlanPhase).not.toHaveBeenCalled();
    expect(phases.executeBuildPhase).not.toHaveBeenCalled();
  });
});
