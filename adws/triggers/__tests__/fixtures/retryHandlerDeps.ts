import { vi } from 'vitest';
import type { RetryHandlerDeps } from '../../retryHandler';
import type { AgentState } from '../../../types/agentTypes';
import type { PausedWorkflow } from '../../../core/pauseQueue';

export function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'merge_blocked',
    ...overrides,
  };
}

export function makeDeps(state: AgentState | null = makeState(), overrides: Partial<RetryHandlerDeps> = {}): RetryHandlerDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(state),
    writeTopLevelState: vi.fn(),
    findPauseQueueEntry: vi.fn().mockReturnValue(null),
    removeFromPauseQueue: vi.fn(),
    acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
    releaseIssueSpawnLock: vi.fn(),
    spawnDetached: vi.fn(),
    postStageComment: vi.fn(),
    targetRepoArgs: ['--target-repo', 'acme/widgets'],
    ...overrides,
  };
}

export function makePauseQueueEntry(overrides: Partial<PausedWorkflow> = {}): PausedWorkflow {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    orchestratorScript: 'adws/adwChore.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: '2026-01-01T00:00:00Z',
    worktreePath: '/tmp/adw-fixture-worktree',
    branchName: 'feature-issue-42-test-adw-id',
    ...overrides,
  };
}

export const ADW_COMMENT = { body: '**ADW ID:** `test-adw-id`' };
