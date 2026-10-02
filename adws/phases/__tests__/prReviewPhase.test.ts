/**
 * A PR review runs under the issue's own adwId, so the top-level state it finds still records the
 * finished SDLC run's owner. These tests run the real initializePRReviewWorkflow and chain the real
 * resolver and cron filter behind it: the review must replace that owner with itself, or the cron
 * reads the live review as dead and takes it over.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';
import { Platform } from '@paysdoc/devplatform';

// Pins the start token so the assertions are exact on every platform, as workflowInit.test.ts does.
vi.mock('../../core/processLiveness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/processLiveness')>()),
  getProcessStartTime: vi.fn(),
}));

// With no RepoContext no PR comment is posted.
vi.mock('../../core/workspaceBinding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/workspaceBinding')>()),
  bindWorkspaceContext: vi.fn().mockReturnValue(undefined),
}));

import { initializePRReviewWorkflow } from '../prReviewPhase';
import { getProcessStartTime } from '../../core/processLiveness';
import { AgentStateManager } from '../../core/agentState';
import { resetLogAdwId } from '../../core/logger';
import { AGENTS_STATE_DIR, LOGS_DIR, GRACE_PERIOD_MS } from '../../core/config';
import { resolveIssueWorkflowStage } from '../../triggers/cronStageResolver';
import { evaluateIssue } from '../../triggers/cronIssueFilter';
import { makeIssue, OLD_DATE } from '../../triggers/__tests__/cronIssueFilterFixtures';
import type { LaunchBoundary } from '../../core';

const ADW_ID = 'prreview-owner-unit';
const BRANCH = 'bugfix-issue-9600-pr-review-owner';
const ISSUE_NUMBER = 9600;
const PR_NUMBER = 96;
const TEN_MINUTES_MS = 10 * 60_000;
const FINISHED_RUN = { pid: 2147483646, pidStartedAt: 'finished-sdlc-run', lastSeenAt: '2026-01-01T00:00:00.000Z' } as const;
const ISSUE_COMMENTS = [{ body: `**ADW ID:** \`${ADW_ID}\`` }];

const BOUNDARY = {
  repoId: { owner: 'acme', repo: 'widget', platform: Platform.GitHub },
  providers: {
    codeHost: {
      fetchPullRequest: () => ({
        number: PR_NUMBER,
        title: 'Tidy the retry budget',
        body: '',
        state: 'OPEN',
        sourceBranch: BRANCH,
        targetBranch: 'main',
        url: '',
        linkedIssueNumber: ISSUE_NUMBER,
      }),
      fetchReviewComments: () => [],
      getAuthenticatedUser: () => 'adw-bot',
    },
  },
  gitContext: { owner: 'acme', repo: 'widget', ensureWorktree: () => '/tmp/adw-pr-review-owner-unit' },
} as unknown as LaunchBoundary;

/** What the SDLC run leaves for the PR review to find: awaiting_merge, its own dead owner, and one recorded phase. */
function seedFinishedSdlcRun(): void {
  AgentStateManager.writeTopLevelState(ADW_ID, {
    adwId: ADW_ID,
    issueNumber: ISSUE_NUMBER,
    workflowStage: 'awaiting_merge',
    orchestratorScript: 'adws/adwSdlc.tsx',
    branchName: BRANCH,
    ...FINISHED_RUN,
    // A recorded phase is what lets init run with no unaddressed comments instead of exiting.
    phases: { stepDef: { status: 'completed', startedAt: FINISHED_RUN.lastSeenAt, completedAt: FINISHED_RUN.lastSeenAt } },
  });
}

beforeEach(() => {
  vi.mocked(getProcessStartTime).mockReset();
  seedFinishedSdlcRun();
});

afterEach(() => {
  rmSync(join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
  rmSync(join(LOGS_DIR, ADW_ID), { recursive: true, force: true });
  resetLogAdwId();
});

describe('initializePRReviewWorkflow records the PR review as the issue\'s owner', () => {
  it('replaces the finished SDLC run\'s owner with this run and leaves the stage alone', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue('pr-review-start');
    const startedAt = Date.now();

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    const state = AgentStateManager.readTopLevelState(ADW_ID);
    expect(state?.pid).toBe(process.pid);
    expect(state?.pidStartedAt).toBe('pr-review-start');
    expect(Date.parse(state?.lastSeenAt ?? '')).toBeGreaterThanOrEqual(startedAt);
    expect(state?.workflowStage).toBe('awaiting_merge');
  });

  it('never pairs this pid with the finished run\'s start time', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue(null);

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    const state = AgentStateManager.readTopLevelState(ADW_ID);
    expect(state?.pid).toBe(process.pid);
    expect(state?.pidStartedAt).toBeUndefined();
  });

  it('reads as live to the cron ten minutes into pr_review_build_running, so the cron leaves it to run', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue('pr-review-start');
    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);
    // What runPhase writes when the build phase starts.
    AgentStateManager.writeTopLevelState(ADW_ID, {
      workflowStage: 'pr_review_build_running',
      phases: { pr_review_build: { status: 'running', startedAt: new Date(Date.now() - TEN_MINUTES_MS).toISOString() } },
    });

    const resolution = resolveIssueWorkflowStage(
      ISSUE_COMMENTS,
      (adwId) => AgentStateManager.readTopLevelState(adwId),
      (pid, pidStartedAt) => pid === process.pid && pidStartedAt === 'pr-review-start',
    );
    const result = evaluateIssue(
      makeIssue({ number: ISSUE_NUMBER, comments: ISSUE_COMMENTS, createdAt: OLD_DATE, updatedAt: OLD_DATE }),
      Date.now(),
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      () => resolution,
    );

    expect(resolution.ownerDead).toBe(false);
    expect(result).toEqual({ eligible: false, reason: 'active' });
  });
});
