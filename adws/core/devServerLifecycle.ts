/**
 * Encapsulates the full spawn → probe → retry → work → cleanup lifecycle for
 * a development server process.
 *
 * No production consumers are wired yet — this is pure infrastructure.
 */

import { spawn, type ChildProcess } from 'child_process';
import { killProcessGroup } from './processKill';

// Re-export so existing imports from devServerLifecycle keep working.
export { killProcessGroup } from './processKill';

export interface DevServerConfig {
  startCommand: string;
  port: number;
  healthPath: string;
  cwd: string;
}

export const PROBE_INTERVAL_MS = 1000;
export const PROBE_TIMEOUT_MS = 20000;
export const MAX_START_ATTEMPTS = 3;
export const KILL_GRACE_MS = 5000;

export function substitutePort(command: string, port: number): string {
  return command.split('{PORT}').join(String(port));
}

/**
 * Returns the `ChildProcess` — caller is responsible for cleanup.
 */
export function spawnServer(command: string, cwd: string): ChildProcess {
  const proc = spawn(command, [], {
    detached: true,
    shell: true,
    stdio: 'ignore',
    cwd,
  });
  proc.unref();
  return proc;
}

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export async function probeHealth(
  url: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // probe failed — continue
    }
    if (Date.now() < deadline) {
      await sleep(intervalMs);
    }
  }
  return false;
}

/**
 * Starts a dev server, runs `work`, then tears down the server.
 *
 * If all attempts fail, log a warning and fall back to running `work` anyway.
 * In the `finally` block, kill the process group (SIGTERM → SIGKILL after
 * `KILL_GRACE_MS`) regardless of whether `work` threw.
 */
export async function withDevServer<T>(
  config: DevServerConfig,
  work: () => Promise<T>,
): Promise<T> {
  const command = substitutePort(config.startCommand, config.port);
  const url = `http://localhost:${config.port}${config.healthPath}`;

  let runningProcess: ChildProcess | null = null;

  for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt++) {
    const proc = spawnServer(command, config.cwd);
    runningProcess = proc;

    const healthy = await probeHealth(url, PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS);

    if (healthy) {
      break; // runningProcess holds the running server
    }

    // Probe timed out — kill this attempt before retrying
    if (proc.pid !== undefined) {
      killProcessGroup(proc.pid, KILL_GRACE_MS);
    }
    runningProcess = null;
  }

  if (runningProcess === null) {
    console.warn(
      '[devServerLifecycle] Dev server failed to become healthy after all attempts — running work anyway',
    );
  }

  try {
    return await work();
  } finally {
    if (runningProcess?.pid !== undefined) {
      killProcessGroup(runningProcess.pid, KILL_GRACE_MS);
    }
  }
}
