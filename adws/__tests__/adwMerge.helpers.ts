import { vi } from 'vitest';
import type { MergeDeps } from '../adwMerge';
import type { AgentState } from '../types/agentTypes';
import type { MergeOutcome } from '../triggers/autoMergeHandler';
import { getPlanFilePath, planFileExists } from '../agents';
import { Platform } from '@paysdoc/devplatform';

export const REPO_INFO = { owner: 'acme', repo: 'myrepo', platform: Platform.GitHub };

export function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'awaiting_merge',
    ...overrides,
  };
}

export function makePR(overrides: {
  number?: number;
  state?: string;
  sourceBranch?: string;
  targetBranch?: string;
  labels?: readonly string[];
} = {}) {
  return {
    number: 7,
    state: 'OPEN',
    sourceBranch: 'feature-issue-42-abc',
    targetBranch: 'main',
    labels: [],
    ...overrides,
  };
}

export function makeMergeOutcome(overrides: Partial<MergeOutcome> = {}): MergeOutcome {
  return { success: true, mergeAttempts: 1, conflictResolutionRan: false, localMergeCheck: 'clean', ...overrides };
}

export function makeDeps(overrides: Partial<MergeDeps> = {}): MergeDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(makeState()),
    findOrchestratorStatePath: vi.fn().mockReturnValue('/agents/test-adw-id/sdlc-orchestrator'),
    readOrchestratorState: vi.fn().mockReturnValue(makeState({ branchName: 'feature-issue-42-abc' })),
    findPRByBranch: vi.fn().mockReturnValue(makePR()),
    issueHasLabel: vi.fn().mockReturnValue(false),
    fetchPRApprovalState: vi.fn().mockReturnValue(true),
    ensureWorktree: vi.fn().mockReturnValue('/worktrees/feature-issue-42-abc'),
    ensureLogsDirectory: vi.fn().mockReturnValue('/logs/test-adw-id'),
    mergeWithConflictResolution: vi.fn<MergeDeps['mergeWithConflictResolution']>().mockResolvedValue(makeMergeOutcome()),
    writeTopLevelState: vi.fn(),
    commentOnIssue: vi.fn(),
    getPlanFilePath: vi.fn<typeof getPlanFilePath>().mockReturnValue('specs/issue-42-plan.md'),
    planFileExists: vi.fn<typeof planFileExists>().mockReturnValue(false),
    notifyBlockedTransition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
