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

import { AgentStateManager } from '../core';
import { persistTokenCounts } from '../cost';
import { FAILED_START, PASSED_REVIEW, FAILED_REVIEW, PR_NUMBER, SERVER_OUTPUT, STARTED, commentsPosted, runChore } from './adwChore.helpers';

function writtenStages(): Array<string | undefined> {
  return vi.mocked(AgentStateManager.writeTopLevelState).mock.calls.map(([, state]) => state.workflowStage);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeChore — the escalation comment says why', () => {
  it('names a possible regression when the diff judge escalated and the dev server is healthy', async () => {
    const { commentOnIssue } = await runChore('regression_possible', [PASSED_REVIEW], [], [STARTED]);

    expect(commentsPosted(commentOnIssue).some(body => body.includes('## Chore Escalation: Regression Possible'))).toBe(true);
    expect(commentsPosted(commentOnIssue).some(body => body.includes('Dev Server Did Not Start'))).toBe(false);
  });

  it('posts no escalation comment for a safe chore whose dev server started', async () => {
    const { commentOnIssue } = await runChore('safe', [FAILED_REVIEW], [], [STARTED]);

    expect(commentsPosted(commentOnIssue).filter(body => body.includes('Chore Escalation'))).toEqual([]);
  });
});

describe('executeChore — the diff judge rules the chore safe but the dev server does not start on the issue branch', () => {
  it('escalates the chore with the dev server comment and not the regression comment', async () => {
    const { commentOnIssue } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START]);

    const escalations = commentsPosted(commentOnIssue).filter(body => body.includes('Chore Escalation'));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toContain('## Chore Escalation: Dev Server Did Not Start');
    expect(escalations[0]).toContain('failed review');
    expect(escalations[0]).toContain('review → document → PR');
    expect(escalations[0]).not.toContain('Regression Possible');
  });

  it('prefers the dev server comment when the diff judge escalated too', async () => {
    const { commentOnIssue } = await runChore('regression_possible', [PASSED_REVIEW], [], [FAILED_START]);

    const escalations = commentsPosted(commentOnIssue).filter(body => body.includes('Chore Escalation'));
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toContain('Dev Server Did Not Start');
  });

  it('never runs the review agent, and hands the patch cycle the server blocker twice', async () => {
    const { phases } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START]);

    expect(phases.executeReviewPhase).not.toHaveBeenCalled();
    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(2);
    phases.executeReviewPatchCycle.mock.calls.forEach(([, blockers]) => {
      expect(blockers).toHaveLength(1);
      expect(blockers[0].issueDescription).toContain(SERVER_OUTPUT);
    });
  });

  it('stops at review_failed: no document phase, no pull request, no pre-approval', async () => {
    const { phases, approvePullRequest } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START]);

    expect(writtenStages()).toEqual(['review_failed']);
    expect(phases.executeDocumentPhase).not.toHaveBeenCalled();
    expect(phases.executePRPhase).not.toHaveBeenCalled();
    expect(approvePullRequest).not.toHaveBeenCalled();
  });

  it('records the judge\'s verdict next to the failed review in the orchestrator metadata', async () => {
    const { config } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START]);

    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ diffVerdict: 'safe', reviewPassed: false, totalReviewRetries: 3 }),
    });
    expect(persistTokenCounts).toHaveBeenCalledWith(config.orchestratorStatePath, 0, expect.any(Object));
  });

  it('puts the server output and ## Retry in the issue comments', async () => {
    const { commentOnIssue } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START]);

    const reviewFailed = commentsPosted(commentOnIssue).filter(body => body.includes('Review Failed'));
    expect(reviewFailed.length).toBeGreaterThan(0);
    reviewFailed.forEach(body => expect(body).toContain(SERVER_OUTPUT));
    expect(reviewFailed[reviewFailed.length - 1]).toContain('## Retry');
  });

  it('documents, opens and pre-approves the pull request when the server starts again after one failure and the review passes', async () => {
    const { phases, approvePullRequest, config } = await runChore('safe', [PASSED_REVIEW], [], [FAILED_START, STARTED]);

    expect(phases.executeReviewPatchCycle).toHaveBeenCalledTimes(1);
    expect(phases.executeReviewPhase).toHaveBeenCalledTimes(1);
    expect(phases.executeDocumentPhase).toHaveBeenCalledTimes(1);
    expect(phases.executePRPhase).toHaveBeenCalledTimes(1);
    expect(approvePullRequest).toHaveBeenCalledWith(PR_NUMBER);
    expect(writtenStages()).toEqual(['awaiting_merge']);
    expect(AgentStateManager.writeState).toHaveBeenCalledWith(config.orchestratorStatePath, {
      metadata: expect.objectContaining({ diffVerdict: 'safe', reviewPassed: true, totalReviewRetries: 1 }),
    });
  });
});
