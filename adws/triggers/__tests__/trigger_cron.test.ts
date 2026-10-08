/**
 * Module-level side effects in trigger_cron.ts (resolveCronRepo, activateGitHubAppAuth,
 * registerAndGuard, setInterval) are stubbed via vi.mock so the import is stable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all module-level side-effect dependencies BEFORE any import of trigger_cron

vi.mock('../cronRepoResolver', () => ({
  resolveCronRepo: vi.fn(() => ({
    repoInfo: { owner: 'test-owner', repo: 'test-repo' },
    targetRepo: null,
  })),
  buildCronTargetRepoArgs: vi.fn(() => []),
}));

vi.mock('../../core/localRepoIdentity', () => ({
  readLocalRepoIdentity: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo', platform: 'github' })),
}));

vi.mock('../../forge/linkedPrDetector', () => ({
  fetchLinkedPRs: vi.fn(() => []),
}));

vi.mock('../../forge/prCommentDetector', () => ({
  hasUnaddressedComments: vi.fn(() => false),
}));

vi.mock('../../core/workflowCommentParsing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/workflowCommentParsing')>();
  return { ...actual, isCancelComment: vi.fn(() => false) };
});

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
  resolveTouchedFilesFromBody: vi.fn(() => []),
}));

vi.mock('../cronStageResolver', () => ({
  resolveIssueWorkflowStage: vi.fn(),
  isActiveStage: vi.fn(() => false),
}));

vi.mock('../cancelHandler', () => ({
  handleCancelDirective: vi.fn(),
}));

vi.mock('../continueHandler', () => ({
  handleContinueDirective: vi.fn(() => false),
  buildContinueHandlerDeps: vi.fn(() => ({ readTopLevelState: vi.fn(), writeTopLevelState: vi.fn(), now: vi.fn() })),
}));

vi.mock('../issueEligibility', () => ({
  checkIssueEligibility: vi.fn(() => Promise.resolve({ eligible: false, reason: 'test' })),
}));

vi.mock('../webhookGatekeeper', () => ({
  classifyAndSpawnWorkflow: vi.fn(() => Promise.resolve()),
  spawnDetached: vi.fn(),
}));

vi.mock('../takeoverHandler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../takeoverHandler')>()),
  evaluateCandidate: vi.fn(),
}));

vi.mock('../spawnGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../spawnGate')>()),
  releaseIssueSpawnLock: vi.fn(),
}));

vi.mock('../../core/authGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/authGate')>();
  return { ...actual, readAuthGate: vi.fn(() => null), clearAuthGate: vi.fn() };
});

vi.mock('../scanAuthQueue', () => ({
  scanAuthQueue: vi.fn(() => Promise.resolve(0)),
}));

vi.mock('../../core/slackNotifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/slackNotifier')>();
  return {
    ...actual,
    sendSlackDetectionNotification: vi.fn(() => Promise.resolve()),
    sendSlackRecoveryNotification: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    getTargetRepoWorkspacePath: vi.fn(() => '/tmp/test-repo'),
  };
});

import { runHungDetectorSweep, runPerIssueScenarioSweepTick, runPromotionSweepTick, runDocsIndexSweepTick, runGuardedTick, runPauseQueueScanTick, evaluateCandidateForTick, checkAndTrigger } from '../trigger_cron';
import { evaluateCandidate, type CandidateDecision } from '../takeoverHandler';
import { buildContinueHandlerDeps, handleContinueDirective } from '../continueHandler';
import { releaseIssueSpawnLock } from '../spawnGate';
import { filterEligibleIssues, type EligibleIssue } from '../cronIssueFilter';
import type { RawIssue } from '../cronIssueListing';
import { checkIssueEligibility } from '../issueEligibility';
import { spawnDetached } from '../webhookGatekeeper';
import { findHungOrchestrators } from '../../core/hungOrchestratorDetector';
import { readAuthGate, clearAuthGate, type AuthGateRecord } from '../../core/authGate';
import { clearClaudeCodePathCache } from '../../core/environment';
import { createRecordingClaudeCli, overrideEnv, type RecordingClaudeCli } from '../../core/__tests__/fixtures/recordingClaudeCli';
import type { LaunchBoundary } from '../../core';
import { AgentStateManager } from '../../core/agentState';
import { log, PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, PROMOTION_SWEEP_INTERVAL_CYCLES, DOCS_INDEX_SWEEP_INTERVAL_CYCLES } from '../../core';
import { probeRateLimit } from '../rateLimitProbe';
import type { HungOrchestrator } from '../../core/hungOrchestratorDetector';

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

    expect(writeStateMock).toHaveBeenCalledWith('sweep-c', { workflowStage: 'abandoned' });
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

// Tick seams — both dispatch an injected, nullable bound thunk rather
// than falling back to a cwd-derived identity when no launch context exists.

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

describe('runPauseQueueScanTick', () => {
  it('hands the injected scan this cron\'s startup identity and probeRateLimit', async () => {
    const scan = vi.fn(() => Promise.resolve());
    await runPauseQueueScanTick(7, scan);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith(
      7,
      expect.any(Function),
      { scanningCron: { repoId: expect.objectContaining({ owner: 'test-owner', repo: 'test-repo' }), selfHost: true } },
    );
  });

  it('passes probeRateLimit itself as the probe, not a wrapper', async () => {
    const scan = vi.fn((_cycleCount: number, _probe: unknown, _deps: unknown) => Promise.resolve());
    await runPauseQueueScanTick(1, scan);
    const [, probeArg] = scan.mock.calls[0];
    expect(probeArg).toBe(probeRateLimit);
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

describe('auth-gate tick', () => {
  const GATE: AuthGateRecord = {
    firstDetectedAt: '2026-10-01T10:00:00.000Z',
    lastDetectedAt: '2026-10-01T10:05:00.000Z',
    lastSlackNotifiedAt: null,
    host: 'test-host',
    lastDetectedBy: { adwId: 'adw-1', issueNumber: 1, agentName: 'build-agent' },
  };
  let cli: RecordingClaudeCli | undefined;
  let restoreEnv: (() => void) | undefined;

  afterEach(() => {
    restoreEnv?.();
    clearClaudeCodePathCache();
    cli?.cleanup();
    cli = undefined;
  });

  it('checks the Claude auth status under the shared launch environment', async () => {
    cli = createRecordingClaudeCli({ stdout: '{"loggedIn":true}' });
    restoreEnv = overrideEnv({
      CLAUDE_CODE_PATH: cli.cliPath,
      ADW_RECORDING_SENTINEL: 'leak',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
    });
    clearClaudeCodePathCache();
    vi.mocked(readAuthGate).mockReturnValueOnce(GATE);

    await checkAndTrigger({} as LaunchBoundary);

    expect(vi.mocked(clearAuthGate)).toHaveBeenCalledTimes(1);
    expect(cli.readInvocations()).toEqual([{ memory: '1', hooksLogDir: '', sentinel: '' }]);
  });
});

describe('evaluateCandidateForTick', () => {
  const BOUNDARY = { repoId: { owner: 'test-owner', repo: 'test-repo' } } as unknown as LaunchBoundary;

  beforeEach(() => {
    vi.mocked(log).mockClear();
  });

  it('returns the injected evaluator\'s decision unchanged', () => {
    const decision: CandidateDecision = { kind: 'take_over_adwId', adwId: 'adw-7', derivedStage: 'starting' };
    const evaluate = vi.fn().mockReturnValue(decision);

    expect(evaluateCandidateForTick(7, BOUNDARY, evaluate)).toBe(decision);
    expect(evaluate).toHaveBeenCalledWith({ issueNumber: 7, boundary: BOUNDARY });
  });

  it('returns null and logs an error naming the issue when the evaluator throws', () => {
    const evaluate = vi.fn().mockImplementation(() => {
      throw new Error("fatal: couldn't find remote ref");
    });

    expect(evaluateCandidateForTick(935, BOUNDARY, evaluate)).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('#935'), 'error');
    expect(log).toHaveBeenCalledWith(expect.stringContaining("couldn't find remote ref"), 'error');
  });

  it('does not let a throw for one issue stop the next call from returning its decision', () => {
    const decision: CandidateDecision = { kind: 'spawn_fresh' };
    const evaluate = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockReturnValueOnce(decision);

    expect(evaluateCandidateForTick(1, BOUNDARY, evaluate)).toBeNull();
    expect(evaluateCandidateForTick(2, BOUNDARY, evaluate)).toBe(decision);
  });
});

describe('checkAndTrigger — the takeover decision for each candidate', () => {
  const BOUNDARY = {
    repoId: { owner: 'test-owner', repo: 'test-repo' },
    providers: { issueTracker: { listIssues: () => [] }, codeHost: {} },
  } as unknown as LaunchBoundary;
  const takeOver = (issueNumber: number): CandidateDecision => ({ kind: 'take_over_adwId', adwId: `adw-${issueNumber}`, derivedStage: 'starting' });

  function candidate(issueNumber: number): EligibleIssue {
    const issue = { number: issueNumber, body: '', comments: [], createdAt: '', updatedAt: '', labels: [] };
    return { issue, action: 'spawn', adwId: `adw-${issueNumber}` };
  }

  function pollCandidates(...issueNumbers: number[]): void {
    vi.mocked(filterEligibleIssues).mockReturnValueOnce({
      eligible: issueNumbers.map(candidate),
      filteredAnnotations: [],
      overlapDeferrals: [],
    });
  }

  beforeEach(() => {
    vi.mocked(spawnDetached).mockReset();
    vi.mocked(releaseIssueSpawnLock).mockReset();
    vi.mocked(evaluateCandidate).mockReset();
    vi.mocked(checkIssueEligibility).mockResolvedValue({ eligible: true });
  });

  it('releases the issue\'s spawn lock once the take-over has been spawned', async () => {
    pollCandidates(9601);
    vi.mocked(evaluateCandidate).mockReturnValueOnce(takeOver(9601));

    await checkAndTrigger(BOUNDARY);

    expect(spawnDetached).toHaveBeenCalledTimes(1);
    expect(releaseIssueSpawnLock).toHaveBeenCalledTimes(1);
    expect(releaseIssueSpawnLock).toHaveBeenCalledWith(expect.anything(), 9601);
  });

  it('still releases the spawn lock when spawning the take-over throws, and lets the error out', async () => {
    pollCandidates(9602);
    vi.mocked(evaluateCandidate).mockReturnValueOnce(takeOver(9602));
    vi.mocked(spawnDetached).mockImplementationOnce(() => {
      throw new Error('spawn EAGAIN');
    });

    await expect(checkAndTrigger(BOUNDARY)).rejects.toThrow('spawn EAGAIN');

    expect(releaseIssueSpawnLock).toHaveBeenCalledTimes(1);
    expect(releaseIssueSpawnLock).toHaveBeenCalledWith(expect.anything(), 9602);
  });

  it('skips a candidate whose evaluation throws and still takes over the candidates after it', async () => {
    pollCandidates(9603, 9604);
    vi.mocked(evaluateCandidate)
      .mockImplementationOnce(() => { throw new Error("fatal: couldn't find remote ref"); })
      .mockReturnValueOnce(takeOver(9604));

    await expect(checkAndTrigger(BOUNDARY)).resolves.toBeUndefined();

    expect(spawnDetached).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawnDetached).mock.calls[0][1]).toContain('9604');
    expect(releaseIssueSpawnLock).toHaveBeenCalledTimes(1);
    expect(releaseIssueSpawnLock).toHaveBeenCalledWith(expect.anything(), 9604);
  });
});

describe('checkAndTrigger — the ## Continue directive scan', () => {
  const ADW_COMMENT = '**ADW ID:** `adw-parked`';

  function issueWithComments(issueNumber: number, ...bodies: string[]): RawIssue {
    return { number: issueNumber, title: '', body: '', comments: bodies.map((body) => ({ body })), createdAt: '', updatedAt: '', labels: [] };
  }

  async function scan(...issues: RawIssue[]): Promise<void> {
    vi.mocked(filterEligibleIssues).mockReturnValueOnce({ eligible: [], filteredAnnotations: [], overlapDeferrals: [] });
    const boundary = {
      repoId: { owner: 'test-owner', repo: 'test-repo' },
      providers: { issueTracker: { listIssues: () => issues }, codeHost: {} },
    } as unknown as LaunchBoundary;
    await checkAndTrigger(boundary);
  }

  beforeEach(() => {
    vi.mocked(handleContinueDirective).mockClear();
    vi.mocked(buildContinueHandlerDeps).mockClear();
    vi.mocked(filterEligibleIssues).mockClear();
  });

  it('hands an issue whose latest comment is ## Continue to the waiver handler, with its comments', async () => {
    const parked = issueWithComments(9701, ADW_COMMENT, '## Continue');

    await scan(parked);

    expect(handleContinueDirective).toHaveBeenCalledOnce();
    expect(handleContinueDirective).toHaveBeenCalledWith(9701, parked.comments, vi.mocked(buildContinueHandlerDeps).mock.results[0].value);
  });

  it('leaves the issue out of the cancelled set, so the re-armed stage is picked up in the same cycle', async () => {
    await scan(issueWithComments(9702, ADW_COMMENT, '## Continue'));

    expect(vi.mocked(filterEligibleIssues).mock.calls[0][5]).toEqual(new Set());
  });

  it('reads only the latest comment of each issue', async () => {
    await scan(
      issueWithComments(9703, '## Continue', ADW_COMMENT),
      issueWithComments(9704, ADW_COMMENT, 'looks fine'),
      issueWithComments(9705),
    );

    expect(handleContinueDirective).not.toHaveBeenCalled();
  });
});
