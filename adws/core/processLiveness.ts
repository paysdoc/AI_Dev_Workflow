/**
 * processLiveness — PID-plus-start-time authoritative liveness checks.
 *
 * Closes the PID-reuse hazard: after a reboot or long uptime the OS may recycle
 * a PID to an unrelated process. A bare `kill -0 pid` returns true for *any*
 * occupant of that PID slot. This module pairs `kill -0` with the process
 * start-time so `isProcessLive` returns true only when the PID is alive AND
 * its start-time exactly matches the value recorded at lock/state-write time.
 *
 * Platform support:
 *   Linux  — reads `/proc/<pid>/stat` field 22 (jiffies since boot).
 *   macOS / BSD — shells out to `ps -o lstart= -p <pid>`.
 *   Windows — explicitly unsupported by ADW. `getProcessStartTime` returns
 *             null and `isProcessLive` returns false for any input. No throw.
 */

import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

export interface ProcessLivenessDeps {
  readFile: (path: string) => string;
  execPs: (pid: number) => string;
}

export const defaultDeps: ProcessLivenessDeps = {
  readFile: (filePath: string) => readFileSync(filePath, 'utf-8'),
  execPs: (pid: number) =>
    execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf-8' }) as string,
};

function readLinuxStartTime(pid: number, deps: ProcessLivenessDeps): string | null {
  try {
    const content = deps.readFile(`/proc/${pid}/stat`);
    // Anchor on the *last* ')' to correctly handle comm names containing ')'.
    const lastParen = content.lastIndexOf(')');
    if (lastParen === -1) return null;
    // Fields after comm: state(3) ppid(4) pgrp(5) session(6) tty(7) tpgid(8)
    // flags(9) minflt(10) cminflt(11) majflt(12) cmajflt(13) utime(14)
    // stime(15) cutime(16) cstime(17) priority(18) nice(19) numthreads(20)
    // itrealvalue(21) starttime(22) — index 19 in the post-')' token array
    const afterComm = content.slice(lastParen + 1).trim();
    const fields = afterComm.split(/\s+/);
    // fields[0]=state, fields[1]=ppid, ..., fields[19]=starttime (field 22)
    const startTime = fields[19];
    if (startTime === undefined || startTime === '') return null;
    return startTime;
  } catch {
    return null;
  }
}

function readPsLstart(pid: number, deps: ProcessLivenessDeps): string | null {
  try {
    const output = deps.execPs(pid);
    const trimmed = output.trim();
    return trimmed === '' ? null : trimmed;
  } catch {
    return null;
  }
}

/**
 * Returns the platform start-time token for `pid`, or null if the process
 * does not exist, the platform is unsupported (Windows), or the read fails.
 */
export function getProcessStartTime(
  pid: number,
  deps: ProcessLivenessDeps = defaultDeps,
): string | null {
  const platform = process.platform;
  if (platform === 'linux') return readLinuxStartTime(pid, deps);
  if (
    platform === 'darwin' ||
    platform === 'freebsd' ||
    platform === 'openbsd' ||
    platform === 'netbsd'
  ) {
    return readPsLstart(pid, deps);
  }
  return null;
}

/**
 * Returns true iff `kill -0 pid` succeeds AND the current start-time for
 * `pid` exactly equals `recordedStartTime`. Returns false for Windows or
 * any platform where the start-time cannot be determined.
 */
export function isProcessLive(
  pid: number,
  recordedStartTime: string,
  deps: ProcessLivenessDeps = defaultDeps,
): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const currentStartTime = getProcessStartTime(pid, deps);
  if (currentStartTime === null) return false;
  return currentStartTime === recordedStartTime;
}
