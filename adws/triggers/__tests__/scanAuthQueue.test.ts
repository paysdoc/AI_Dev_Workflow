import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanAuthQueue } from '../scanAuthQueue';
import type { ScanAuthQueueDeps } from '../scanAuthQueue';
import type { RepoInfo } from '../../github/githubApi';
import type { AgentState } from '../../types/agentTypes';

const REPO: RepoInfo = { owner: 'test', repo: 'repo' };
const TARGET_ARGS: string[] = [];

function makeState(adwId: string, workflowStage: string, issueNumber = 42): AgentState {
  return {
    adwId,
    issueNumber,
    workflowStage,
    agentName: 'orchestrator' as const,
    execution: { status: 'running' as const, startedAt: '2026-01-01T00:00:00Z' },
    orchestratorScript: 'adws/adwSdlc.tsx',
  };
}

function makeDeps(overrides: Partial<ScanAuthQueueDeps> = {}): ScanAuthQueueDeps {
  return {
    readAuthGate: vi.fn().mockReturnValue(null),
    listAgentDirs: vi.fn().mockReturnValue([]),
    readTopLevelState: vi.fn().mockReturnValue(null),
    writeTopLevelState: vi.fn(),
    evaluateCandidate: vi.fn().mockReturnValue({ kind: 'take_over_adwId', adwId: 'adwId', derivedStage: 'abandoned' }),
    spawnDetached: vi.fn(),
    releaseIssueSpawnLock: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('scanAuthQueue', () => {
  it('returns 0 and skips listAgentDirs when auth gate is present', async () => {
    const gate = {
      firstDetectedAt: '2026-01-01T00:00:00Z',
      lastDetectedAt: '2026-01-01T00:00:00Z',
      lastSlackNotifiedAt: null,
      host: 'testhost',
      lastDetectedBy: { adwId: null, issueNumber: null, agentName: 'orchestrator' },
    };
    const deps = makeDeps({ readAuthGate: vi.fn().mockReturnValue(gate) });

    const count = await scanAuthQueue(REPO, TARGET_ARGS, undefined, deps);

    expect(count).toBe(0);
    expect(deps.listAgentDirs).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
  });

  it('resumes one paused_auth state: rewrites to abandoned, evaluates, spawns, returns 1', async () => {
    const adwId = 'adw-abc';
    const state = makeState(adwId, 'paused_auth', 42);
    const deps = makeDeps({
      listAgentDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelState: vi.fn().mockReturnValue(state),
      evaluateCandidate: vi.fn().mockReturnValue({ kind: 'take_over_adwId', adwId, derivedStage: 'abandoned' }),
    });

    const count = await scanAuthQueue(REPO, TARGET_ARGS, undefined, deps);

    expect(count).toBe(1);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(adwId, { workflowStage: 'abandoned' });
    expect(deps.evaluateCandidate).toHaveBeenCalledWith({ issueNumber: 42, repoInfo: REPO }, undefined);
    expect(deps.spawnDetached).toHaveBeenCalledOnce();
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledWith(REPO, 42);
  });

  it('does not spawn when evaluateCandidate returns defer_live_holder', async () => {
    const adwId = 'adw-def';
    const state = makeState(adwId, 'paused_auth', 10);
    const deps = makeDeps({
      listAgentDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelState: vi.fn().mockReturnValue(state),
      evaluateCandidate: vi.fn().mockReturnValue({ kind: 'defer_live_holder', holderPid: 1234 }),
    });

    const count = await scanAuthQueue(REPO, TARGET_ARGS, undefined, deps);

    expect(count).toBe(0);
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('spawns each paused_auth state and returns the total count', async () => {
    const adwId1 = 'adw-1';
    const adwId2 = 'adw-2';
    const states: Record<string, AgentState> = {
      [adwId1]: makeState(adwId1, 'paused_auth', 11),
      [adwId2]: makeState(adwId2, 'paused_auth', 22),
    };

    const deps = makeDeps({
      listAgentDirs: vi.fn().mockReturnValue([adwId1, adwId2]),
      readTopLevelState: vi.fn().mockImplementation((id: string) => states[id] ?? null),
      evaluateCandidate: vi.fn().mockImplementation((input: { issueNumber: number; repoInfo: RepoInfo }) => ({
        kind: 'take_over_adwId',
        adwId: input.issueNumber === 11 ? adwId1 : adwId2,
        derivedStage: 'abandoned',
      })),
    });

    const count = await scanAuthQueue(REPO, TARGET_ARGS, undefined, deps);

    expect(count).toBe(2);
    expect(deps.spawnDetached).toHaveBeenCalledTimes(2);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(adwId1, { workflowStage: 'abandoned' });
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(adwId2, { workflowStage: 'abandoned' });
  });

  it('skips states that are not paused_auth', async () => {
    const adwId1 = 'adw-running';
    const adwId2 = 'adw-paused-auth';
    const states: Record<string, AgentState> = {
      [adwId1]: makeState(adwId1, 'build_running', 30),
      [adwId2]: makeState(adwId2, 'paused_auth', 31),
    };

    const deps = makeDeps({
      listAgentDirs: vi.fn().mockReturnValue([adwId1, adwId2]),
      readTopLevelState: vi.fn().mockImplementation((id: string) => states[id] ?? null),
      evaluateCandidate: vi.fn().mockReturnValue({ kind: 'take_over_adwId', adwId: adwId2, derivedStage: 'abandoned' }),
    });

    const count = await scanAuthQueue(REPO, TARGET_ARGS, undefined, deps);

    expect(count).toBe(1);
    // Should only write/evaluate for adwId2
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(adwId2, { workflowStage: 'abandoned' });
    expect(deps.writeTopLevelState).not.toHaveBeenCalledWith(adwId1, expect.anything());
  });
});
