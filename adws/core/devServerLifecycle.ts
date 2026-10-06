/**
 * Encapsulates the full spawn → probe → retry → work → cleanup lifecycle for
 * a development server process.
 *
 * `withDevServer` runs the work even when no attempt became healthy;
 * `withHealthyDevServer` never does, and hands back the last attempt's output instead.
 */

import * as fs from 'fs';
import * as path from 'path';
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

export interface HealthyDevServerConfig extends DevServerConfig {
  readonly outputPath: string;
}

export type HealthyDevServerOutcome<T> =
  | { readonly started: true; readonly result: T }
  | { readonly started: false; readonly output: string };

export interface DevServerLifecycleDeps {
  readonly spawn: (command: string, cwd: string, outputFd: number) => ChildProcess;
  readonly probe: typeof probeHealth;
  readonly kill: typeof killProcessGroup;
  readonly alive: (pid: number) => boolean;
}

export const PROBE_INTERVAL_MS = 1000;
export const PROBE_TIMEOUT_MS = 20000;
export const MAX_START_ATTEMPTS = 3;
export const KILL_GRACE_MS = 5000;

const DEFAULT_DEV_SERVER_PORT = 3000;
const NO_DEV_SERVER = 'N/A';

export function substitutePort(command: string, port: number): string {
  return command.split('{PORT}').join(String(port));
}

export function devServerPort(applicationUrl: string): number {
  try {
    const { port } = new URL(applicationUrl);
    const parsed = parseInt(port, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEV_SERVER_PORT;
  } catch {
    return DEFAULT_DEV_SERVER_PORT;
  }
}

export function isDevServerConfigured(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.length > 0 && trimmed !== NO_DEV_SERVER;
}

/**
 * Returns the `ChildProcess` — caller is responsible for cleanup.
 */
export function spawnServer(command: string, cwd: string, outputFd?: number): ChildProcess {
  const proc = spawn(command, [], {
    detached: true,
    shell: true,
    stdio: outputFd === undefined ? 'ignore' : ['ignore', outputFd, outputFd],
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

function isGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

const defaultLifecycleDeps: DevServerLifecycleDeps = {
  spawn: spawnServer,
  probe: probeHealth,
  kill: killProcessGroup,
  alive: isGroupAlive,
};

function spawnWithOutput(config: HealthyDevServerConfig, deps: DevServerLifecycleDeps): ChildProcess {
  fs.mkdirSync(path.dirname(config.outputPath), { recursive: true });
  const outputFd = fs.openSync(config.outputPath, 'w');
  try {
    return deps.spawn(substitutePort(config.startCommand, config.port), config.cwd, outputFd);
  } finally {
    fs.closeSync(outputFd);
  }
}

// killProcessGroup only signals (SIGKILL follows after the grace period), so wait for the group
// to exit: the next phase must neither run beside the server nor find the run's port taken.
async function stopServer(pid: number, deps: DevServerLifecycleDeps): Promise<void> {
  deps.kill(pid, KILL_GRACE_MS);
  const deadline = Date.now() + KILL_GRACE_MS + PROBE_INTERVAL_MS;
  while (Date.now() < deadline && deps.alive(pid)) {
    await sleep(PROBE_INTERVAL_MS);
  }
}

async function startOneAttempt(
  config: HealthyDevServerConfig,
  deps: DevServerLifecycleDeps,
): Promise<number | undefined> {
  const { pid } = spawnWithOutput(config, deps);
  if (pid === undefined) return undefined;

  const url = `http://localhost:${config.port}${config.healthPath}`;
  if (await deps.probe(url, PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS)) return pid;

  await stopServer(pid, deps);
  return undefined;
}

export async function withHealthyDevServer<T>(
  config: HealthyDevServerConfig,
  work: () => Promise<T>,
  deps: Partial<DevServerLifecycleDeps> = {},
): Promise<HealthyDevServerOutcome<T>> {
  const lifecycle: DevServerLifecycleDeps = { ...defaultLifecycleDeps, ...deps };

  let pid: number | undefined;
  for (let attempt = 0; attempt < MAX_START_ATTEMPTS && pid === undefined; attempt++) {
    pid = await startOneAttempt(config, lifecycle);
  }

  // A run against a server that did not start would give a server verdict, not a verdict on
  // the work: the caller has to act on the failure instead.
  if (pid === undefined) {
    return { started: false, output: fs.readFileSync(config.outputPath, 'utf-8') };
  }

  try {
    return { started: true, result: await work() };
  } finally {
    await stopServer(pid, lifecycle);
  }
}
