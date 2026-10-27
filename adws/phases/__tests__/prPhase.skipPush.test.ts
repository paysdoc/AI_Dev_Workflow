import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRecoveryState } from '../../core';
import type { RecoveryState } from '../../types/workflowTypes';
import type { WorkflowConfig } from '../workflowInit';

const agents = vi.hoisted(() => ({ runCommitAgent: vi.fn(), runPullRequestAgent: vi.fn() }));

vi.mock('../../agents', async importOriginal => ({
  ...(await importOriginal<typeof import('../../agents')>()),
  runCommitAgent: agents.runCommitAgent,
  runPullRequestAgent: agents.runPullRequestAgent,
  getPlanFilePath: () => 'specs/issue-7-plan.md',
}));

vi.mock('../phaseCommentHelpers', () => ({ postIssueStageComment: vi.fn() }));

import { executePRPhase } from '../prPhase';

const BRANCH = 'feature-issue-7-resume-after-park';
const WORKTREE = '/worktrees/feature-issue-7-resume-after-park';
const PUSH = `push ${BRANCH} ${WORKTREE}`;

const fresh: RecoveryState = detectRecoveryState([]);
const resumedAfterPullRequest: RecoveryState = {
  ...fresh,
  canResume: true,
  lastCompletedStage: 'pr_created',
  adwId: 'abc123',
  branchName: BRANCH,
  prUrl: 'https://example.test/acme/widgets/pull/9',
};

interface Run {
  readonly config: WorkflowConfig;
  /** What the phase did, in the order it did it. */
  readonly events: string[];
}

/** The stub's tree is dirty or clean for the whole run: the commit agent is a stand-in that records its call. */
function runOver({ dirty, recoveryState, pushFails = false }: { dirty: boolean; recoveryState: RecoveryState; pushFails?: boolean }): Run {
  const events: string[] = [];
  agents.runCommitAgent.mockImplementation(async () => {
    events.push('commit');
  });
  agents.runPullRequestAgent.mockImplementation(async () => {
    events.push('pr agent');
    return { totalCostUsd: 0.1, modelUsage: {}, prContent: { title: 'Resume after park', body: 'Body' } };
  });

  const gitContext = {
    selfHost: true,
    hasUncommittedChanges: () => dirty,
    commandEnv: () => ({}),
    pushBranch: (branch: string, cwd: string) => {
      events.push(`push ${branch} ${cwd}`);
      if (pushFails) throw new Error('remote rejected the push');
    },
  };
  const repoContext = {
    repoId: { owner: 'acme', repo: 'widgets' },
    codeHost: {
      getDefaultBranch: () => 'trunk',
      createPullRequest: () => {
        events.push('create pull request');
        return { url: 'https://example.test/acme/widgets/pull/9', number: 9 };
      },
    },
    issueTracker: { commentOnIssue: () => undefined, moveToStatus: async () => undefined },
  };
  const config = {
    issueNumber: 7,
    adwId: 'abc123',
    issue: { number: 7, title: 'Resume after park', body: '', state: 'open', author: 'tester', labels: [], comments: [], createdAt: '2026-01-01T00:00:00Z' },
    issueType: '/feature',
    worktreePath: WORKTREE,
    logsDir: '/logs/abc123',
    branchName: BRANCH,
    recoveryState,
    ctx: { issueNumber: 7, adwId: 'abc123', branchName: BRANCH },
    repoContext,
    gitContext,
  } as unknown as WorkflowConfig;
  return { config, events };
}

describe('executePRPhase: a run that skips PR creation because the pull request exists', () => {
  beforeEach(() => {
    agents.runCommitAgent.mockReset();
    agents.runPullRequestAgent.mockReset();
  });

  it('pushes the branch after the safety-net commit, since the merge orchestrator resets its worktree to the remote branch and would discard it', async () => {
    const { config, events } = runOver({ dirty: true, recoveryState: resumedAfterPullRequest });

    await executePRPhase(config);

    expect(events).toEqual(['commit', PUSH]);
  });

  it('creates no pull request and runs no pull-request agent', async () => {
    const { config, events } = runOver({ dirty: true, recoveryState: resumedAfterPullRequest });

    await executePRPhase(config);

    expect(events).not.toContain('pr agent');
    expect(events).not.toContain('create pull request');
    expect(agents.runPullRequestAgent).not.toHaveBeenCalled();
  });

  it('pushes nothing when the tree was clean, since no commit was made that the remote branch lacks', async () => {
    const { config, events } = runOver({ dirty: false, recoveryState: resumedAfterPullRequest });

    await executePRPhase(config);

    expect(events).toEqual([]);
    expect(agents.runCommitAgent).not.toHaveBeenCalled();
  });

  it('does not report success for a safety-net commit that could not be pushed', async () => {
    const { config } = runOver({ dirty: true, recoveryState: resumedAfterPullRequest, pushFails: true });

    await expect(executePRPhase(config)).rejects.toThrow('remote rejected the push');
  });

  it('pushes the branch the context names, in the worktree', async () => {
    const { config, events } = runOver({ dirty: true, recoveryState: resumedAfterPullRequest });
    const named = { ...config, ctx: { ...config.ctx, branchName: 'feature-issue-7-renamed' } } as WorkflowConfig;

    await executePRPhase(named);

    expect(events).toEqual(['commit', `push feature-issue-7-renamed ${WORKTREE}`]);
  });
});

describe('executePRPhase: a run that creates the pull request', () => {
  beforeEach(() => {
    agents.runCommitAgent.mockReset();
    agents.runPullRequestAgent.mockReset();
  });

  it('commits, runs the pull-request agent, pushes once and then creates the pull request, as before', async () => {
    const { config, events } = runOver({ dirty: true, recoveryState: fresh });

    await executePRPhase(config);

    expect(events).toEqual(['commit', 'pr agent', PUSH, 'create pull request']);
  });

  it('pushes once on a clean tree too: the creation path is the only push', async () => {
    const { config, events } = runOver({ dirty: false, recoveryState: fresh });

    await executePRPhase(config);

    expect(events).toEqual(['pr agent', PUSH, 'create pull request']);
  });
});
