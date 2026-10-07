import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scenarioProof', () => ({
  runScenarioProof: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    MAX_REVIEW_RETRY_ATTEMPTS: 3,
    AgentStateManager: { appendLog: vi.fn() },
    log: vi.fn(),
  };
});

vi.mock('../../core/phaseRunner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/phaseRunner')>();
  return { ...actual, runPhase: vi.fn(async (config, _tracker, fn) => fn(config)) };
});

import { CostTracker } from '../../core/phaseRunner';
import { DevServerStartStatus, type FailedDevServerStart } from '../../core/devServerFailure';
import type { HealthyDevServerConfig, HealthyDevServerOutcome } from '../../core/devServerLifecycle';
import { executeScenarioTestPhase } from '../scenarioTestPhase';
import { runScenarioProof } from '../scenarioProof';
import { runReviewRetryLoop, type ReviewRetryPhases, type ScenarioOutcome } from '../reviewRetryLoop';
import type { ReviewIssue } from '../reviewPhase';
import type { WorkflowConfig } from '../workflowInit';
import { makeConfig, passingProof } from './scenarioTestPhase.helpers';

const mockRunScenarioProof = vi.mocked(runScenarioProof);

const SERVER_OUTPUT = "Error: Cannot find module './routes'\n    at start (server.js:3:1)";
const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
const MAX_ATTEMPTS = 3;

const FAILED_START: FailedDevServerStart = {
  status: DevServerStartStatus.Failed,
  command: 'bun run dev --port 4567',
  healthUrl: 'http://localhost:4567/',
  output: SERVER_OUTPUT,
};
const FIRST_RUN_FAILED: ScenarioOutcome = { scenarioProofPath: '', devServer: FAILED_START };

const CART_BLOCKER: ReviewIssue = {
  reviewIssueNumber: 1,
  issueDescription: 'The cart total ignores the delivery fee',
  issueResolution: 'Add the fee',
  issueSeverity: 'blocker',
  remediationStrategy: 'patch',
};

type Start = 'start' | { readonly fail: string };
type Verdict = 'passes' | 'fails';

/** Answers each start in turn, then repeats the last answer; a start that "starts" runs the work. */
function scriptedLifecycle(script: readonly Start[], order: string[]) {
  let next = 0;
  const configs: HealthyDevServerConfig[] = [];
  const withHealthyDevServer = async <T>(config: HealthyDevServerConfig, work: () => Promise<T>): Promise<HealthyDevServerOutcome<T>> => {
    const answer = script[Math.min(next++, script.length - 1)];
    configs.push(config);
    order.push('start');
    if (answer !== 'start') return { started: false, output: answer.fail };
    return { started: true, result: await work() };
  };
  return { withHealthyDevServer, configs };
}

function makeSetup(starts: readonly Start[], verdicts: readonly Verdict[] = ['fails']) {
  const order: string[] = [];
  const lifecycle = scriptedLifecycle(starts, order);
  let review = 0;
  const executeReviewPhase = vi.fn(async () => {
    order.push('review');
    const verdict = verdicts[Math.min(review++, verdicts.length - 1)];
    return { ...ZERO_COST, reviewPassed: verdict === 'passes', reviewIssues: verdict === 'passes' ? [] : [CART_BLOCKER], totalRetries: 0 };
  });
  const executeReviewPatchCycle = vi.fn(async (_config: WorkflowConfig, _blockers: ReviewIssue[]) => {
    order.push('patch');
    return ZERO_COST;
  });
  const phases: ReviewRetryPhases = {
    executeReviewPhase: executeReviewPhase as unknown as ReviewRetryPhases['executeReviewPhase'],
    executeReviewPatchCycle,
    executeScenarioTestPhase: config =>
      executeScenarioTestPhase(config, { readDeclaredDevServer: () => 'bun run dev --port {PORT}', withHealthyDevServer: lifecycle.withHealthyDevServer as never }),
  };
  return { phases, order, lifecycle, executeReviewPhase, executeReviewPatchCycle };
}

function makeWorkflowConfig(): { config: WorkflowConfig; commentOnIssue: ReturnType<typeof vi.fn> } {
  const commentOnIssue = vi.fn();
  const config = makeConfig();
  config.ctx = { issueNumber: 42, adwId: 'test-id', branchName: 'feature-42-test' } as unknown as WorkflowConfig['ctx'];
  config.repoContext = { issueTracker: { commentOnIssue } } as unknown as WorkflowConfig['repoContext'];
  return { config, commentOnIssue };
}

function run(setup: ReturnType<typeof makeSetup>, start: ScenarioOutcome = FIRST_RUN_FAILED, config: WorkflowConfig = makeWorkflowConfig().config) {
  return runReviewRetryLoop(config, new CostTracker(), start, setup.phases, MAX_ATTEMPTS);
}

function blockersHandedToPatch(setup: ReturnType<typeof makeSetup>, call: number): ReviewIssue[] {
  return setup.executeReviewPatchCycle.mock.calls[call][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRunScenarioProof.mockResolvedValue(passingProof);
});

describe('runReviewRetryLoop — a dev server that did not start on the issue branch', () => {
  it('runs no review agent for the failed start, and hands the patch cycle one blocker', async () => {
    const setup = makeSetup(['start'], ['passes']);

    await run(setup);

    expect(setup.order.slice(0, 2)).toEqual(['patch', 'start']);
    expect(blockersHandedToPatch(setup, 0)).toHaveLength(1);
  });

  it('makes that blocker a patch blocker that carries the server output, the command and the health URL', async () => {
    const setup = makeSetup(['start'], ['passes']);

    await run(setup);

    const [blocker] = blockersHandedToPatch(setup, 0);
    expect(blocker).toMatchObject({ issueSeverity: 'blocker', remediationStrategy: 'patch' });
    expect(blocker.issueDescription).toContain(SERVER_OUTPUT);
    expect(blocker.issueDescription).toContain(FAILED_START.command);
    expect(blocker.issueDescription).toContain(FAILED_START.healthUrl);
  });

  it('starts the dev server again after the builder patched, and not before', async () => {
    const setup = makeSetup(['start'], ['passes']);

    await run(setup);

    expect(setup.order).toEqual(['patch', 'start', 'review']);
  });

  it('runs a scenario only against a server that started', async () => {
    const setup = makeSetup([{ fail: SERVER_OUTPUT }, 'start'], ['passes']);

    await run(setup);

    expect(setup.order).toEqual(['patch', 'start', 'patch', 'start', 'review']);
    expect(mockRunScenarioProof).toHaveBeenCalledTimes(1);
  });

  it('counts each failed start as a failed review: three failed starts end it with two patches and no review', async () => {
    const setup = makeSetup([{ fail: SERVER_OUTPUT }]);

    const result = await run(setup);

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 3 });
    expect(setup.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
    expect(setup.executeReviewPhase).not.toHaveBeenCalled();
    expect(mockRunScenarioProof).not.toHaveBeenCalled();
    expect(setup.lifecycle.configs).toHaveLength(2);
  });

  it('hands the server output of the latest failed start to the builder each time', async () => {
    const setup = makeSetup([{ fail: 'second output' }, { fail: 'third output' }]);

    await run(setup);

    expect(blockersHandedToPatch(setup, 0)[0].issueDescription).toContain(SERVER_OUTPUT);
    expect(blockersHandedToPatch(setup, 1)[0].issueDescription).toContain('second output');
  });

  it('leaves the server blocker on the context and posts a review_failed comment that carries the output', async () => {
    const { config, commentOnIssue } = makeWorkflowConfig();
    const setup = makeSetup([{ fail: SERVER_OUTPUT }]);

    await run(setup, FIRST_RUN_FAILED, config);

    expect(config.ctx.reviewIssues).toEqual([expect.objectContaining({ issueSeverity: 'blocker', issueDescription: expect.stringContaining(SERVER_OUTPUT) })]);
    const comments = commentOnIssue.mock.calls.map(([, body]) => String(body));
    expect(comments).toHaveLength(3);
    comments.forEach(body => {
      expect(body).toContain('Review Failed');
      expect(body).toContain("Error: Cannot find module './routes'");
    });
  });

  it('leaves no scenario proof and no screenshot from an earlier run on the context', async () => {
    const { config } = makeWorkflowConfig();
    config.ctx.scenarioProof = passingProof;
    config.ctx.screenshotUrls = ['https://example.test/old.png'];
    const setup = makeSetup([{ fail: SERVER_OUTPUT }]);

    await run(setup, FIRST_RUN_FAILED, config);

    expect(config.ctx.scenarioProof).toBeUndefined();
    expect(config.ctx.screenshotUrls).toEqual([]);
  });
});

describe('runReviewRetryLoop — the server starts again after failed starts', () => {
  it('sets the failed count to zero, so that a review failing every time still gets all of its attempts', async () => {
    const setup = makeSetup([{ fail: SERVER_OUTPUT }, 'start'], ['fails']);

    const result = await run(setup);

    expect(setup.executeReviewPhase).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result).toEqual({ reviewPassed: false, reviewRetries: 2 + MAX_ATTEMPTS });
  });

  it('keeps counting the total of failed reviews in the retries it reports', async () => {
    const setup = makeSetup([{ fail: SERVER_OUTPUT }, 'start'], ['fails']);

    const { reviewRetries } = await run(setup);

    expect(reviewRetries).toBe(5);
  });

  it('lets a review that passes only after the reset go through', async () => {
    const setup = makeSetup([{ fail: SERVER_OUTPUT }, 'start'], ['fails', 'fails', 'passes']);

    const result = await run(setup);

    expect(result).toEqual({ reviewPassed: true, reviewRetries: 4 });
    expect(setup.executeReviewPhase).toHaveBeenCalledTimes(3);
  });
});
