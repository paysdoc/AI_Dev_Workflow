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

import type { ChorePhases } from '../adwChore';
import { executeChore } from '../adwChore';
import { AgentStateManager } from '../core';
import { runPhase } from '../core/phaseRunner';
import { persistTokenCounts } from '../cost';
import { FAILED_REVIEW, PASSED_REVIEW, PR_NUMBER, BRANCH, makeConfig, makePhases, runChore } from './adwChore.helpers';

function writtenStages(): Array<string | undefined> {
  return vi.mocked(AgentStateManager.writeTopLevelState).mock.calls.map(([, state]) => state.workflowStage);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeChore — the diff judge escalated the chore and the review still has blockers after its last attempt', () => {
  it('attempts the review as often as the retry budget allows, patching between attempts', async () => {
    const { phases } = await runChore('regression_possible', [FAILED_REVIEW]);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(3);
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
  });

  it('stops at review_failed and never writes awaiting_merge', async () => {
    await runChore('regression_possible', [FAILED_REVIEW]);

    expect(writtenStages()).toEqual(['review_failed']);
  });

  it('runs no document phase, opens no pull request and approves nothing', async () => {
    const { phases, approvePullRequest } = await runChore('regression_possible', [FAILED_REVIEW]);

    expect(phases.executeDocumentPhase).not.toHaveBeenCalled();
    expect(phases.executePRPhase).not.toHaveBeenCalled();
    expect(approvePullRequest).not.toHaveBeenCalled();
  });

  it('records the failed verdict in the orchestrator metadata and persists the cost', async () => {
    const { config } = await runChore('regression_possible', [FAILED_REVIEW]);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({
        reviewPassed: false,
        totalReviewRetries: 3,
        diffVerdict: 'regression_possible',
      }),
    });
    expect(persistTokenCounts).toHaveBeenCalledWith(config.orchestratorStatePath, 0, expect.any(Object));
  });

  it('tells the issue which branch holds the work and to post ## Retry', async () => {
    const { commentOnIssue } = await runChore('regression_possible', [FAILED_REVIEW]);

    const retryComment = commentOnIssue.mock.calls
      .map(([, body]) => String(body))
      .find(body => body.includes('## Retry'));
    expect(retryComment, 'no comment tells a human to post ## Retry').toBeDefined();
    expect(retryComment).toContain(BRANCH);
  });
});

describe('executeChore — the diff judge escalated the chore and the review passes', () => {
  it('documents, opens and pre-approves the pull request and ends at awaiting_merge', async () => {
    const { phases, approvePullRequest } = await runChore('regression_possible', [PASSED_REVIEW]);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(1);
    expect(phases.executeDocumentPhase).toHaveBeenCalledTimes(1);
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(PR_NUMBER);
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });

  it('opens the pull request and leaves it unapproved when the issue has the hitl label', async () => {
    const { phases, approvePullRequest } = await runChore('regression_possible', [PASSED_REVIEW], ['hitl']);

    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).not.toHaveBeenCalled();
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });

  it('records the passed verdict in the orchestrator metadata', async () => {
    const { config } = await runChore('regression_possible', [PASSED_REVIEW]);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ reviewPassed: true, diffVerdict: 'regression_possible' }),
    });
  });

  it('carries on to the pull request when a patch turns the first failed attempt into a pass', async () => {
    const { phases, approvePullRequest } = await runChore('regression_possible', [FAILED_REVIEW, PASSED_REVIEW]);

    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(2);
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(1);
    expect(phases.executeDocumentPhase).toHaveBeenCalledTimes(1);
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(PR_NUMBER);
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });
});

describe('executeChore — the diff judge rules the chore safe', () => {
  it('runs no review or document phase and still opens and pre-approves the pull request', async () => {
    // A review that would fail if it ran: a safe chore has no verdict, so nothing may stop it.
    const { phases, approvePullRequest } = await runChore('safe', [FAILED_REVIEW]);

    expect(phases.executeReviewPhase).not.toHaveBeenCalled();
    expect(phases.executeDocumentPhase).not.toHaveBeenCalled();
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(PR_NUMBER);
    expect(writtenStages()).toEqual(['awaiting_merge']);
  });
});

class ParkedSignal extends Error {}

describe('executeChore — the baseline', () => {
  it('runs first, as the phase named baseline, before the install phase and the plan phase', async () => {
    const { config, phases } = await runChore('safe', [PASSED_REVIEW]);

    const baseline = phases.executeBaselinePhase.mock.invocationCallOrder[0];
    expect(baseline).toBeLessThan(phases.executeInstallPhase.mock.invocationCallOrder[0]);
    expect(baseline).toBeLessThan(phases.executePlanPhase.mock.invocationCallOrder[0]);
    expect(vi.mocked(runPhase)).toHaveBeenNthCalledWith(1, config, expect.anything(), phases.executeBaselinePhase, 'baseline');
  });

  it('stops the run before any plan is written when it parks the workflow', async () => {
    const { config } = makeConfig();
    const phases = makePhases('safe', [PASSED_REVIEW]);
    phases.executeBaselinePhase.mockRejectedValueOnce(new ParkedSignal());

    await expect(executeChore(config, phases as unknown as ChorePhases)).rejects.toBeInstanceOf(ParkedSignal);

    expect(phases.executeInstallPhase).not.toHaveBeenCalled();
    expect(phases.executePlanPhase).not.toHaveBeenCalled();
    expect(phases.executeBuildPhase).not.toHaveBeenCalled();
  });
});
