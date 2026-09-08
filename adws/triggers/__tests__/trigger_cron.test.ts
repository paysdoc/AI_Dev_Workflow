/**
 * Cron-integration tests for the hung-orchestrator sweep block.
 *
 * Tests that checkAndTrigger / runHungDetectorSweep:
 * - calls process.kill(pid, 'SIGKILL') for each hung entry returned by findHungOrchestrators
 * - calls AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'abandoned' }) for each entry
 * - isolates per-entry failures (SIGKILL error does not skip state rewrite or siblings)
 * - is a no-op when findHungOrchestrators returns []
 *
 * Module-level side effects in trigger_cron.ts (resolveCronRepo, activateGitHubAppAuth,
 * registerAndGuard, setInterval) are stubbed via vi.mock so the import is stable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all module-level side-effect dependencies BEFORE any import of trigger_cron
// ---------------------------------------------------------------------------

vi.mock('../cronRepoResolver', () => ({
  resolveCronRepo: vi.fn(() => ({
    repoInfo: { owner: 'test-owner', repo: 'test-repo' },
    targetRepo: null,
  })),
  buildCronTargetRepoArgs: vi.fn(() => []),
}));

vi.mock('../../github', () => ({
  activateGitHubAppAuth: vi.fn(),
  ensureAppAuthForRepo: vi.fn(),
  getRepoInfo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
  fetchPRList: vi.fn(() => []),
  hasUnaddressedComments: vi.fn(() => false),
  isCancelComment: vi.fn(() => false),
  refreshTokenIfNeeded: vi.fn(),
}));

vi.mock('../cronProcessGuard', () => ({
  registerAndGuard: vi.fn(() => true),
}));

vi.mock('../../core/hungOrchestratorDetector', () => ({
  findHungOrchestrators: vi.fn(() => []),
}));

vi.mock('../../core/agentState', () => ({
  AgentStateManager: {
    readTopLevelState: vi.fn(() => null),
    writeTopLevelState: vi.fn(),
  },
}));

vi.mock('../pauseQueueScanner', () => ({
  scanPauseQueue: vi.fn(() => Promise.resolve()),
}));

vi.mock('../devServerJanitor', () => ({
  runJanitorPass: vi.fn(() => Promise.resolve()),
}));

vi.mock('../cronIssueFilter', () => ({
  filterEligibleIssues: vi.fn(() => ({ eligible: [], filteredAnnotations: [] })),
}));

vi.mock('../cronStageResolver', () => ({
  resolveIssueWorkflowStage: vi.fn(),
  isActiveStage: vi.fn(() => false),
}));

vi.mock('../cancelHandler', () => ({
  handleCancelDirective: vi.fn(),
}));

vi.mock('../issueEligibility', () => ({
  checkIssueEligibility: vi.fn(() => Promise.resolve({ eligible: false, reason: 'test' })),
}));

vi.mock('../webhookGatekeeper', () => ({
  classifyAndSpawnWorkflow: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    getTargetRepoWorkspacePath: vi.fn(() => '/tmp/test-repo'),
  };
});

// ---------------------------------------------------------------------------
// Now import the module under test (side effects are all stubbed)
// ---------------------------------------------------------------------------

import { runHungDetectorSweep, runPerIssueScenarioSweepTick, runPromotionSweepTick, runDocsIndexSweepTick, runGuardedTick } from '../trigger_cron';
import { findHungOrchestrators } from '../../core/hungOrchestratorDetector';
import { AgentStateManager } from '../../core/agentState';
import { log, PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, PROMOTION_SWEEP_INTERVAL_CYCLES, DOCS_INDEX_SWEEP_INTERVAL_CYCLES } from '../../core';
import type { HungOrchestrator } from '../../core/hungOrchestratorDetector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<HungOrchestrator> = {}): HungOrchestrator {
  return {
    adwId: 'sweep-01',
    pid: 1234,
    pidStartedAt: 'tok-1234',
    lastSeenAt: '2026-04-20T10:00:00.000Z',
    workflowStage: 'build_running',
    issueNumber: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runHungDetectorSweep', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  const findHungMock = vi.mocked(findHungOrchestrators);
  const writeStateMock = vi.mocked(AgentStateManager.writeTopLevelState);

  beforeEach(() => {
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    findHungMock.mockClear();
    writeStateMock.mockClear();
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('sends SIGKILL to the pid returned for a single hung entry', () => {
    findHungMock.mockReturnValueOnce([makeEntry({ adwId: 'sweep-01', pid: 1234 })]);
    runHungDetectorSweep(Date.now());
    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGKILL');
  });

  it('rewrites workflowStage to abandoned for the returned entry', () => {
    findHungMock.mockReturnValueOnce([makeEntry({ adwId: 'sweep-02', pid: 2345 })]);
    runHungDetectorSweep(Date.now());
    expect(writeStateMock).toHaveBeenCalledWith('sweep-02', { workflowStage: 'abandoned' });
  });

  it('never rewrites workflowStage to discarded for a hung entry', () => {
    findHungMock.mockReturnValueOnce([makeEntry({ adwId: 'sweep-03', pid: 3456 })]);
    runHungDetectorSweep(Date.now());
    const calls = writeStateMock.mock.calls;
    for (const [, patch] of calls) {
      expect((patch as Record<string, unknown>).workflowStage).not.toBe('discarded');
    }
  });

  it('calls SIGKILL and writeTopLevelState for each of multiple entries', () => {
    findHungMock.mockReturnValueOnce([
      makeEntry({ adwId: 'sweep-a', pid: 4001 }),
      makeEntry({ adwId: 'sweep-b', pid: 4002 }),
    ]);
    runHungDetectorSweep(Date.now());
    expect(killSpy).toHaveBeenCalledWith(4001, 'SIGKILL');
    expect(killSpy).toHaveBeenCalledWith(4002, 'SIGKILL');
    expect(writeStateMock).toHaveBeenCalledWith('sweep-a', { workflowStage: 'abandoned' });
    expect(writeStateMock).toHaveBeenCalledWith('sweep-b', { workflowStage: 'abandoned' });
  });

  it('is a no-op when findHungOrchestrators returns []', () => {
    findHungMock.mockReturnValueOnce([]);
    runHungDetectorSweep(Date.now());
    expect(killSpy).not.toHaveBeenCalled();
    expect(writeStateMock).not.toHaveBeenCalled();
  });

  it('still rewrites state and processes siblings when SIGKILL throws for one entry', () => {
    findHungMock.mockReturnValueOnce([
      makeEntry({ adwId: 'sweep-c', pid: 5001 }),
      makeEntry({ adwId: 'sweep-d', pid: 5002 }),
    ]);
    killSpy.mockImplementationOnce(() => { throw new Error('ESRCH: no such process'); });
    killSpy.mockImplementation(() => true);

    runHungDetectorSweep(Date.now());

    // State rewrite for sweep-c still happens despite SIGKILL failure
    expect(writeStateMock).toHaveBeenCalledWith('sweep-c', { workflowStage: 'abandoned' });
    // Sibling sweep-d is fully processed
    expect(killSpy).toHaveBeenCalledWith(5002, 'SIGKILL');
    expect(writeStateMock).toHaveBeenCalledWith('sweep-d', { workflowStage: 'abandoned' });
  });

  it('passes now argument through to findHungOrchestrators', () => {
    const fakeNow = 1745145600000;
    findHungMock.mockReturnValueOnce([]);
    runHungDetectorSweep(fakeNow);
    expect(findHungMock).toHaveBeenCalledWith(fakeNow, expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// Tick seams (#769) — both dispatch an injected, nullable bound thunk rather
// than falling back to a cwd-derived identity when no launch context exists.
// ---------------------------------------------------------------------------

describe('runPerIssueScenarioSweepTick', () => {
  beforeEach(() => {
    vi.mocked(log).mockClear();
  });

  it('dispatches the injected sweep exactly once on a cadence-eligible cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runPerIssueScenarioSweepTick(PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, sweep);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch on an off-cadence cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runPerIssueScenarioSweepTick(PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES + 1, sweep);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('skips without dispatching and logs a warning when the thunk is null (no launch context)', async () => {
    await runPerIssueScenarioSweepTick(PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, null);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no launch GitContext available'), 'warn');
  });

  it('does not even evaluate the skip branch off-cadence when the thunk is null', async () => {
    await runPerIssueScenarioSweepTick(PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES + 1, null);
    expect(log).not.toHaveBeenCalled();
  });

  it('swallows a throwing sweep and the tick still resolves', async () => {
    const sweep = vi.fn(() => Promise.reject(new Error('injected transient failure')));
    await expect(runPerIssueScenarioSweepTick(PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, sweep)).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe('runPromotionSweepTick — null-thunk skip (#769)', () => {
  beforeEach(() => {
    vi.mocked(log).mockClear();
  });

  it('dispatches the injected sweep exactly once on a cadence-eligible cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runPromotionSweepTick(PROMOTION_SWEEP_INTERVAL_CYCLES, sweep);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch on an off-cadence cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runPromotionSweepTick(PROMOTION_SWEEP_INTERVAL_CYCLES + 1, sweep);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('skips without dispatching and logs a warning when the thunk is null (no launch context)', async () => {
    await runPromotionSweepTick(PROMOTION_SWEEP_INTERVAL_CYCLES, null);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no launch GitContext available'), 'warn');
  });

  it('swallows a throwing sweep and the tick still resolves', async () => {
    const sweep = vi.fn(() => Promise.reject(new Error('injected transient failure')));
    await expect(runPromotionSweepTick(PROMOTION_SWEEP_INTERVAL_CYCLES, sweep)).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe('runDocsIndexSweepTick — null-thunk skip (#810)', () => {
  beforeEach(() => {
    vi.mocked(log).mockClear();
  });

  it('dispatches the injected sweep exactly once on a cadence-eligible cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runDocsIndexSweepTick(DOCS_INDEX_SWEEP_INTERVAL_CYCLES, sweep);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch on an off-cadence cycle', async () => {
    const sweep = vi.fn(() => Promise.resolve());
    await runDocsIndexSweepTick(DOCS_INDEX_SWEEP_INTERVAL_CYCLES + 1, sweep);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('skips without dispatching and logs a warning when the thunk is null (no launch context)', async () => {
    await runDocsIndexSweepTick(DOCS_INDEX_SWEEP_INTERVAL_CYCLES, null);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no launch GitContext available'), 'warn');
  });

  it('does not even evaluate the skip branch off-cadence when the thunk is null', async () => {
    await runDocsIndexSweepTick(DOCS_INDEX_SWEEP_INTERVAL_CYCLES + 1, null);
    expect(log).not.toHaveBeenCalled();
  });

  it('swallows a throwing sweep and the tick still resolves', async () => {
    const sweep = vi.fn(() => Promise.reject(new Error('injected transient failure')));
    await expect(runDocsIndexSweepTick(DOCS_INDEX_SWEEP_INTERVAL_CYCLES, sweep)).resolves.toBeUndefined();
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});

describe('runGuardedTick (#812)', () => {
  beforeEach(() => {
    vi.mocked(log).mockClear();
  });

  it('awaits the injected tick exactly once', async () => {
    const tick = vi.fn(() => Promise.resolve());
    await runGuardedTick(tick);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('swallows a rejecting tick, logs an error naming the cause, and resolves', async () => {
    const tick = vi.fn(() => Promise.reject(new Error('GitHub App installation lookup failed for paicc/paicc-1: HTTP 404 (Not Found)')));
    await expect(runGuardedTick(tick)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('paicc/paicc-1'), 'error');
  });

  it('a rejection on one invocation does not stop the next invocation from running', async () => {
    const tick = vi.fn()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined);
    await runGuardedTick(tick);
    await runGuardedTick(tick);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('swallows a non-Error rejection value', async () => {
    const tick = vi.fn(() => Promise.reject('boom'));
    await expect(runGuardedTick(tick)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
  });
});
