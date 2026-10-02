/**
 * Per-scenario state of feature-966.feature, and the hooks around it. State hangs off the World, so
 * each scenario starts with none. The hooks are keyed on the feature's own tag, never `@adw-966`: the
 * flagged scenarios of features 909, 960, 961 and 963 carry that tag and must not run them.
 */

import { After, Before } from '@cucumber/cucumber';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

import { AUTH_GATE_PATH } from '../../../adws/core/authGate.ts';
import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { realGit } from '../../regression/support/fixtureWorktree.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { setChildEnvironment } from './feature-961.steps.ts';

export const HOOK_TAG = '@adw-p5u9xh-bug-build-the-hermet';

const AUTH_GATE_FILE = resolve(REPO_ROOT, AUTH_GATE_PATH);

/** What git lists for the checkout: its branches and its worktrees. */
export interface CheckoutListing {
  readonly branches: string;
  readonly worktrees: string;
}

export interface StubLookup {
  /** The directory the stub ran in. */
  readonly directory: string;
  /** Every file the throwaway tree held before the run, relative to its root. */
  readonly filesBefore: readonly string[];
}

export interface ScenarioState {
  checkout: CheckoutListing | null;
  /** `agents/.auth_gate` as the scenario found it: its content, or null when there was none. */
  authGate: { readonly content: string | null } | null;
  /** A throwaway directory under the system's temporary directory with no stub manifest above it. */
  bareDirectory: string | null;
  stubLookup: StubLookup | null;
  /** What the child Cucumber process is given on top of the parent's environment. */
  childEnvironment: Record<string, string>;
  developer: { homeDirectory: string; claudeJson: string } | null;
  developerGhLog: string | null;
  /** The environment a stand-in process recorded, by name. */
  standInEnvironment: ReadonlyMap<string, string> | null;
}

function freshState(): ScenarioState {
  return { checkout: null, authGate: null, bareDirectory: null, stubLookup: null, childEnvironment: {}, developer: null, developerGhLog: null, standInEnvironment: null };
}

const states = new WeakMap<RegressionWorld, ScenarioState>();

export function stateOf(world: RegressionWorld): ScenarioState {
  const existing = states.get(world);
  if (existing) return existing;
  const created = freshState();
  states.set(world, created);
  return created;
}

export function captureCheckout(): CheckoutListing {
  return {
    branches: realGit(REPO_ROOT, 'branch', '--list'),
    worktrees: realGit(REPO_ROOT, 'worktree', 'list', '--porcelain'),
  };
}

function readAuthGate(): string | null {
  return existsSync(AUTH_GATE_FILE) ? readFileSync(AUTH_GATE_FILE, 'utf-8') : null;
}

function restoreAuthGate(saved: string | null): void {
  if (saved === null) {
    rmSync(AUTH_GATE_FILE, { force: true });
    return;
  }
  mkdirSync(dirname(AUTH_GATE_FILE), { recursive: true });
  writeFileSync(AUTH_GATE_FILE, saved, 'utf-8');
}

/** Sets the variable for the process running the scenario; the World's cleanup puts it back as it was. */
export function setProcessEnv(world: RegressionWorld, name: string, value: string): void {
  const saved = process.env[name];
  process.env[name] = value;
  world.cleanup.push(() => {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  });
}

// 961's Given writes a gate record, and the hooks that restore it are keyed on tags this feature does not carry.
Before({ tags: HOOK_TAG }, function (this: RegressionWorld) {
  const state = stateOf(this);
  state.checkout = captureCheckout();
  state.authGate = { content: readAuthGate() };
});

// The 963 helpers push their removals onto the World's cleanup list, and no @regression hook runs for this feature.
After({ tags: HOOK_TAG }, async function (this: RegressionWorld) {
  await runCleanup(this);
  setChildEnvironment(null);
  const { authGate } = stateOf(this);
  if (authGate) restoreAuthGate(authGate.content);
});
