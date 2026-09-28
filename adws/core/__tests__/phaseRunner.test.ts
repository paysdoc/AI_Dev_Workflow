import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostTracker, runPhase, runPhasesParallel, runPhasesSequential } from '../phaseRunner';
import { RateLimitError } from '../../types/agentTypes';
import type { WorkflowConfig } from '../../phases/workflowInit';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from './fixtures/rateLimitIncident';
import { startHeartbeat, stopHeartbeat } from '../heartbeat';
import { MIN_RATE_LIMIT_WAIT_MS, type WaitClock } from '../rateLimitWaitPolicy';

// Hoist mock variables so they are available when vi.mock factory runs
const { writeTopLevelStateMock, readTopLevelStateMock } = vi.hoisted(() => ({
  writeTopLevelStateMock: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readTopLevelStateMock: vi.fn(() => null as any),
}));

vi.mock('../config', () => ({ RUNNING_TOKENS: false }));
vi.mock('../../cost', () => ({
  mergeModelUsageMaps: (a: Record<string, unknown>, b: Record<string, unknown>) => ({ ...a, ...b }),
  persistTokenCounts: vi.fn(),
  computeDisplayTokens: vi.fn(() => 0),
}));
vi.mock('../../cost/d1Client', () => ({
  postCostRecordsToD1: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../agentState', () => ({
  AgentStateManager: {
    readState: vi.fn(() => null),
    writeState: vi.fn(),
    writeTopLevelState: writeTopLevelStateMock,
    readTopLevelState: readTopLevelStateMock,
    getTopLevelStatePath: vi.fn((id: string) => `/tmp/agents/${id}/state.json`),
    appendLog: vi.fn(),
  },
}));

// Mock handleRateLimitPause so we can assert it's called without exiting
const mockHandleRateLimitPause = vi.fn();
vi.mock('../../phases/workflowCompletion', () => ({
  handleRateLimitPause: (...args: unknown[]) => mockHandleRateLimitPause(...args),
}));

function makeConfig(overrides?: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    adwId: 'test-adwid',
    orchestratorStatePath: '/tmp/test-state',
    ctx: {},
    completedPhases: [],
    ...overrides,
  } as unknown as WorkflowConfig;
}

describe('CostTracker', () => {
  it('starts at zero', () => {
    const tracker = new CostTracker();
    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.totalModelUsage).toEqual({});
  });

  const usage = (inputTokens: number) => ({
    inputTokens,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0,
  });

  it('accumulates cost across multiple phases', () => {
    const tracker = new CostTracker();
    tracker.accumulate({ costUsd: 0.01, modelUsage: { 'model-a': usage(100) } });
    tracker.accumulate({ costUsd: 0.02, modelUsage: { 'model-b': usage(200) } });
    expect(tracker.totalCostUsd).toBeCloseTo(0.03);
  });

  it('merges model usage maps across phases', () => {
    const tracker = new CostTracker();
    tracker.accumulate({ costUsd: 0, modelUsage: { 'model-a': usage(10) } });
    tracker.accumulate({ costUsd: 0, modelUsage: { 'model-b': usage(20) } });
    expect(tracker.totalModelUsage).toHaveProperty('model-a');
    expect(tracker.totalModelUsage).toHaveProperty('model-b');
  });
});

describe('runPhase()', () => {
  beforeEach(() => {
    mockHandleRateLimitPause.mockClear();
    writeTopLevelStateMock.mockClear();
    readTopLevelStateMock.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readTopLevelStateMock.mockReturnValue(null as any);
  });

  it('returns the phase result and accumulates cost into the tracker', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {}, phaseCostRecords: [] });

    const result = await runPhase(config, tracker, phaseFn);

    expect(result.costUsd).toBe(0.05);
    expect(tracker.totalCostUsd).toBe(0.05);
    expect(phaseFn).toHaveBeenCalledWith(config);
  });

  it('re-throws non-RateLimitError errors to the caller', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const boom = new Error('unexpected failure');
    const phaseFn = vi.fn().mockRejectedValue(boom);

    await expect(runPhase(config, tracker, phaseFn)).rejects.toThrow('unexpected failure');
    expect(mockHandleRateLimitPause).not.toHaveBeenCalled();
  });

  it('calls handleRateLimitPause with the caught RateLimitError as the sixth argument', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const rateLimitErr = new RateLimitError('plan');
    const phaseFn = vi.fn().mockRejectedValue(rateLimitErr);

    await expect(runPhase(config, tracker, phaseFn)).rejects.toThrow(RateLimitError);
    expect(mockHandleRateLimitPause).toHaveBeenCalledWith(
      config,
      'plan',
      'rate_limited',
      0,
      {},
      rateLimitErr,
    );
  });

  it('passes a RateLimitError carrying reset facts through to handleRateLimitPause unchanged (seven_day enqueues; five_hour+resetsAt now waits in-process instead — see the wait describe block below)', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const rateLimitErr = new RateLimitError('plan', {
      rateLimitType: 'seven_day',
      resetsAt: INCIDENT_RESETS_AT,
    });
    const phaseFn = vi.fn().mockRejectedValue(rateLimitErr);

    await expect(runPhase(config, tracker, phaseFn)).rejects.toThrow(RateLimitError);
    const sixthArg = mockHandleRateLimitPause.mock.calls[0][5];
    expect(sixthArg).toMatchObject({ rateLimitType: 'seven_day', resetsAt: INCIDENT_RESETS_AT });
  });

  it('skips a phase that is already in config.completedPhases', async () => {
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
    expect(tracker.totalCostUsd).toBe(0);
  });

  it('does not skip a phase that is not in config.completedPhases', async () => {
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.03, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'plan');

    expect(phaseFn).toHaveBeenCalled();
    expect(tracker.totalCostUsd).toBe(0.03);
  });

  it('writes running status to top-level state before executing phase', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    type CallArg = { phases?: { build?: { status: string } }; workflowStage?: string };
    const runningCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'running'
    );
    expect(runningCall).toBeDefined();
    expect((runningCall![1] as CallArg).workflowStage).toBe('build_running');
  });

  it('writes completed status to top-level state after successful phase', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    type CallArg = { phases?: { build?: { status: string } }; workflowStage?: string };
    const completedCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'completed'
    );
    expect(completedCall).toBeDefined();
    expect((completedCall![1] as CallArg).workflowStage).toBe('build_completed');
  });

  it('writes failed status to top-level state when phase throws', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockRejectedValue(new Error('phase failed'));

    await expect(runPhase(config, tracker, phaseFn, 'build')).rejects.toThrow('phase failed');

    type CallArg = { phases?: { build?: { status: string } } };
    const failedCall = writeTopLevelStateMock.mock.calls.find(
      (call: unknown[]) => (call[1] as CallArg)?.phases?.build?.status === 'failed'
    );
    expect(failedCall).toBeDefined();
  });

  it('skips phase when top-level phases map shows completed status', async () => {
    readTopLevelStateMock.mockReturnValue(
      { phases: { install: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' } } // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const config = makeConfig({ completedPhases: [] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('does not skip phase when top-level phases map shows failed status', async () => {
    readTopLevelStateMock.mockReturnValue(
      { phases: { build: { status: 'failed', startedAt: '2024-01-01T00:00:00Z' } } // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const config = makeConfig({ completedPhases: ['build'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.01, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn, 'build');

    expect(phaseFn).toHaveBeenCalled();
  });

  it('falls back to config.completedPhases when top-level state has no phases map', async () => {
    readTopLevelStateMock.mockReturnValue({ workflowStage: 'starting' } as Record<string, unknown>);
    const config = makeConfig({ completedPhases: ['install'] });
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0.05, modelUsage: {} });

    const result = await runPhase(config, tracker, phaseFn, 'install');

    expect(phaseFn).not.toHaveBeenCalled();
    expect(result.costUsd).toBe(0);
  });

  it('does not write top-level state when phaseName is undefined', async () => {
    const config = makeConfig();
    const tracker = new CostTracker();
    const phaseFn = vi.fn().mockResolvedValue({ costUsd: 0, modelUsage: {}, phaseCostRecords: [] });

    await runPhase(config, tracker, phaseFn);

    expect(writeTopLevelStateMock).not.toHaveBeenCalled();
  });

  describe('in-process rate-limit wait', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-22T11:57:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function makeFakeClock(): { clock: WaitClock; sleeps: number[] } {
      const sleeps: number[] = [];
      const clock: WaitClock = {
        now: () => new Date(),
        sleep: (ms: number) => {
          sleeps.push(ms);
          return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
        },
      };
      return { clock, sleeps };
    }

    function makePostComment(): { postComment: (issueNumber: number, body: string) => void; posted: Array<{ issueNumber: number; body: string }> } {
      const posted: Array<{ issueNumber: number; body: string }> = [];
      return { postComment: (issueNumber, body) => { posted.push({ issueNumber, body }); }, posted };
    }

    function makeThreeRejectionPhaseFn(resets: number[], attemptStarts: number[]) {
      let call = 0;
      return vi.fn().mockImplementation(async () => {
        attemptStarts.push(Date.now());
        const idx = call++;
        if (idx < resets.length) {
          throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: resets[idx] });
        }
        return { costUsd: 0.05, modelUsage: {}, phaseCostRecords: [] };
      });
    }

    it('waits out three consecutive five-hour rejections, then returns the phase result on the fourth attempt', async () => {
      const config = makeConfig({ issueNumber: 840, adwId: 'wait912-840' });
      const tracker = new CostTracker();
      const { clock, sleeps } = makeFakeClock();
      const { postComment, posted } = makePostComment();
      const resets = [INCIDENT_RESETS_AT, INCIDENT_RESETS_AT + 3600, INCIDENT_RESETS_AT + 7200];
      const attemptStarts: number[] = [];
      const phaseFn = makeThreeRejectionPhaseFn(resets, attemptStarts);

      const heartbeat = startHeartbeat(config.adwId, 30_000);
      const result = await runPhase(config, tracker, phaseFn, 'build', { clock, postComment });
      stopHeartbeat(heartbeat);

      expect(phaseFn).toHaveBeenCalledTimes(4);
      expect(result.costUsd).toBe(0.05);
      expect(tracker.totalCostUsd).toBe(0.05);
      expect(mockHandleRateLimitPause).not.toHaveBeenCalled();

      expect(posted).toHaveLength(3);
      posted.forEach((p, i) => {
        expect(p.issueNumber).toBe(840);
        expect(p.body).toContain(new Date(resets[i] * 1000).toISOString());
        expect(p.body).toContain('(UTC)');
        expect(p.body).toContain(`**Attempt:** ${i + 1}`);
      });

      expect(sleeps).toHaveLength(3);
      for (let k = 0; k < 3; k++) {
        expect(attemptStarts[k + 1]).toBeGreaterThanOrEqual(resets[k] * 1000);
      }
      expect(Date.now()).toBeGreaterThanOrEqual(resets[2] * 1000);
    });

    it('keeps the workflow stage unchanged and the heartbeat alive (lastSeenAt strictly increasing) across every wait', async () => {
      const config = makeConfig({ issueNumber: 840, adwId: 'wait912-871' });
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();
      const { postComment } = makePostComment();
      const resets = [INCIDENT_RESETS_AT, INCIDENT_RESETS_AT + 3600, INCIDENT_RESETS_AT + 7200];
      const attemptStarts: number[] = [];
      const phaseFn = makeThreeRejectionPhaseFn(resets, attemptStarts);

      const heartbeat = startHeartbeat(config.adwId, 30_000);
      await runPhase(config, tracker, phaseFn, 'build', { clock, postComment });
      stopHeartbeat(heartbeat);

      type CallArg = { phases?: { build?: { status: string } }; workflowStage?: string; lastSeenAt?: string };
      const calls = writeTopLevelStateMock.mock.calls as unknown as [string, CallArg][];
      const runningIdx = calls.findIndex(c => c[1]?.phases?.build?.status === 'running');
      const completedIdx = calls.findIndex(c => c[1]?.phases?.build?.status === 'completed');
      expect(runningIdx).toBeGreaterThanOrEqual(0);
      expect(completedIdx).toBeGreaterThan(runningIdx);

      const between = calls.slice(runningIdx + 1, completedIdx);
      for (const [, arg] of between) {
        expect(arg.workflowStage).toBeUndefined();
        if (arg.phases?.build?.status) expect(arg.phases.build.status).not.toBe('failed');
      }

      const lastSeenValues = between.map(([, arg]) => arg.lastSeenAt).filter((v): v is string => typeof v === 'string');
      expect(lastSeenValues.length).toBeGreaterThan(0);
      for (let i = 1; i < lastSeenValues.length; i++) {
        expect(new Date(lastSeenValues[i]).getTime()).toBeGreaterThan(new Date(lastSeenValues[i - 1]).getTime());
      }
    });

    it('takes the enqueue path when a second rejection carries no reset time, after a prior wait', async () => {
      const config = makeConfig({ issueNumber: 873, adwId: 'wait912-873' });
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();
      const { postComment, posted } = makePostComment();

      let call = 0;
      const phaseFn = vi.fn().mockImplementation(async () => {
        const idx = call++;
        if (idx === 0) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
        if (idx === 1) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE });
        return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
      });

      await expect(runPhase(config, tracker, phaseFn, 'build', { clock, postComment })).rejects.toThrow(RateLimitError);

      expect(phaseFn).toHaveBeenCalledTimes(2);
      expect(mockHandleRateLimitPause).toHaveBeenCalledTimes(1);
      expect(mockHandleRateLimitPause.mock.calls[0][5]).toMatchObject({ rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: undefined });
      expect(posted).toHaveLength(1);

      type CallArg = { phases?: { build?: { status: string } } };
      const failedCall = writeTopLevelStateMock.mock.calls.find((c: unknown[]) => (c[1] as CallArg)?.phases?.build?.status === 'failed');
      expect(failedCall).toBeDefined();
    });

    it('enqueues immediately for a seven_day limit with a reset time — no sleep, no wait comment', async () => {
      const config = makeConfig({ issueNumber: 111, adwId: 'wait912-sevenday' });
      const tracker = new CostTracker();
      const { clock, sleeps } = makeFakeClock();
      const { postComment, posted } = makePostComment();
      const before = Date.now();

      const rateLimitErr = new RateLimitError('build', { rateLimitType: 'seven_day', resetsAt: INCIDENT_RESETS_AT + 999_999 });
      const phaseFn = vi.fn().mockRejectedValue(rateLimitErr);

      await expect(runPhase(config, tracker, phaseFn, 'build', { clock, postComment })).rejects.toThrow(RateLimitError);

      expect(mockHandleRateLimitPause).toHaveBeenCalledTimes(1);
      expect(sleeps).toHaveLength(0);
      expect(posted).toHaveLength(0);
      expect(Date.now()).toBe(before);
    });

    it('waits the floor for a reset time already behind the clock, then re-runs and succeeds', async () => {
      const config = makeConfig({ issueNumber: 222, adwId: 'wait912-stale' });
      const tracker = new CostTracker();
      const { clock, sleeps } = makeFakeClock();
      const { postComment, posted } = makePostComment();
      const staleResetsAt = Math.floor(Date.now() / 1000) - 10;

      let call = 0;
      const phaseFn = vi.fn().mockImplementation(async () => {
        if (call++ === 0) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: staleResetsAt });
        return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
      });

      await runPhase(config, tracker, phaseFn, 'build', { clock, postComment });

      expect(posted).toHaveLength(1);
      expect(sleeps).toEqual([MIN_RATE_LIMIT_WAIT_MS]);
      expect(phaseFn).toHaveBeenCalledTimes(2);
    });

    it('defaults the comment poster to config.repoContext.issueTracker.commentOnIssue', async () => {
      const recorded: Array<{ issueNumber: number; body: string }> = [];
      const config = makeConfig({
        issueNumber: 333,
        adwId: 'wait912-seam',
        repoContext: { issueTracker: { commentOnIssue: (n: number, b: string) => { recorded.push({ issueNumber: n, body: b }); } } },
      } as unknown as Partial<WorkflowConfig>);
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();

      let call = 0;
      const phaseFn = vi.fn().mockImplementation(async () => {
        if (call++ === 0) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
        return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
      });

      await runPhase(config, tracker, phaseFn, 'build', { clock });

      expect(recorded).toHaveLength(1);
      expect(recorded[0].issueNumber).toBe(333);
    });

    it('swallows a commentOnIssue that throws and still completes the wait', async () => {
      const config = makeConfig({
        issueNumber: 334,
        adwId: 'wait912-seam-throw',
        repoContext: { issueTracker: { commentOnIssue: () => { throw new Error('boom'); } } },
      } as unknown as Partial<WorkflowConfig>);
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();

      let call = 0;
      const phaseFn = vi.fn().mockImplementation(async () => {
        if (call++ === 0) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
        return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
      });

      const result = await runPhase(config, tracker, phaseFn, 'build', { clock });
      expect(result.costUsd).toBe(0);
      expect(phaseFn).toHaveBeenCalledTimes(2);
    });

    it('does not throw when there is no repoContext at all', async () => {
      const config = makeConfig({ issueNumber: 335, adwId: 'wait912-seam-none' });
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();

      let call = 0;
      const phaseFn = vi.fn().mockImplementation(async () => {
        if (call++ === 0) throw new RateLimitError('build', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
        return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
      });

      await expect(runPhase(config, tracker, phaseFn, 'build', { clock })).resolves.toBeDefined();
    });

    it('runPhasesParallel waits and re-runs the whole group, letting the sibling settle before it sleeps', async () => {
      const config = makeConfig({ issueNumber: 444, adwId: 'wait912-parallel' });
      const tracker = new CostTracker();
      const { postComment, posted } = makePostComment();

      let rejectingCall = 0;
      const rejectingFn = vi.fn().mockImplementation(async () => {
        const idx = rejectingCall++;
        if (idx < 2) throw new RateLimitError('planScenario', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT + idx * 3600 });
        return { costUsd: 0.01, modelUsage: {}, phaseCostRecords: [] };
      });

      let siblingSettledCount = 0;
      const siblingFn = vi.fn().mockImplementation(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
        siblingSettledCount++;
        return { costUsd: 0.02, modelUsage: {}, phaseCostRecords: [] };
      });

      const sleeps: number[] = [];
      const sleepObservedSettledCounts: number[] = [];
      const clock: WaitClock = {
        now: () => new Date(),
        sleep: (ms: number) => {
          sleepObservedSettledCounts.push(siblingSettledCount);
          sleeps.push(ms);
          return vi.advanceTimersByTimeAsync(ms).then(() => undefined);
        },
      };

      const results = await runPhasesParallel(config, tracker, [rejectingFn, siblingFn], { clock, postComment });

      expect(rejectingFn).toHaveBeenCalledTimes(3);
      expect(siblingFn).toHaveBeenCalledTimes(3);
      expect(results).toHaveLength(2);
      expect(tracker.totalCostUsd).toBeCloseTo(0.03);
      expect(posted).toHaveLength(2);
      expect(sleeps).toHaveLength(2);
      expect(sleepObservedSettledCounts).toEqual([1, 2]);
    });

    it('runPhasesSequential threads deps through and restarts the attempt counter for each phase', async () => {
      const config = makeConfig({ issueNumber: 555, adwId: 'wait912-seq' });
      const tracker = new CostTracker();
      const { clock } = makeFakeClock();
      const { postComment, posted } = makePostComment();

      function makeOnceRejectingFn() {
        let call = 0;
        return vi.fn().mockImplementation(async () => {
          if (call++ === 0) throw new RateLimitError('phaseA', { rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
          return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
        });
      }
      const fnA = makeOnceRejectingFn();
      const fnB = makeOnceRejectingFn();

      await runPhasesSequential(config, tracker, [fnA, fnB], { clock, postComment });

      expect(fnA).toHaveBeenCalledTimes(2);
      expect(fnB).toHaveBeenCalledTimes(2);
      expect(posted).toHaveLength(2);
      expect(posted[0].body).toContain('**Attempt:** 1');
      expect(posted[1].body).toContain('**Attempt:** 1');
    });
  });
});
