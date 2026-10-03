/**
 * Records the `bunx` launches the code under test makes, without running any of them: a `bunx` shadow
 * leads `PATH` while the code runs, writes its argv to a file of its own under `recordsDir` and exits
 * at once. No Cucumber hooks and no import-time side effects, so any step file may import it.
 */

import assert from 'assert';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

export interface LaunchRecorder {
  readonly rootDir: string;
  readonly binDir: string;
  readonly recordsDir: string;
}

const POLL_MS = 50;
/** How long the records must stay unchanged before a launch made by a detached child counts as settled. */
const QUIET_MS = 750;
const SETTLE_CAP_MS = 10_000;
const CRON_SCRIPT = 'adws/triggers/trigger_cron.ts';

export function createLaunchRecorder(): LaunchRecorder {
  const rootDir = mkdtempSync(join(tmpdir(), 'adw-launch-recorder-'));
  const binDir = join(rootDir, 'bin');
  const recordsDir = join(rootDir, 'records');
  mkdirSync(binDir);
  mkdirSync(recordsDir);
  const shadow = join(binDir, 'bunx');
  // The record is written to `.tmp` and renamed, so a reader never sees a half-written one.
  writeFileSync(shadow, [
    '#!/bin/sh',
    `record='${recordsDir}/launch-'$$`,
    `printf '%s\\0' "$@" > "$record.tmp" && mv "$record.tmp" "$record.args"`,
    '',
  ].join('\n'));
  chmodSync(shadow, 0o755);
  return { rootDir, binDir, recordsDir };
}

/**
 * `ensureCronProcess` and `spawnDetached` call `spawn('bunx', …)` with no `env`, so Node resolves
 * `bunx` from `process.env.PATH` at the moment of the call. The shadow therefore has to lead `PATH`
 * only while the synchronous dispatch runs. A wider window would also answer the test's own later
 * `bunx` calls (a type-check, a child Cucumber run), which would then pass without running anything.
 */
export function withLaunchRecorderOnPath<T>(recorder: LaunchRecorder, fn: () => T): T {
  const saved = process.env.PATH;
  process.env.PATH = `${recorder.binDir}${delimiter}${saved ?? ''}`;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
}

function recordNames(recorder: LaunchRecorder): string[] {
  return readdirSync(recorder.recordsDir).sort();
}

export function recordedLaunches(recorder: LaunchRecorder): string[][] {
  return recordNames(recorder)
    .filter((name) => name.endsWith('.args'))
    .map((name) => readFileSync(join(recorder.recordsDir, name), 'utf-8').split('\0').slice(0, -1));
}

export function describeLaunches(recorder: LaunchRecorder): string {
  return JSON.stringify(recordedLaunches(recorder).map((argv) => argv.join(' ')));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Settled once the records have stayed unchanged for QUIET_MS and none is still being written. */
export async function settleLaunches(recorder: LaunchRecorder): Promise<void> {
  const start = Date.now();
  let seen = recordNames(recorder).join('\n');
  let lastChange = start;
  while (Date.now() - start < SETTLE_CAP_MS) {
    await sleep(POLL_MS);
    const names = recordNames(recorder);
    if (names.join('\n') !== seen || names.some((name) => name.endsWith('.tmp'))) {
      seen = names.join('\n');
      lastChange = Date.now();
    }
    if (Date.now() - lastChange >= QUIET_MS) return;
  }
  assert.fail(`Launches did not settle within ${SETTLE_CAP_MS} ms: ${describeLaunches(recorder)}`);
}

/** Returns when a record satisfies the predicate or the timeout elapses; the caller asserts. */
export async function waitForLaunch(recorder: LaunchRecorder, predicate: (argv: readonly string[]) => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (recordedLaunches(recorder).some(predicate)) return;
    await sleep(POLL_MS);
  }
}

export function isCronLaunch(argv: readonly string[]): boolean {
  return argv.some((arg) => arg.replace(/\\/g, '/').endsWith(CRON_SCRIPT));
}

export function isCronLaunchFor(argv: readonly string[], repoFullName: string): boolean {
  const flag = argv.indexOf('--target-repo');
  return isCronLaunch(argv) && flag !== -1 && argv[flag + 1] === repoFullName;
}

export function disposeLaunchRecorder(recorder: LaunchRecorder): void {
  try {
    rmSync(recorder.rootDir, { recursive: true, force: true });
  } catch {
    // Best effort: a leftover temp directory must not fail the scenario that has already finished.
  }
}
