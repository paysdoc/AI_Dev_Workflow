import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLaunchLedger, LAUNCH_STARTUP_WINDOW_MS, type LaunchLedgerDeps } from '../cronLaunchLedger';

describe('createLaunchLedger', () => {
  let nowMs: number;
  let deps: LaunchLedgerDeps;
  const startTimeOf = vi.fn<LaunchLedgerDeps['startTimeOf']>();
  const isLive = vi.fn<LaunchLedgerDeps['isLive']>();

  beforeEach(() => {
    nowMs = 1_000_000;
    startTimeOf.mockReset().mockImplementation((pid) => `started-${pid}`);
    isLive.mockReset().mockReturnValue(true);
    deps = { now: () => nowMs, startTimeOf, isLive };
  });

  it('reports a launch as starting while its process is live and the startup window has not passed', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);
    nowMs += LAUNCH_STARTUP_WINDOW_MS - 1;

    expect(ledger.isStarting(148)).toBe(true);
  });

  it('checks liveness against the start time read when the process was launched', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);

    ledger.isStarting(148);

    expect(isLive).toHaveBeenCalledWith(27828, 'started-27828');
  });

  it('reports nothing for an issue it has no launch for', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);

    expect(ledger.isStarting(149)).toBe(false);
  });

  it('stops reporting a launch once its process has exited, and does not ask about it again', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);
    isLive.mockReturnValue(false);

    expect(ledger.isStarting(148)).toBe(false);
    isLive.mockReturnValue(true);
    expect(ledger.isStarting(148)).toBe(false);
  });

  it('stops reporting a launch once the startup window has passed, though its process is still live', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);
    nowMs += LAUNCH_STARTUP_WINDOW_MS;

    expect(ledger.isStarting(148)).toBe(false);
  });

  it('records nothing for a spawn that returned no pid', () => {
    const ledger = createLaunchLedger(deps);

    ledger.record(148, undefined);

    expect(ledger.isStarting(148)).toBe(false);
    expect(startTimeOf).not.toHaveBeenCalled();
  });

  it('records nothing for a process whose start time cannot be read, since its liveness could never be confirmed', () => {
    const ledger = createLaunchLedger(deps);
    startTimeOf.mockReturnValue(null);

    ledger.record(148, 27828);

    expect(ledger.isStarting(148)).toBe(false);
  });

  it('keeps one launch per issue: a newer launch replaces the older', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);
    nowMs += LAUNCH_STARTUP_WINDOW_MS - 1;
    ledger.record(148, 31634);
    nowMs += LAUNCH_STARTUP_WINDOW_MS - 1;

    expect(ledger.isStarting(148)).toBe(true);
    expect(isLive).toHaveBeenCalledWith(31634, 'started-31634');
  });

  it('tracks each issue on its own', () => {
    const ledger = createLaunchLedger(deps);
    ledger.record(148, 27828);
    ledger.record(149, 31634);
    isLive.mockImplementation((pid) => pid === 31634);

    expect(ledger.isStarting(148)).toBe(false);
    expect(ledger.isStarting(149)).toBe(true);
  });
});
