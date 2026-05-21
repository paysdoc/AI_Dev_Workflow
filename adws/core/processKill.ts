/**
 * Process-group kill helper — shared between dev-server lifecycle and agent watchdog.
 *
 * Uses `process.kill(-pid, signal)` to signal the entire POSIX process group,
 * reaching grandchildren (orphan shells, heredoc pipelines, etc.) that a simple
 * single-process kill would miss.
 *
 * ADW is single-host on POSIX (macOS/Linux) — Windows is not supported, so
 * process-group kill is not a portability concern.
 */

/**
 * Sends SIGTERM to the process *group* identified by `pid` (using `-pid`).
 * Schedules SIGKILL after `graceMs` milliseconds if the process has not yet
 * exited. Silently ignores ESRCH (process already gone).
 */
export function killProcessGroup(pid: number, graceMs: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // process already gone — nothing to do
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // process already gone
    }
  }, graceMs);
}
