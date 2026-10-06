import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import { world796 } from './feature-796.steps.ts';
import type { Fixture } from './feature-796.steps.ts';
import type { RepoIdentifier } from '@paysdoc/devplatform';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import { REPO_ROOT } from '../../../adws/core/config.ts';
import { createRealCronWorld } from '../../regression/step_definitions/realCronProcess.ts';

const CLAUDE_CLI_STUB = path.join(REPO_ROOT, 'test', 'mocks', 'claude-cli-stub.ts');

/** How long the recorders and the tracker's call log must stay silent before an asynchronous handling counts as settled. */
const QUIET_MS = 750;
const SETTLE_CAP_MS = 20_000;
export const LAUNCH_WAIT_MS = 10_000;
export const LABEL_WAIT_MS = 20_000;
export const CRON_STARTUP_WAIT_MS = 15_000;
export const CRON_TICK_WAIT_MS = 20_000;

interface Launch {
  readonly argv: string[];
  readonly script: string;
  readonly issue: string;
}

export const s: {
  dir: string;
  savedPath: string | undefined;
  savedClaudeCodePath: string | undefined;
  savedWebhookSecret: string | undefined;
  savedAuthGate: string | null;
  savedQueueRaw: string | null;
  usedAdwIds: Set<string>;
  registeredCronRepoKeys: Set<string>;
  cron: ReturnType<typeof createRealCronWorld>;
  cronTargetReposDir: string;
  forgeRefusesLabels: boolean;
} = {
  dir: '',
  savedPath: undefined,
  savedClaudeCodePath: undefined,
  savedWebhookSecret: undefined,
  savedAuthGate: null,
  savedQueueRaw: null,
  usedAdwIds: new Set(),
  registeredCronRepoKeys: new Set(),
  cron: createRealCronWorld(),
  cronTargetReposDir: '',
  forgeRefusesLabels: false,
};

export function bunxBinDir(): string {
  return path.join(s.dir, 'bunx-bin');
}

export function ghBinDir(): string {
  return path.join(s.dir, 'gh-bin');
}

function writeExecutable(file: string, lines: string[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n') + '\n');
  fs.chmodSync(file, 0o755);
}

/** Writes each invocation's argv, NUL-separated, to its own file named after the shell's pid. */
function recordArgvLine(prefix: string): string {
  return `printf '%s\\0' "$@" > '${s.dir}/${prefix}-'$$'.args'`;
}

export function installBunxShadow(): void {
  writeExecutable(path.join(bunxBinDir(), 'bunx'), ['#!/bin/sh', recordArgvLine('launch')]);
}

/** Records the invocation, runs the stub, then marks the invocation finished so a slow classification is never mistaken for silence. */
export function installClaudeShadow(): string {
  const shadow = path.join(s.dir, 'claude');
  writeExecutable(shadow, [
    '#!/bin/sh',
    recordArgvLine('claude'),
    `bun '${CLAUDE_CLI_STUB}' "$@"`,
    'status=$?',
    `: > '${s.dir}/claude-'$$'.done'`,
    'exit $status',
  ]);
  return shadow;
}

/** Answers `gh auth token`, records every `gh label create`, and exits 0 — or 1 when the forge is to refuse. */
export function installGhShadow(refuseLabels: boolean): void {
  writeExecutable(path.join(ghBinDir(), 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "token" ]; then echo adw-932-fake-token; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "create" ]; then',
    `  ${recordArgvLine('gh-label')}`,
    ...(refuseLabels ? ["  echo 'HTTP 403: label creation refused' >&2", '  exit 1'] : ['  exit 0']),
    'fi',
    'exit 0',
  ]);
}

export function readArgvRecords(prefix: string): string[][] {
  return fs.readdirSync(s.dir)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.args'))
    .sort()
    .map((name) => fs.readFileSync(path.join(s.dir, name), 'utf-8').split('\0').slice(0, -1));
}

/** argv is `tsx <script> <issue> …`; a launch belongs to the issue named right after the script. */
function readLaunches(): Launch[] {
  return readArgvRecords('launch').map((argv) => ({
    argv,
    script: path.relative(REPO_ROOT, argv[1] ?? ''),
    issue: argv[2] ?? '',
  }));
}

export function launchesFor(issueNumber: number): Launch[] {
  return readLaunches().filter((launch) => launch.issue === String(issueNumber));
}

export function describeLaunches(): string {
  return JSON.stringify(readLaunches().map((launch) => launch.argv.join(' ')));
}

/** The prompt is the Claude CLI's last argument. */
export function classifierConsulted(issueNumber: number): boolean {
  return readArgvRecords('claude')
    .map((args) => args[args.length - 1] ?? '')
    .some((prompt) => prompt.includes('/classify_issue') && prompt.includes(`#${issueNumber}:`));
}

function classifierBusy(): boolean {
  const names = fs.readdirSync(s.dir);
  const started = names.filter((name) => /^claude-.*\.args$/.test(name)).length;
  const finished = names.filter((name) => /^claude-.*\.done$/.test(name)).length;
  return started > finished;
}

function activityCount(): number {
  return world796().activeCallLog.length + fs.readdirSync(s.dir).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The opened, comment and closed branches finish asynchronously, and so do the recorders of the
 * launches they make. Handling has settled once the tracker's call log and the shadows' records have
 * stayed unchanged for QUIET_MS and no classification is still running.
 */
export async function settle(): Promise<void> {
  const start = Date.now();
  let seen = activityCount();
  let lastChange = Date.now();
  while (Date.now() - start < SETTLE_CAP_MS) {
    await sleep(50);
    const current = activityCount();
    if (current !== seen || classifierBusy()) {
      seen = current;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange >= QUIET_MS) return;
  }
  assert.fail(`Handling did not settle within ${SETTLE_CAP_MS} ms`);
}

export async function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  assert.ok(predicate(), `Timed out after ${timeoutMs} ms waiting for ${description}`);
}

export function requireBoundary(): LaunchBoundary {
  const { boundary } = world796();
  assert.ok(boundary, 'Expected a launch boundary to have been built first');
  return boundary;
}

export function requireFixture(): Fixture {
  const { activeFixture } = world796();
  assert.ok(activeFixture, 'Expected provider fixtures to have been set up first');
  return activeFixture;
}

export function repoKeyOf(repoId: RepoIdentifier): string {
  return `${repoId.owner}/${repoId.repo}`;
}

export function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

export function restoreFile(file: string, saved: string | null): void {
  if (saved === null) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, saved);
}

export function restoreEnv(name: string, saved: string | undefined): void {
  if (saved === undefined) delete process.env[name];
  else process.env[name] = saved;
}

export function resetLocalState(): void {
  s.dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-932-'));
  s.usedAdwIds = new Set();
  s.registeredCronRepoKeys = new Set();
  s.cron = createRealCronWorld();
  s.cronTargetReposDir = '';
  s.forgeRefusesLabels = false;
}

/** Well before GRACE_PERIOD_MS, or the cron's filter drops every issue as `grace_period`. */
export function staleTimestamp(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}
