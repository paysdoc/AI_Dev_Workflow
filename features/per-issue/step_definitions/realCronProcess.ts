/**
 * Shared helper for launching a real `bunx tsx adws/triggers/trigger_cron.ts --target-repo`
 * process from a scenario. Factored out of feature-812.steps.ts (its `spawnCron`) so
 * feature-911's §4 can launch its own real cron without copying the helper or sharing
 * feature-812's `@adw-812`-scoped world/hooks. Each caller holds its own `RealCronWorld`
 * instance (via `createRealCronWorld`) and is responsible for killing it in its own `After`
 * hook (`killRealCronWorld`).
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '../../..');

const FAKE_WORKING_PAT = 'adw-real-cron-test-pat-never-used-for-a-real-call';
export const CLAUDE_CLI_STUB = path.join(REPO_ROOT, 'test', 'mocks', 'claude-cli-stub.ts');

export interface RealCronWorld {
  proc: ChildProcess | null;
  stdout: string;
  stderr: string;
  exited: boolean;
  exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
  repoKey: string;
}

export function createRealCronWorld(): RealCronWorld {
  return { proc: null, stdout: '', stderr: '', exited: false, exitInfo: null, repoKey: '' };
}

/** Mirrors cronProcessGuard.ts's own path derivation (agents/cron/{owner}_{repo}.json). */
export function cronPidFilePath(repoKey: string): string {
  return path.join(REPO_ROOT, 'agents', 'cron', repoKey.replace('/', '_') + '.json');
}

export function readCronPid(repoKey: string): number | null {
  try {
    const raw = fs.readFileSync(cronPidFilePath(repoKey), 'utf-8');
    const parsed = JSON.parse(raw) as { pid?: number };
    return typeof parsed.pid === 'number' ? parsed.pid : null;
  } catch {
    return null;
  }
}

/** Real liveness proof: signal 0 to the PID recorded by the process itself (not the bunx wrapper). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

export async function waitForRealCron(world: RealCronWorld, predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!predicate()) {
    throw new Error(`Timed out waiting for: ${description}\nstdout:\n${world.stdout}\nstderr:\n${world.stderr}`);
  }
}

/**
 * Pinned (via --target-repo) to a throwaway repo key so it never contends with a real
 * cron's PID file for this repo. A syntactically-complete PAT satisfies GitContext's
 * construction-time validate-and-discard probe without ever making a real GitHub call, and
 * the GitHub App is deliberately left unconfigured so no eager installation-token resolution
 * is attempted. CLAUDE_CODE_PATH always points at the repo's Claude CLI stub so the entry
 * guard's guardrails-probe warm-up (and the pause-queue scanner's rate-limit probe) resolve
 * in milliseconds instead of real `claude` calls, classifying every probe `clear` by default.
 */
export function spawnRealCron(world: RealCronWorld, repoKey: string, extraEnv: NodeJS.ProcessEnv): void {
  world.repoKey = repoKey;
  try { fs.unlinkSync(cronPidFilePath(repoKey)); } catch { /* fresh */ }

  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_PAT: FAKE_WORKING_PAT,
    GITHUB_APP_ID: '',
    GITHUB_APP_SLUG: '',
    GITHUB_APP_PRIVATE_KEY_PATH: '',
    GH_TOKEN: '',
    CLAUDE_CODE_PATH: CLAUDE_CLI_STUB,
    ...extraEnv,
  };

  // detached: true so the tsx wrapper's grandchild lands in the same process group as
  // `proc` — killing the group (see killRealCronWorld) is the only way to reach it.
  const proc = spawn('bunx', ['tsx', 'adws/triggers/trigger_cron.ts', '--target-repo', repoKey], {
    cwd: REPO_ROOT,
    env: spawnEnv,
    detached: true,
  });
  world.proc = proc;
  proc.stdout?.on('data', (chunk: Buffer) => { world.stdout += chunk.toString(); });
  proc.stderr?.on('data', (chunk: Buffer) => { world.stderr += chunk.toString(); });
  proc.on('exit', (code, signal) => {
    world.exited = true;
    world.exitInfo = { code, signal };
  });
}

export function killRealCronWorld(world: RealCronWorld): void {
  if (world.proc?.pid) {
    // Negative PID: kill the whole detached process group — bunx's own wrapper process is
    // not the one that writes the PID file; the real tsx-executed grandchild is only
    // reachable this way.
    try { process.kill(-world.proc.pid, 'SIGKILL'); } catch { /* already dead */ }
  }
  if (world.repoKey) {
    try { fs.unlinkSync(cronPidFilePath(world.repoKey)); } catch { /* never created */ }
  }
}
