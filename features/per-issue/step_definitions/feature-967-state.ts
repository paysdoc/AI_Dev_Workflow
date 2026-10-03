/**
 * Per-scenario state of feature-967.feature, and the hooks around it. State hangs off the World, so
 * each scenario starts with none. The hooks are keyed on the feature's own tag, never `@adw-967`: the
 * flagged scenarios of other features carry that tag and must not run them.
 */

import { After, Before } from '@cucumber/cucumber';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { PAUSE_QUEUE_PATH } from '../../../adws/core/pauseQueue.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { CucumberRun } from '../../support/cucumberChildRun.ts';
import { setChildEnvironment } from './feature-961.steps.ts';

export const HOOK_TAG = '@adw-ls9ywd-bug-run-the-cron-can';

const AUTH_GATE_FILE = resolve(REPO_ROOT, AUTH_GATE_PATH);
const PAUSE_QUEUE_FILE = resolve(REPO_ROOT, PAUSE_QUEUE_PATH);

/** The files the smoke scenarios must leave as they found them. A file or directory that is absent counts as empty. */
export interface SharedFiles {
  readonly authGate: string | null;
  readonly pauseQueue: string | null;
  readonly cronRegistry: Readonly<Record<string, string>>;
  readonly cronLogs: Readonly<Record<string, string>>;
}

export interface SmokeScenario {
  readonly feature: string;
  readonly scenario: string;
}

export interface ScenarioState {
  /** `agents/.auth_gate` and `agents/paused_queue.json` as the scenario found them, which the After hook puts back. */
  saved: Pick<SharedFiles, 'authGate' | 'pauseQueue'> | null;
  /** The shared files just before the first smoke run. */
  before: SharedFiles | null;
  smokeRuns: readonly CucumberRun[];
  /** The scenarios the last Then judged by name, so "no other smoke scenario" knows which are the others. */
  named: readonly SmokeScenario[];
}

function freshState(): ScenarioState {
  return { saved: null, before: null, smokeRuns: [], named: [] };
}

const states = new WeakMap<RegressionWorld, ScenarioState>();

export function stateOf(world: RegressionWorld): ScenarioState {
  const existing = states.get(world);
  if (existing) return existing;
  const created = freshState();
  states.set(world, created);
  return created;
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf-8') : null;
}

function restoreFile(file: string, saved: string | null): void {
  if (saved === null) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, saved, 'utf-8');
}

/** The names and contents of the files in a directory. */
function directoryContents(directory: string): Record<string, string> {
  if (!existsSync(directory)) return {};
  const names = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  return Object.fromEntries(names.map((name): [string, string] => [name, readFileSync(join(directory, name), 'utf-8')]));
}

export function snapshotShared(): SharedFiles {
  return {
    authGate: readIfExists(AUTH_GATE_FILE),
    pauseQueue: readIfExists(PAUSE_QUEUE_FILE),
    cronRegistry: directoryContents(join(AGENTS_STATE_DIR, 'cron')),
    cronLogs: directoryContents(join(LOGS_DIR, 'agents', 'cron')),
  };
}

Before({ tags: HOOK_TAG }, function (this: RegressionWorld) {
  stateOf(this).saved = { authGate: readIfExists(AUTH_GATE_FILE), pauseQueue: readIfExists(PAUSE_QUEUE_FILE) };
});

// The 963 helpers push their removals onto the World's cleanup list, and no @regression hook runs for this feature.
After({ tags: HOOK_TAG }, async function (this: RegressionWorld) {
  await runCleanup(this);
  setChildEnvironment(null);
  const { saved } = stateOf(this);
  if (!saved) return;
  restoreFile(AUTH_GATE_FILE, saved.authGate);
  restoreFile(PAUSE_QUEUE_FILE, saved.pauseQueue);
});
