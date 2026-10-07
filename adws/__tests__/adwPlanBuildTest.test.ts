import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
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
    completeWorkflow: vi.fn(async () => undefined),
    handleWorkflowError: vi.fn((_config: unknown, error: unknown) => {
      throw error;
    }),
  };
});

import { executePlanBuildTest, type PlanBuildTestPhases } from '../adwPlanBuildTest';
import { AgentStateManager } from '../core';
import { runPhase } from '../core/phaseRunner';
import { persistTokenCounts } from '../cost';
import { completeWorkflow } from '../workflowPhases';
import type { WorkflowConfig } from '../phases';

const BRANCH = 'feature-issue-42-csv-export';
const SCENARIO_RETRIES = 2;
const ZERO_COST = { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };

const SERVER_OUTPUT = "Error: Cannot find module './routes'";
const NOT_STARTED = { status: 'not_started' };
const STARTED = { status: 'started' };
const FAILED_START = { status: 'failed', command: 'bun run dev --port 4567', healthUrl: 'http://localhost:4567/', output: SERVER_OUTPUT };
type DevServerStart = typeof NOT_STARTED | typeof STARTED | typeof FAILED_START;

function makePhases(devServer: DevServerStart) {
  return {
    executeBaselinePhase: vi.fn(async () => ZERO_COST),
    executeInstallPhase: vi.fn(async () => ZERO_COST),
    executePlanPhase: vi.fn(async () => ZERO_COST),
    executeBuildPhase: vi.fn(async () => ZERO_COST),
    executeStepDefPhase: vi.fn(async () => ZERO_COST),
    executeUnitTestPhase: vi.fn(async () => ({ ...ZERO_COST, unitTestsPassed: true, totalRetries: 1 })),
    runScenarioTestFixLoop: vi.fn(async () => ({ scenarioProofPath: '/proof.md', scenarioRetries: SCENARIO_RETRIES, devServer })),
    executePRPhase: vi.fn(async () => ZERO_COST),
    executeProofPublishPhase: vi.fn(async () => ZERO_COST),
  };
}

function makeConfig() {
  const commentOnIssue = vi.fn();
  const config = {
    issueNumber: 42,
    adwId: 'adw-test',
    orchestratorStatePath: '/mock/agents/adw-test/plan-build-test',
    ctx: { issueNumber: 42, adwId: 'adw-test', branchName: BRANCH },
    repoContext: { issueTracker: { commentOnIssue } },
  } as unknown as WorkflowConfig;
  return { config, commentOnIssue };
}

async function runWith(devServer: DevServerStart) {
  const { config, commentOnIssue } = makeConfig();
  const phases = makePhases(devServer);
  await executePlanBuildTest(config, phases as unknown as PlanBuildTestPhases);
  return { config, commentOnIssue, phases };
}

function writtenStages(): Array<string | undefined> {
  return vi.mocked(AgentStateManager.writeTopLevelState).mock.calls.map(([, state]) => state.workflowStage);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executePlanBuildTest — the dev server does not start on the issue branch', () => {
  it('stops at review_failed', async () => {
    await runWith(FAILED_START);

    expect(writtenStages()).toEqual(['review_failed']);
  });

  it('opens no pull request, publishes no proof and does not complete the workflow', async () => {
    const { phases } = await runWith(FAILED_START);

    expect(phases.executePRPhase).not.toHaveBeenCalled();
    expect(phases.executeProofPublishPhase).not.toHaveBeenCalled();
    expect(completeWorkflow).not.toHaveBeenCalled();
  });

  it('puts the server output in the issue comments, and tells the branch and ## Retry in the last one', async () => {
    const { commentOnIssue } = await runWith(FAILED_START);

    const comments = commentOnIssue.mock.calls.map(([, body]) => String(body));
    expect(comments.length).toBeGreaterThan(0);
    comments.forEach(body => expect(body).toContain(SERVER_OUTPUT));
    const last = comments[comments.length - 1];
    expect(last).toContain('## Retry');
    expect(last).toContain(BRANCH);
  });

  it('records the failed review in the orchestrator metadata, as one failed review, and persists the cost', async () => {
    const { config } = await runWith(FAILED_START);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: {
        totalCostUsd: 0,
        unitTestsPassed: true,
        totalTestRetries: 1,
        scenarioRetries: SCENARIO_RETRIES,
        reviewPassed: false,
        totalReviewRetries: 1,
      },
    });
    expect(persistTokenCounts).toHaveBeenCalledWith(config.orchestratorStatePath, 0, expect.any(Object));
  });
});

describe('executePlanBuildTest — the dev server started, or no dev server is declared', () => {
  it.each([
    ['started', STARTED],
    ['not declared', NOT_STARTED],
  ])('opens the pull request, publishes the proof and completes the workflow when the dev server is %s', async (_name, devServer) => {
    const { config, phases } = await runWith(devServer);

    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(phases.executeProofPublishPhase).toHaveBeenCalledTimes(1);
    expect(completeWorkflow).toHaveBeenCalledWith(
      config,
      0,
      { unitTestsPassed: true, totalTestRetries: 1, scenarioRetries: SCENARIO_RETRIES },
      expect.any(Object),
    );
    expect(writtenStages()).toEqual([]);
  });
});

class ParkedSignal extends Error {}

describe('executePlanBuildTest — the baseline', () => {
  it('runs first, as the phase named baseline, before the install phase and the plan phase', async () => {
    const { config, phases } = await runWith(NOT_STARTED);

    const baseline = phases.executeBaselinePhase.mock.invocationCallOrder[0];
    expect(baseline).toBeLessThan(phases.executeInstallPhase.mock.invocationCallOrder[0]);
    expect(baseline).toBeLessThan(phases.executePlanPhase.mock.invocationCallOrder[0]);
    expect(vi.mocked(runPhase)).toHaveBeenNthCalledWith(1, config, expect.anything(), phases.executeBaselinePhase, 'baseline');
  });

  it('stops the run before any plan is written when it parks the workflow', async () => {
    const { config } = makeConfig();
    const phases = makePhases(NOT_STARTED);
    phases.executeBaselinePhase.mockRejectedValueOnce(new ParkedSignal());

    await expect(executePlanBuildTest(config, phases as unknown as PlanBuildTestPhases)).rejects.toBeInstanceOf(ParkedSignal);

    expect(phases.executeInstallPhase).not.toHaveBeenCalled();
    expect(phases.executePlanPhase).not.toHaveBeenCalled();
    expect(phases.executeBuildPhase).not.toHaveBeenCalled();
  });
});
