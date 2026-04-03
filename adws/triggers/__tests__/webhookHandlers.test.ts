import { describe, it, expect, vi } from 'vitest';
import {
  handlePullRequestEvent,
  handleIssueClosedEvent,
  type PrClosedDeps,
  type IssueClosedDeps,
} from '../webhookHandlers';
import type { AgentState } from '../../types/agentTypes';
import type { PullRequestWebhookPayload } from '../../types/issueTypes';

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO_INFO = { owner: 'acme', repo: 'myrepo' };

function makePayload(overrides: {
  merged?: boolean;
  headRef?: string;
  prNumber?: number;
} = {}): PullRequestWebhookPayload {
  return {
    action: 'closed',
    pull_request: {
      number: overrides.prNumber ?? 10,
      state: 'closed',
      merged: overrides.merged ?? false,
      body: null,
      html_url: 'https://github.com/acme/myrepo/pull/10',
      title: 'Some PR',
      base: { ref: 'main' },
      head: { ref: overrides.headRef ?? 'feature/issue-42-some-feature' },
    },
    repository: {
      name: 'myrepo',
      owner: { login: 'acme' },
      full_name: 'acme/myrepo',
    },
  };
}

function makePrDeps(overrides: Partial<PrClosedDeps> = {}): PrClosedDeps {
  return {
    fetchIssueComments: vi.fn().mockReturnValue([]),
    writeTopLevelState: vi.fn(),
    closeIssue: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'completed',
    ...overrides,
  };
}

function makeIssueDeps(overrides: Partial<IssueClosedDeps> = {}): IssueClosedDeps {
  return {
    fetchIssueComments: vi.fn().mockReturnValue([
      { body: '**ADW ID:** `test-adw-id`' },
    ]),
    readTopLevelState: vi.fn().mockReturnValue(makeState()),
    removeWorktreesForIssue: vi.fn().mockReturnValue(1),
    findOrchestratorStatePath: vi.fn().mockReturnValue('/agents/test-adw-id/sdlc-orchestrator'),
    readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: 'feature/issue-42-some-feature' })),
    deleteRemoteBranch: vi.fn().mockReturnValue(true),
    closeAbandonedDependents: vi.fn().mockResolvedValue(undefined),
    handleIssueClosedDependencyUnblock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── handlePullRequestEvent ───────────────────────────────────────────────────

describe('handlePullRequestEvent — merged PR', () => {
  it('returns ignored for a merged PR without any side effects', async () => {
    const deps = makePrDeps();
    const result = await handlePullRequestEvent(makePayload({ merged: true }), deps);

    expect(result.status).toBe('ignored');
    expect(deps.fetchIssueComments).not.toHaveBeenCalled();
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(deps.closeIssue).not.toHaveBeenCalled();
  });
});

describe('handlePullRequestEvent — abandoned PR with adw-id', () => {
  it('writes abandoned to state and closes linked issue', async () => {
    const deps = makePrDeps({
      fetchIssueComments: vi.fn().mockReturnValue([
        { body: '**ADW ID:** `abc123`' },
      ]),
    });
    const result = await handlePullRequestEvent(makePayload({ merged: false }), deps);

    expect(result.status).toBe('abandoned');
    expect(result.issue).toBe(42);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('abc123', { workflowStage: 'abandoned' });
    expect(deps.closeIssue).toHaveBeenCalledWith(42, REPO_INFO, expect.stringContaining('PR Abandoned'));
  });
});

describe('handlePullRequestEvent — abandoned PR without adw-id', () => {
  it('closes linked issue without writing state', async () => {
    const deps = makePrDeps({
      fetchIssueComments: vi.fn().mockReturnValue([{ body: 'no adw id here' }]),
    });
    const result = await handlePullRequestEvent(makePayload({ merged: false }), deps);

    expect(result.status).toBe('abandoned');
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(deps.closeIssue).toHaveBeenCalledWith(42, REPO_INFO, expect.any(String));
  });
});

describe('handlePullRequestEvent — no issue number in branch', () => {
  it('returns ignored when branch name has no issue-N pattern', async () => {
    const deps = makePrDeps();
    const result = await handlePullRequestEvent(makePayload({ headRef: 'hotfix/some-fix' }), deps);

    expect(result.status).toBe('ignored');
    expect(deps.closeIssue).not.toHaveBeenCalled();
  });
});

describe('handlePullRequestEvent — non-closed action', () => {
  it('returns ignored for actions other than closed', async () => {
    const deps = makePrDeps();
    const payload: PullRequestWebhookPayload = { ...makePayload(), action: 'opened' };
    const result = await handlePullRequestEvent(payload, deps);

    expect(result.status).toBe('ignored');
    expect(deps.closeIssue).not.toHaveBeenCalled();
  });
});

// ── handleIssueClosedEvent ───────────────────────────────────────────────────

describe('handleIssueClosedEvent — normal closure (completed workflow)', () => {
  it('cleans up worktree, deletes branch, and unblocks dependents', async () => {
    const deps = makeIssueDeps();
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.removeWorktreesForIssue).toHaveBeenCalledWith(42, undefined);
    expect(deps.deleteRemoteBranch).toHaveBeenCalledWith('feature/issue-42-some-feature', undefined);
    expect(deps.handleIssueClosedDependencyUnblock).toHaveBeenCalledWith(42, REPO_INFO, []);
    expect(deps.closeAbandonedDependents).not.toHaveBeenCalled();
    expect(result.worktreesRemoved).toBe(1);
    expect(result.branchDeleted).toBe(true);
  });
});

describe('handleIssueClosedEvent — abandoned closure', () => {
  it('cleans up worktree, deletes branch, and closes dependents with error comment', async () => {
    const deps = makeIssueDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned' })),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.closeAbandonedDependents).toHaveBeenCalledWith(42, REPO_INFO);
    expect(deps.handleIssueClosedDependencyUnblock).not.toHaveBeenCalled();
  });
});

describe('handleIssueClosedEvent — active stage within grace period', () => {
  it('skips cleanup entirely', async () => {
    const recentTimestamp = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const deps = makeIssueDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'build_running',
        phases: {
          build: { status: 'running', startedAt: recentTimestamp },
        },
      })),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('active_within_grace_period');
    expect(deps.removeWorktreesForIssue).not.toHaveBeenCalled();
    expect(deps.deleteRemoteBranch).not.toHaveBeenCalled();
  });
});

describe('handleIssueClosedEvent — active stage outside grace period', () => {
  it('proceeds with cleanup when last activity exceeds grace period', async () => {
    const oldTimestamp = new Date(Date.now() - 400_000).toISOString(); // > 5 min ago
    const deps = makeIssueDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'build_running',
        phases: {
          build: { status: 'running', startedAt: oldTimestamp },
        },
      })),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.removeWorktreesForIssue).toHaveBeenCalled();
  });
});

describe('handleIssueClosedEvent — no adw-id found', () => {
  it('cleans up worktree only (no state, no branch deletion from state) and unblocks dependents', async () => {
    const deps = makeIssueDeps({
      fetchIssueComments: vi.fn().mockReturnValue([{ body: 'no adw comment here' }]),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.removeWorktreesForIssue).toHaveBeenCalledWith(42, undefined);
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(deps.handleIssueClosedDependencyUnblock).toHaveBeenCalledWith(42, REPO_INFO, []);
  });
});

describe('handleIssueClosedEvent — no state file', () => {
  it('cleans up worktrees and unblocks dependents (treats as normal closure)', async () => {
    const deps = makeIssueDeps({
      readTopLevelState: vi.fn().mockReturnValue(null),
      findOrchestratorStatePath: vi.fn().mockReturnValue(null),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.removeWorktreesForIssue).toHaveBeenCalledWith(42, undefined);
    expect(deps.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(deps.handleIssueClosedDependencyUnblock).toHaveBeenCalledWith(42, REPO_INFO, []);
  });
});

describe('handleIssueClosedEvent — fetchIssueComments fails', () => {
  it('proceeds with basic cleanup on network error', async () => {
    const deps = makeIssueDeps({
      fetchIssueComments: vi.fn().mockImplementation(() => { throw new Error('network timeout'); }),
    });
    const result = await handleIssueClosedEvent(42, REPO_INFO, undefined, [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.removeWorktreesForIssue).toHaveBeenCalledWith(42, undefined);
    // No adwId was found so no state-based operations
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.deleteRemoteBranch).not.toHaveBeenCalled();
    // Dependency unblock still runs (treats as normal closure)
    expect(deps.handleIssueClosedDependencyUnblock).toHaveBeenCalledWith(42, REPO_INFO, []);
  });
});

describe('handleIssueClosedEvent — no repoInfo', () => {
  it('cleans up worktrees only when repoInfo is undefined', async () => {
    const deps = makeIssueDeps();
    const result = await handleIssueClosedEvent(42, undefined, '/some/cwd', [], deps);

    expect(result.status).toBe('cleaned');
    expect(deps.fetchIssueComments).not.toHaveBeenCalled();
    expect(deps.removeWorktreesForIssue).toHaveBeenCalledWith(42, '/some/cwd');
    expect(deps.closeAbandonedDependents).not.toHaveBeenCalled();
    expect(deps.handleIssueClosedDependencyUnblock).not.toHaveBeenCalled();
  });
});
