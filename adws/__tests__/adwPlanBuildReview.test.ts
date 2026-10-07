import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    MAX_REVIEW_RETRY_ATTEMPTS: 3,
    AgentStateManager: { writeTopLevelState: vi.fn(), writeState: vi.fn(), appendLog: vi.fn() },
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
import { handleWorkflowError } from '../workflowPhases';
import type { WorkflowConfig } from '../phases';

const BRANCH = 'feature-issue-42-csv-export';
const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
const PROOF_PATH = '/proof.md';
const RETEST_PROOF_PATH = '/retest-proof.md';
const SCENARIO_RETRIES = 2;

const BLOCKER = {
  reviewIssueNumber: 1,
  issueDescription: 'broken',
  issueResolution: 'fix it',
  issueSeverity: 'blocker',
};
const FAILED_REVIEW = { reviewPassed: false, reviewIssues: [BLOCKER] };
const PASSED_REVIEW = { reviewPassed: true, reviewIssues: [] };
type ReviewVerdict = typeof FAILED_REVIEW | typeof PASSED_REVIEW;

const SERVER_OUTPUT = "Error: Cannot find module './routes'";
const NOT_STARTED = { status: 'not_started' };
const STARTED = { status: 'started' };
const FAILED_START = { status: 'failed', command: 'bun run dev --port 4567', healthUrl: 'http://localhost:4567/', output: SERVER_OUTPUT };
type DevServerStart = typeof NOT_STARTED | typeof STARTED | typeof FAILED_START;

/** Answers with each scripted start in turn, then repeats the last one. */
function scriptedStarts(starts: DevServerStart[]) {
  let run = 0;
  return () => starts[Math.min(run++, starts.length - 1)];
}

/** Answers with each scripted verdict in turn, then repeats the last one. */
function scriptedReview(verdicts: ReviewVerdict[]) {
  let attempt = 0;
  return vi.fn(async () => ({ ...ZERO_COST, ...verdicts[Math.min(attempt++, verdicts.length - 1)] }));
}

function makePhases(verdicts: ReviewVerdict[], starts: DevServerStart[] = [NOT_STARTED]) {
  const nextStart = scriptedStarts(starts);
  return {
    executeBaselinePhase: vi.fn(async () => ZERO_COST),
    executeInstallPhase: vi.fn(async () => ZERO_COST),
    executePlanPhase: vi.fn(async () => ZERO_COST),
    executeScenarioPhase: vi.fn(async () => ZERO_COST),
    executeAlignmentPhase: vi.fn(async () => ZERO_COST),
    executeBuildPhase: vi.fn(async () => ZERO_COST),
    executeStepDefPhase: vi.fn(async () => ZERO_COST),
    executeUnitTestPhase: vi.fn(async () => ({ ...ZERO_COST, unitTestsPassed: true, totalRetries: 0 })),
    runScenarioTestFixLoop: vi.fn(async () => ({ scenarioProofPath: PROOF_PATH, scenarioRetries: SCENARIO_RETRIES, devServer: nextStart() })),
    executeScenarioTestPhase: vi.fn(async () => ({ ...ZERO_COST, scenarioProof: { resultsFilePath: RETEST_PROOF_PATH }, devServer: nextStart() })),
    executeReviewPhase: scriptedReview(verdicts),
    executeReviewPatchCycle: vi.fn(async (_config: unknown, _blockers: Array<{ issueDescription: string }>) => ZERO_COST),
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
  return runWithStarts([NOT_STARTED], ...verdicts);
}

async function runWithStarts(starts: DevServerStart[], ...verdicts: ReviewVerdict[]) {
  const { config, commentOnIssue } = makeConfig();
  const phases = makePhases(verdicts, starts);
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

describe('executePlanBuildReview — the dev server does not start on the issue branch', () => {
  it('never runs the review agent, and hands the patch cycle the server blocker once for each failed start but the last', async () => {
    const { phases } = await runWithStarts([FAILED_START], PASSED_REVIEW);

    expect(phases.executeReviewPhase).not.toHaveBeenCalled();
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
    phases.executeReviewPatchCycle.mock.calls.forEach(([, blockers]) => {
      expect(blockers).toHaveLength(1);
      expect(blockers[0].issueDescription).toContain(SERVER_OUTPUT);
    });
  });

  it('starts the server again after each patch: the fix loop makes the first start and one scenario run follows each patch', async () => {
    const { phases } = await runWithStarts([FAILED_START], PASSED_REVIEW);

    expect(phases.runScenarioTestFixLoop).toHaveBeenCalledTimes(1);
    expect(phases.executeScenarioTestPhase).toHaveBeenCalledTimes(2);
  });

  it('stops at review_failed and never writes awaiting_merge', async () => {
    await runWithStarts([FAILED_START], PASSED_REVIEW);

    expect(writtenStages()).toEqual(['review_failed']);
  });

  it('opens no pull request', async () => {
    const { phases } = await runWithStarts([FAILED_START], PASSED_REVIEW);

    expect(phases.executePRPhase).not.toHaveBeenCalled();
  });

  it('records each failed start as a failed review in the orchestrator metadata', async () => {
    const { config } = await runWithStarts([FAILED_START], PASSED_REVIEW);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ reviewPassed: false, totalReviewRetries: 3 }),
    });
  });

  it('puts the server output in the issue comments, with the branch and ## Retry in the last one', async () => {
    const { commentOnIssue } = await runWithStarts([FAILED_START], PASSED_REVIEW);

    const comments = commentOnIssue.mock.calls.map(([, body]) => String(body));
    expect(comments.length).toBeGreaterThan(0);
    comments.forEach(body => expect(body).toContain(SERVER_OUTPUT));
    const last = comments[comments.length - 1];
    expect(last).toContain('## Retry');
    expect(last).toContain(BRANCH);
  });

  it('carries on to the pull request when the server starts again after two failed starts and the review passes', async () => {
    const { phases } = await runWithStarts([FAILED_START, FAILED_START, STARTED], PASSED_REVIEW);

    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(1);
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

class LoopFailure extends Error {}

type Gate = ReturnType<typeof makePhases>[keyof ReturnType<typeof makePhases>];

function firstCallOf(phase: Gate): number {
  return phase.mock.invocationCallOrder[0];
}

describe('executePlanBuildReview — green gates precede the review', () => {
  it('starts the review only once the scenario fix loop has returned', async () => {
    const { config } = makeConfig();
    const phases = makePhases([PASSED_REVIEW]);
    let turnGreen = (): void => {};
    phases.runScenarioTestFixLoop.mockImplementation(
      () => new Promise(resolve => {
        turnGreen = () => resolve({ scenarioProofPath: PROOF_PATH, scenarioRetries: SCENARIO_RETRIES, devServer: NOT_STARTED });
      }),
    );

    const run = executePlanBuildReview(config, phases as unknown as PlanBuildReviewPhases);
    await vi.waitFor(() => expect(phases.runScenarioTestFixLoop).toHaveBeenCalledTimes(1));
    expect(phases.executeReviewPhase).not.toHaveBeenCalled();

    turnGreen();
    await run;

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(1);
  });

  it('runs the loop after the unit-test phase and before the first review', async () => {
    const { phases } = await runWithReviews(PASSED_REVIEW);

    expect(firstCallOf(phases.executeUnitTestPhase)).toBeLessThan(firstCallOf(phases.runScenarioTestFixLoop));
    expect(firstCallOf(phases.runScenarioTestFixLoop)).toBeLessThan(firstCallOf(phases.executeReviewPhase));
  });

  it('runs the step-definition phase, as the phase named stepDef, after the build and before the unit-test phase', async () => {
    const { config, phases } = await runWithReviews(PASSED_REVIEW);

    expect(vi.mocked(runPhase)).toHaveBeenCalledWith(config, expect.anything(), phases.executeStepDefPhase, 'stepDef');
    expect(firstCallOf(phases.executeBuildPhase)).toBeLessThan(firstCallOf(phases.executeStepDefPhase));
    expect(firstCallOf(phases.executeStepDefPhase)).toBeLessThan(firstCallOf(phases.executeUnitTestPhase));
  });

  it("hands the first review the proof the loop returned", async () => {
    const { phases } = await runWithReviews(PASSED_REVIEW);

    expect(phases.executeReviewPhase).toHaveBeenNthCalledWith(1, expect.anything(), PROOF_PATH);
  });

  it('runs no scenario test of its own before the first review', async () => {
    const { phases } = await runWithReviews(PASSED_REVIEW);

    expect(phases.executeScenarioTestPhase).not.toHaveBeenCalled();
  });

  it('runs the scenarios again only after a patch, and hands that proof to the next review', async () => {
    const { phases } = await runWithReviews(FAILED_REVIEW, PASSED_REVIEW);

    expect(phases.executeScenarioTestPhase).toHaveBeenCalledTimes(1);
    expect(firstCallOf(phases.executeReviewPatchCycle)).toBeLessThan(firstCallOf(phases.executeScenarioTestPhase));
    expect(phases.executeReviewPhase).toHaveBeenNthCalledWith(2, expect.anything(), RETEST_PROOF_PATH);
  });

  it('ends the run with no review, no pull request and no awaiting_merge when the loop fails', async () => {
    const { config } = makeConfig();
    const phases = makePhases([PASSED_REVIEW]);
    const failure = new LoopFailure();
    phases.runScenarioTestFixLoop.mockRejectedValueOnce(failure);

    await expect(executePlanBuildReview(config, phases as unknown as PlanBuildReviewPhases)).rejects.toBe(failure);

    expect(handleWorkflowError).toHaveBeenCalledWith(config, failure, expect.any(Number), expect.anything());
    expect(phases.executeReviewPhase).not.toHaveBeenCalled();
    expect(phases.executePRPhase).not.toHaveBeenCalled();
    expect(writtenStages()).toEqual([]);
  });

  it('records the scenario retries in the orchestrator metadata of a run whose review passes', async () => {
    const { config } = await runWithReviews(PASSED_REVIEW);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ reviewPassed: true, scenarioRetries: SCENARIO_RETRIES }),
    });
  });

  it('records the scenario retries in the orchestrator metadata of a run that ends at review_failed', async () => {
    const { config } = await runWithReviews(FAILED_REVIEW);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ reviewPassed: false, scenarioRetries: SCENARIO_RETRIES }),
    });
  });
});
