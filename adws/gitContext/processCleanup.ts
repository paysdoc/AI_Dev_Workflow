/**
 * Process cleanup utility for the GitContext package.
 * Kills processes that have open files in a given directory.
 * Self-contained — no git/gh, no ADW core imports.
 */

import { execSync } from 'child_process';

export function killProcessesInDirectory(directoryPath: string): void {
  try {
    const output = execSync(`lsof +D "${directoryPath}" -t`, { encoding: 'utf-8' });
    const pids = output
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);

    if (pids.length === 0) return;

    pids.forEach((pid) => {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
    });

    execSync('sleep 0.5', { stdio: 'pipe' });

    const survivors = pids.filter((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    });

    if (survivors.length > 0) {
      survivors.forEach((pid) => {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
      });
    }
  } catch {
    // lsof not available or no processes found — proceed silently
  }
}
