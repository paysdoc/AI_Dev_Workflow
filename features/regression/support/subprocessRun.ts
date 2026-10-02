/**
 * Runs a real ADW process as a child of the Cucumber process, hermetically: through the `gh` shadow,
 * on the throwaway target workspace, against the Claude CLI stub, with none of the developer's
 * credentials, `HOME` or real workflows within its reach. The child is spawned asynchronously, in a
 * process group of its own, so that a timeout, a stop or the scenario's cleanup can kill everything
 * it started. No hooks and no import-time side effects, so any step file may import it.
 */

import assert from 'assert';
import { execSync, spawn, type ChildProcessByStdio } from 'child_process';
import { writeFileSync } from 'fs';
import { delimiter } from 'path';
import type { Readable } from 'stream';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { CLAUDE_CLI_STUB } from './claudeCliStub.ts';
import { HARNESS_GIT_IDENTITY } from './fixtureWorktree.ts';
import { replayForgeLog, writeForgeState } from './forgeShadow.ts';
import { SURFACE_REPO } from './mockForgeProviders.ts';
import { requireHarness, type SubprocessHarness } from './subprocessHarness.ts';

/** Syntactically complete, so the launch boundary's credential probe accepts it, and never sent anywhere. */
const FAKE_PAT = 'ghp_adwHarnessFakeTokenNeverSentAnywhere';

/** Present and empty, never unset: `dotenv` fills only the names that are absent, from the checkout's `.env`, which holds the developer's credentials. */
const BLANKED_VARIABLES: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'COST_API_URL',
  'COST_API_TOKEN',
  'SLACK_WEBHOOK_URL',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_ACCOUNT_ID',
];

const OUTPUT_TAIL_LINES = 40;
/** How long the process may take to close its pipes after it exits, before a background process holding them is killed. */
const CLOSE_GRACE_MS = 2_000;

export interface RunSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  /** Names the process in the message of a failure. */
  readonly label: string;
  /** Ends the run as soon as the output satisfies it: `beforeStop` runs, then the process group is killed. */
  readonly stopWhen?: (output: string) => boolean;
  readonly beforeStop?: (output: string) => Promise<void>;
  /** The checkout by default: `assertCwdIsRepoRoot` and the cwd-relative `agents/` and `logs/` require it. */
  readonly cwd?: string;
  /** Laid over the hermetic environment. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Standard output and standard error, in the order they arrived. */
  readonly output: string;
  /** True when `stopWhen` ended the run, so the exit code says nothing about what the process would have done. */
  readonly stopped: boolean;
}

let realBunx: string | undefined;

/**
 * The child is spawned through the absolute path, so the `bunx` shadow that leads the child's own
 * `PATH` never intercepts the harness's launch of it. Production launches `bunx tsx` the same way.
 */
export function findRealBunx(): string {
  realBunx ??= execSync('which bunx', { encoding: 'utf-8' }).trim();
  return realBunx;
}

export function harnessEnv(world: RegressionWorld, harness: SubprocessHarness, overlay: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const { name, email } = HARNESS_GIT_IDENTITY;
  return {
    ...process.env,
    ...world.harnessEnv,
    ...Object.fromEntries(BLANKED_VARIABLES.map((variable) => [variable, ''])),
    GITHUB_PAT: FAKE_PAT,
    // An empty value falls back to EUR, and a completed workflow then fetches rates from the network; a comma names no currency once split.
    COST_REPORT_CURRENCIES: ',',
    CLAUDE_CODE_PATH: CLAUDE_CLI_STUB,
    TARGET_REPOS_DIR: harness.targetReposDir,
    HOME: harness.homeDir,
    ADW_TARGET_GUARDRAILS: 'off',
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    ADW_GH_STATE: harness.forgeStatePath,
    ADW_GH_LOG: harness.forgeLogPath,
    // Under the @regression hooks the rest already starts with the git mock, which no-ops fetch, push and clone.
    PATH: [harness.ghBinDir, harness.recorder.binDir, process.env['PATH']].filter(Boolean).join(delimiter),
    ...overlay,
  };
}

/** macOS answers EPERM for a group whose last members are already exiting, which is as good as ESRCH. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH' && code !== 'EPERM') throw error;
  }
}

/** Kills the group once: a group that has been reaped is never signalled again, since its id may have been reused. */
function reapGroup(harness: SubprocessHarness, pid: number): void {
  if (!harness.processGroups.delete(pid)) return;
  killGroup(pid);
}

function tail(output: string): string {
  return output.trim().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
}

type Child = ChildProcessByStdio<null, Readable, Readable>;

interface Watch {
  output: string;
  stopRequested: boolean;
  timedOut: boolean;
  /** What `beforeStop` threw, reported once the process has closed. */
  stopError: unknown;
}

function watchChild(child: Child, pid: number, harness: SubprocessHarness, spec: RunSpec): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const watch: Watch = { output: '', stopRequested: false, timedOut: false, stopError: undefined };
    const timeout = setTimeout(() => {
      watch.timedOut = true;
      reapGroup(harness, pid);
    }, spec.timeoutMs);

    const stop = async (): Promise<void> => {
      try {
        await spec.beforeStop?.(watch.output);
      } catch (error) {
        watch.stopError = error;
      } finally {
        reapGroup(harness, pid);
      }
    };
    const take = (chunk: string): void => {
      watch.output += chunk;
      if (watch.stopRequested || !spec.stopWhen?.(watch.output)) return;
      watch.stopRequested = true;
      void stop();
    };
    const settle = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout);
      reapGroup(harness, pid);
      if (watch.timedOut) {
        reject(new assert.AssertionError({ message: `${spec.label} did not exit within ${spec.timeoutMs / 1000} s; the harness killed its process group. Last output:\n${tail(watch.output)}` }));
      } else if (watch.stopError !== undefined) {
        reject(watch.stopError);
      } else {
        resolve({ exitCode, signal, output: watch.output, stopped: watch.stopRequested });
      }
    };

    child.stdout.setEncoding('utf-8').on('data', take);
    child.stderr.setEncoding('utf-8').on('data', take);
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    // A background process that outlives the child keeps its pipes open, and `close` waits for them.
    child.on('exit', () => setTimeout(() => reapGroup(harness, pid), CLOSE_GRACE_MS).unref());
    child.on('close', settle);
  });
}

/** Rejects, naming the output's tail, when the process outlives `timeoutMs`; its whole process group is killed first. */
export function runHarnessProcess(world: RegressionWorld, spec: RunSpec): Promise<ProcessResult> {
  const harness = requireHarness(world);
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd ?? REPO_ROOT,
    env: harnessEnv(world, harness, spec.env),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid;
  assert.ok(pid !== undefined, `${spec.label} could not be started: ${spec.command}`);
  harness.processGroups.add(pid);
  world.cleanup.push(() => reapGroup(harness, pid));
  return watchChild(child, pid, harness, spec);
}

/** Every call the shadow refused fails the run, even when the process that made it swallowed the failure and exited 0. */
function assertNothingUnsupported(unsupported: readonly string[]): void {
  const calls = unsupported.map((argv) => `gh shadow: unsupported: ${argv}`);
  assert.strictEqual(calls.length, 0, `The gh shadow refused ${calls.length} call(s) the process made:\n${calls.join('\n')}`);
}

/**
 * The forge state is written from the mock server before the run, and the shadow's log is replayed
 * against the mock after the process has exited, so the existing Then steps see the child's writes.
 * `recordsExitCode` is false for a process the harness kills itself: its exit code says nothing.
 */
export async function runThroughHarness(world: RegressionWorld, spec: RunSpec, { recordsExitCode }: { recordsExitCode: boolean }): Promise<ProcessResult> {
  const harness = requireHarness(world);
  writeForgeState(harness.forgeStatePath, getMockServerState(), SURFACE_REPO);
  writeFileSync(harness.forgeLogPath, '', 'utf-8');

  const result = await runHarnessProcess(world, spec);
  world.lastOutput = result.output;
  if (recordsExitCode) world.lastExitCode = result.exitCode ?? -1;
  assertNothingUnsupported(replayForgeLog(harness.forgeLogPath).unsupported);
  return result;
}
