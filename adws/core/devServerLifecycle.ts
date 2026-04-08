/**
 * Dev server lifecycle helper.
 *
 * Encapsulates the full spawn → probe → retry → work → cleanup lifecycle for
 * a development server process. Exposes a single deep-module interface:
 * `withDevServer(config, work)`.
 *
 * No production consumers are wired yet — this is pure infrastructure.
 */

import { spawn, type ChildProcess } from 'child_process';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DevServerConfig {
  startCommand: string;
  port: number;
  healthPath: string;
  cwd: string;
}

// ---------------------------------------------------------------------------
// Constants (exported for test inspection)
// ---------------------------------------------------------------------------

export const PROBE_INTERVAL_MS = 1000;
export const PROBE_TIMEOUT_MS = 20000;
export const MAX_START_ATTEMPTS = 3;
export const KILL_GRACE_MS = 5000;

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit-test access)
// ---------------------------------------------------------------------------

/** Replaces every `{PORT}` occurrence in `command` with the numeric `port`. */
export function substitutePort(command: string, port: number): string {
  return command.split('{PORT}').join(String(port));
}

/**
 * Spawns `command` as a detached shell process in `cwd`.
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

/**
 * Polls `url` with HTTP GET at `intervalMs` intervals until a 2xx response
 * is received or `timeoutMs` has elapsed.
 *
 * Returns `true` when healthy, `false` on timeout.
 */
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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Starts a dev server, runs `work`, then tears down the server.
 *
 * Lifecycle:
 * 1. Substitute `{PORT}` in `startCommand` with `config.port`.
 * 2. Loop up to `MAX_START_ATTEMPTS` times:
 *    a. Spawn the server.
 *    b. Probe the health endpoint at `PROBE_INTERVAL_MS` intervals for up to
 *       `PROBE_TIMEOUT_MS`.
 *    c. If healthy — break; proceed to `work`.
 *    d. If timed-out — kill the attempt and retry.
 * 3. If all attempts fail, log a warning and fall back to running `work` anyway.
 * 4. Run `work()` inside a `try` block.
 * 5. In the `finally` block, kill the process group (SIGTERM → SIGKILL after
 *    `KILL_GRACE_MS`) regardless of whether `work` threw.
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
