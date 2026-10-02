/**
 * The processes that stand in for orchestrators. A dead orchestrator is a short-lived child whose
 * pid and start token were captured while it lived; a live one is a throwaway long-lived child.
 * A made-up pid is never written anywhere: liveness is decided against a real process table entry.
 */

import assert from 'assert';
import { spawn, type ChildProcess } from 'child_process';

import { getProcessStartTime, isProcessLive } from '../../../adws/core/processLiveness.ts';

export interface OrchestratorProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  /** The platform start token captured while the process lived (`getProcessStartTime`). */
  readonly startToken: string;
}

const START_TOKEN_WAIT_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStartToken(pid: number): Promise<string> {
  const deadline = Date.now() + START_TOKEN_WAIT_MS;
  while (Date.now() < deadline) {
    const token = getProcessStartTime(pid);
    if (token) return token;
    await sleep(25);
  }
  assert.fail(`Expected a start-time token for pid ${pid} within ${START_TOKEN_WAIT_MS} ms`);
}

export async function startOrchestratorProcess(): Promise<OrchestratorProcess> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  assert.ok(child.pid, 'Expected the throwaway child process to have a pid');
  return { child, pid: child.pid, startToken: await readStartToken(child.pid) };
}

function hasExited(owner: OrchestratorProcess): boolean {
  return owner.child.exitCode !== null || owner.child.signalCode !== null;
}

export async function killOrchestratorProcess(owner: OrchestratorProcess): Promise<void> {
  if (hasExited(owner)) return;
  await new Promise<void>((resolve) => {
    owner.child.once('exit', () => resolve());
    owner.child.kill('SIGKILL');
  });
}

export function isOrchestratorProcessAlive(owner: OrchestratorProcess): boolean {
  return isProcessLive(owner.pid, owner.startToken);
}
