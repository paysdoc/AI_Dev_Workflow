import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { DevServerStartStatus, NO_DEV_SERVER_START, type DevServerStart, type FailedDevServerStart } from '../../core/devServerFailure';
import { runReviewRetryLoop, scenarioOutcomeOf, type ReviewRetryPhases, type ScenarioOutcome } from '../reviewRetryLoop';
import type { ReviewIssue } from '../reviewPhase';
import type { WorkflowConfig } from '../workflowInit';

const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
const MAX_ATTEMPTS = 3;

const STARTED: DevServerStart = { status: DevServerStartStatus.Started };
const FAILED: FailedDevServerStart = {
  status: DevServerStartStatus.Failed,
  command: 'bun run dev --port 4567',
  healthUrl: 'http://localhost:4567/',
  output: "Error: Cannot find module './routes'",
};

const outcome = (devServer: DevServerStart, scenarioProofPath = '/proof.md'): ScenarioOutcome => ({ scenarioProofPath, devServer });

const CART_BLOCKER: ReviewIssue = {
  reviewIssueNumber: 1,
  issueDescription: 'The cart total ignores the delivery fee',
  issueResolution: 'Add the fee',
  issueSeverity: 'blocker',
  remediationStrategy: 'patch',
};

type Verdict = 'passes' | 'fails';

interface Setup {
  readonly phases: ReviewRetryPhases;
  readonly config: WorkflowConfig;
  readonly review: ReturnType<typeof vi.fn>;
  readonly patch: ReturnType<typeof vi.fn>;
  readonly scenarioPhase: ReturnType<typeof vi.fn>;
  /** `[reviewAttempt, maxReviewAttempts]` on the context at each review. */
  readonly attemptsShown: Array<[number | undefined, number | undefined]>;
  /** The proof path each review was handed. */
  readonly proofPaths: string[];
}

/** `later` are the outcomes of the scenario runs after each patch, in turn; the last one repeats. */
function setUp(later: readonly ScenarioOutcome[], verdicts: readonly Verdict[] = ['fails']): Setup {
  const config = { ctx: {}, issueNumber: 42, orchestratorStatePath: '/state' } as unknown as WorkflowConfig;
  const attemptsShown: Setup['attemptsShown'] = [];
  const proofPaths: string[] = [];
  let reviewed = 0;
  let ran = 0;
  const review = vi.fn(async (cfg: WorkflowConfig, proofPath: string) => {
    attemptsShown.push([cfg.ctx.reviewAttempt, cfg.ctx.maxReviewAttempts]);
    proofPaths.push(proofPath);
    const verdict = verdicts[Math.min(reviewed++, verdicts.length - 1)];
    return { ...ZERO_COST, reviewPassed: verdict === 'passes', reviewIssues: verdict === 'passes' ? [] : [CART_BLOCKER], totalRetries: 0 };
  });
  const patch = vi.fn(async (_cfg: WorkflowConfig, _blockers: ReviewIssue[]) => ZERO_COST);
  const scenarioPhase = vi.fn(async () => {
    const next = later[Math.min(ran++, later.length - 1)];
    const scenarioProof = next.scenarioProofPath === '' ? undefined : { resultsFilePath: next.scenarioProofPath };
    return { ...ZERO_COST, scenarioProof, devServer: next.devServer };
  });
  const phases = {
    executeReviewPhase: review,
    executeReviewPatchCycle: patch,
    executeScenarioTestPhase: scenarioPhase,
  } as unknown as ReviewRetryPhases;
  return { phases, config, review, patch, scenarioPhase, attemptsShown, proofPaths };
}

function run(setup: Setup, start: ScenarioOutcome, maxAttempts = MAX_ATTEMPTS) {
  return runReviewRetryLoop(setup.config, new CostTracker(), start, setup.phases, maxAttempts);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runReviewRetryLoop — a server that starts every time never resets the count', () => {
  it('stops after the third failed review', async () => {
    const setup = setUp([outcome(STARTED)]);

    const result = await run(setup, outcome(STARTED));

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 3 });
    expect(setup.review).toHaveBeenCalledTimes(3);
    expect(setup.patch).toHaveBeenCalledTimes(2);
  });

  it('counts the attempts on the context as 1/3, 2/3 and 3/3', async () => {
    const setup = setUp([outcome(STARTED)]);

    await run(setup, outcome(STARTED));

    expect(setup.attemptsShown).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});

describe('runReviewRetryLoop — no server is declared', () => {
  it('behaves as the loop of the orchestrators did: three reviews, two patches, three retries', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START)]);

    const result = await run(setup, outcome(NO_DEV_SERVER_START));

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 3 });
    expect(setup.review).toHaveBeenCalledTimes(3);
    expect(setup.patch).toHaveBeenCalledTimes(2);
    expect(setup.scenarioPhase).toHaveBeenCalledTimes(2);
  });

  it('returns at once when the first review passes', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START)], ['passes']);

    const result = await run(setup, outcome(NO_DEV_SERVER_START));

    expect(result).toEqual({ reviewPassed: true, reviewRetries: 0 });
    expect(setup.patch).not.toHaveBeenCalled();
    expect(setup.scenarioPhase).not.toHaveBeenCalled();
  });

  it('returns at once when a review passes after a patch', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START)], ['fails', 'passes']);

    const result = await run(setup, outcome(NO_DEV_SERVER_START));

    expect(result).toEqual({ reviewPassed: true, reviewRetries: 1 });
    expect(setup.review).toHaveBeenCalledTimes(2);
    expect(setup.patch).toHaveBeenCalledTimes(1);
  });

  it('hands each review the proof of the scenario run before it, starting with the one it was given', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START, '/second.md'), outcome(NO_DEV_SERVER_START, '')]);

    await run(setup, outcome(NO_DEV_SERVER_START, '/first.md'));

    expect(setup.proofPaths).toEqual(['/first.md', '/second.md', '']);
  });

  it('hands the patch cycle the blockers the review found', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START)]);

    await run(setup, outcome(NO_DEV_SERVER_START));

    expect(setup.patch.mock.calls[0][1]).toEqual([CART_BLOCKER]);
  });

  it('hands the patch cycle only the blockers, not the tech debt', async () => {
    const setup = setUp([outcome(NO_DEV_SERVER_START)]);
    const techDebt: ReviewIssue = { ...CART_BLOCKER, reviewIssueNumber: 2, issueSeverity: 'tech-debt' };
    setup.review.mockResolvedValueOnce({ ...ZERO_COST, reviewPassed: false, reviewIssues: [CART_BLOCKER, techDebt], totalRetries: 0 });

    await run(setup, outcome(NO_DEV_SERVER_START), 2);

    expect(setup.patch.mock.calls[0][1]).toEqual([CART_BLOCKER]);
  });
});

describe('runReviewRetryLoop — one budget for failed reviews and failed starts', () => {
  it('spends the third attempt on a second failed start after a failed review and a failed start', async () => {
    const setup = setUp([outcome(FAILED, ''), outcome(FAILED, '')]);

    const result = await run(setup, outcome(STARTED));

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 3 });
    expect(setup.review).toHaveBeenCalledTimes(1);
    expect(setup.patch).toHaveBeenCalledTimes(2);
  });

  it('patches the review blocker first, and the server blocker after it', async () => {
    const setup = setUp([outcome(FAILED, ''), outcome(FAILED, '')]);

    await run(setup, outcome(STARTED));

    expect(setup.patch.mock.calls[0][1]).toEqual([CART_BLOCKER]);
    expect(setup.patch.mock.calls[1][1]).toHaveLength(1);
    expect(setup.patch.mock.calls[1][1][0].issueDescription).toContain("Cannot find module './routes'");
  });

  it('spends the budget at once when it is one attempt and the first start failed, with no patch', async () => {
    const setup = setUp([outcome(STARTED)]);

    const result = await run(setup, outcome(FAILED, ''), 1);

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 1 });
    expect(setup.patch).not.toHaveBeenCalled();
    expect(setup.review).not.toHaveBeenCalled();
  });
});

describe('runReviewRetryLoop — the attempt shown on the context', () => {
  it('shows 1/3 on the first review after a reset, as it did on the first review of the run', async () => {
    const setup = setUp([outcome(STARTED)]);

    await run(setup, outcome(FAILED, ''));

    expect(setup.attemptsShown[0]).toEqual([1, 3]);
    expect(setup.attemptsShown).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('does not set the attempt for a failed start, which runs no review', async () => {
    const setup = setUp([outcome(FAILED, '')]);

    await run(setup, outcome(FAILED, ''));

    expect(setup.config.ctx.reviewAttempt).toBeUndefined();
  });
});

describe('runReviewRetryLoop — a review budget of zero', () => {
  it('runs no review and no patch, and the review has not passed', async () => {
    const setup = setUp([outcome(STARTED)]);

    const result = await run(setup, outcome(STARTED), 0);

    expect(result).toEqual({ reviewPassed: false, reviewRetries: 0 });
    expect(setup.review).not.toHaveBeenCalled();
    expect(setup.patch).not.toHaveBeenCalled();
    expect(setup.scenarioPhase).not.toHaveBeenCalled();
  });
});

describe('scenarioOutcomeOf', () => {
  it('takes the proof path and the dev server start from a scenario phase result', () => {
    const phaseResult = { scenarioProof: { resultsFilePath: '/proof.md' }, devServer: STARTED };

    expect(scenarioOutcomeOf(phaseResult as never)).toEqual({ scenarioProofPath: '/proof.md', devServer: STARTED });
  });

  it('has an empty proof path when no scenario ran', () => {
    expect(scenarioOutcomeOf({ scenarioProof: undefined, devServer: FAILED } as never)).toEqual({ scenarioProofPath: '', devServer: FAILED });
  });
});
