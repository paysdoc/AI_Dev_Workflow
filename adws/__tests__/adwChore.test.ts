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
  };
});

vi.mock('../cost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cost')>();
  return { ...actual, persistTokenCounts: vi.fn() };
});

import { executeChore, type ChorePhases } from '../adwChore';
import { AgentStateManager } from '../core';
import { persistTokenCounts } from '../cost';
import type { WorkflowConfig } from '../phases';

const BRANCH = 'chore-issue-42-rename-config-keys';
const PR_URL = 'https://github.com/acme/widget/pull/77';
const PR_NUMBER = 77;
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

function makePhases(diffVerdict: 'regression_possible' | 'safe', reviews: ReviewVerdict[]) {
  return {
    executeInstallPhase: vi.fn(async () => ZERO_COST),
    executePlanPhase: vi.fn(async () => ZERO_COST),
    executeBuildPhase: vi.fn(async () => ZERO_COST),
    executeStepDefPhase: vi.fn(async () => ZERO_COST),
    executeUnitTestPhase: vi.fn(async () => ({ ...ZERO_COST, unitTestsPassed: true, totalRetries: 0 })),
    runScenarioTestFixLoop: vi.fn(async () => ({ scenarioProofPath: '/proof.md', scenarioRetries: 0 })),
    executeDiffEvaluationPhase: vi.fn(async () => ({ ...ZERO_COST, verdict: diffVerdict, reason: 'test' })),
    executeReviewPhase: scriptedReview(reviews),
    executeReviewPatchCycle: vi.fn(async () => ZERO_COST),
    executeScenarioTestPhase: vi.fn(async () => ({ ...ZERO_COST, scenarioProof: undefined })),
    executeDocumentPhase: vi.fn(async () => ZERO_COST),
    executePRPhase: vi.fn(async (cfg: WorkflowConfig) => {
      cfg.ctx.prUrl = PR_URL;
      return ZERO_COST;
    }),
  };
}

// An issue without the hitl label, so a pre-approval that should not happen would be visible.
function makeConfig() {
  const commentOnIssue = vi.fn();
  const approvePullRequest = vi.fn(() => ({ success: true }));
  const config = {
    issueNumber: 42,
    adwId: 'adw-test',
    orchestratorStatePath: '/mock/agents/adw-test/chore',
    ctx: { issueNumber: 42, adwId: 'adw-test', branchName: BRANCH },
    repoContext: {
      issueTracker: { commentOnIssue, fetchLabels: vi.fn(() => [] as string[]) },
      codeHost: { approvePullRequest },
    },
  } as unknown as WorkflowConfig;
  return { config, commentOnIssue, approvePullRequest };
}

async function runChore(diffVerdict: 'regression_possible' | 'safe', reviews: ReviewVerdict[]) {
  const { config, commentOnIssue, approvePullRequest } = makeConfig();
  const phases = makePhases(diffVerdict, reviews);
  await executeChore(config, phases as unknown as ChorePhases);
  return { config, commentOnIssue, approvePullRequest, phases };
}

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
