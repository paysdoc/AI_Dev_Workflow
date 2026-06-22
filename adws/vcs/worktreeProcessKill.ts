/**
 * Process-kill helper for worktree directories.
 *
 * Extracted from worktreeCleanup.ts so callers that only need
 * killProcessesInDirectory don't pull in the full cleanup module.
 *
 * Usage:
 *   import { killProcessesInDirectory } from '../vcs/worktreeProcessKill';
 */

import { execSync } from 'child_process';
import { log } from '../core';

/**
 * Kills processes that have open files in the given directory.
 * Uses `lsof` to discover PIDs, sends SIGTERM first (graceful),
 * then SIGKILL if processes survive after 500ms.
 * Filters out the current process PID to avoid self-termination.
 *
 * @param directoryPath - The absolute path to scan for running processes
 */
export function killProcessesInDirectory(directoryPath: string): void {
  try {
    const output = execSync(`lsof +D "${directoryPath}" -t`, { encoding: 'utf-8' });
    const pids = output
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);

    if (pids.length === 0) {
      return;
    }

    log(`Found ${pids.length} process(es) in ${directoryPath}, sending SIGTERM`, 'info');
    pids.forEach((pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
    });

    // Wait 500ms then check for survivors
    execSync('sleep 0.5', { stdio: 'pipe' });

    const survivors = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    if (survivors.length > 0) {
      log(`${survivors.length} process(es) still running, sending SIGKILL`, 'info');
      survivors.forEach((pid) => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      });
    }
  } catch {
    // lsof not available or no processes found — proceed silently
  }
}
