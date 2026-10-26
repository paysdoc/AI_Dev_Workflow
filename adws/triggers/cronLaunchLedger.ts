/**
 * The orchestrators this cron process launched for takeovers, by issue. An orchestrator takes the issue's spawn lock
 * as its first startup step, and the cron releases the lock it held for the takeover as soon as it has spawned, so for
 * the seconds in between nothing on disk tells the next poll that a launch is under way. A launch the ledger cannot
 * see (made before a cron restart, or by another trigger) loses the lock at that first step instead.
 */

import { getProcessStartTime, isProcessLive } from '../core/processLiveness';

/**
 * Covers a slow start. After it the lock is the only guard: an orchestrator still running by then holds it, and one
 * that is wedged before it never will.
 */
export const LAUNCH_STARTUP_WINDOW_MS = 60_000;

interface Launch {
  readonly pid: number;
  readonly pidStartedAt: string;
  readonly launchedAtMs: number;
}

export interface LaunchLedgerDeps {
  readonly now: () => number;
  readonly startTimeOf: (pid: number) => string | null;
  readonly isLive: (pid: number, pidStartedAt: string) => boolean;
}

export interface LaunchLedger {
  /** A spawn that returned no pid, or whose process is already gone, is not recorded: its liveness could never be confirmed. */
  record(issueNumber: number, pid: number | undefined): void;
  /** True while the process launched for the issue is still that process and the startup window has not passed. */
  isStarting(issueNumber: number): boolean;
}

const defaultDeps: LaunchLedgerDeps = { now: Date.now, startTimeOf: getProcessStartTime, isLive: isProcessLive };

export function createLaunchLedger(deps: LaunchLedgerDeps = defaultDeps): LaunchLedger {
  const launches = new Map<number, Launch>();

  return {
    record(issueNumber, pid) {
      launches.delete(issueNumber);
      if (pid === undefined) return;
      const pidStartedAt = deps.startTimeOf(pid);
      if (pidStartedAt === null) return;
      launches.set(issueNumber, { pid, pidStartedAt, launchedAtMs: deps.now() });
    },

    isStarting(issueNumber) {
      const launch = launches.get(issueNumber);
      if (launch === undefined) return false;
      const starting = deps.now() - launch.launchedAtMs < LAUNCH_STARTUP_WINDOW_MS && deps.isLive(launch.pid, launch.pidStartedAt);
      if (!starting) launches.delete(issueNumber);
      return starting;
    },
  };
}
